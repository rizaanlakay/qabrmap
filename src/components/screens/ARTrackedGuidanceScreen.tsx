'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import * as THREE from 'three';
import { X } from 'lucide-react';
import { Grave } from '@/types';
import { calculateDistanceMeters, calculateBearing } from '@/lib/geospatial';
import { isUsableGpsFix } from '@/lib/geospatial/routeProgress';
import { useWakeLock } from '@/lib/device/useWakeLock';
import { useCompassHeading } from '@/lib/device/useCompassHeading';
import type { CompassStatus } from '@/lib/device/compass';
import { graveNumberLabel } from '@/lib/ui/graveLabels';
import { pruneFixes, smoothFixes, SmoothedFix, TimedFix } from '@/lib/capture/gpsFixes';
import { smoothAngle, smoothValue } from '@/lib/ar/smoothing';
import { loadXR8, XR8Api, XR_ENGINE_LICENSE_URL, XR_ENGINE_NOTICE } from '@/lib/ar/xr8';
import { ARRIVED_M, createSceneDriver, DriverState } from '@/lib/ar/sceneDriver';
import type { VisitFix } from '@/lib/graves/visits';
import { VisitConfirmButton } from '@/components/common/VisitConfirmButton';
import { LookForThisGrave } from '@/components/common/LookForThisGrave';
import { VisionDebugView } from '@/components/common/VisionDebugView';
import { hasRealGravePhoto } from '@/lib/ui/gravestoneInscription';
import { MATCHER_WORKER_URL, OPENCV_SCRIPT_URL, VISION_CONFIG } from '@/lib/ar/vision/config';
import { createMatcherClient, WorkerLike } from '@/lib/ar/vision/matcherClient';
import { loadReferenceLevels } from '@/lib/ar/vision/referenceLevels';
import { createVisionDriver, VisionPhase, VisionState } from '@/lib/ar/vision/visionDriver';

interface ARTrackedGuidanceScreenProps {
  targetGrave: Grave;
  userLocation?: { lat: number; lng: number };
  distanceMeters?: number;
  onUpdateUserLocation?: (loc: { lat: number; lng: number }) => void;
  onClose: () => void;
  onConfirmVisit?: (grave: Grave, fix: VisitFix) => Promise<Grave>;
  // Called once when the engine cannot start; the caller shows the sensor screen instead
  onFallback: (reason: string) => void;
}

// Sensor smoothing for the badge and turn text, as on the sensor screen
const ALPHA_POSITION = 0.3;
const ALPHA_ORIENTATION = 0.25;
// One deadline for the whole start-up (engine download, camera prompt and first world lock). Once tracking has
// reached NORMAL it never fires again: north can still arrive later from walking, and limited tracking mid-walk
// is handled on screen, not by leaving.
const STARTUP_FALLBACK_MS = 30_000;
// Stone matching diagnostics: ?visionDebug=1 turns them on and is remembered, =0 turns them off, and five
// quick taps on the screen title toggle them in the installed app, which has no address bar
const VISION_DEBUG_KEY = 'qabrmap:visionDebug';
const DEBUG_TAPS = 5;
const DEBUG_TAP_WINDOW_MS = 2500;

function readVisionDebug(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const param = new URLSearchParams(window.location.search).get('visionDebug');
    if (param === '1') window.localStorage.setItem(VISION_DEBUG_KEY, '1');
    if (param === '0') window.localStorage.removeItem(VISION_DEBUG_KEY);
    return window.localStorage.getItem(VISION_DEBUG_KEY) === '1';
  } catch {
    return false;
  }
}

// What the chip above the instruction pill says while the camera looks for the photographed stone. Never a
// percentage: the match is a pointer, and the visitor confirms by reading the stone.
const VISION_CHIP: Partial<Record<VisionPhase, { text: string; tone: string; dot: string }>> = {
  scanning: { text: 'Scanning for the stone…', tone: 'border-white/20 text-white/90', dot: 'bg-white/70 animate-pulse' },
  potential: { text: 'Possible match', tone: 'border-amber-400/70 text-amber-200', dot: 'bg-amber-400' },
  likely: { text: 'Likely match. Check the name and dates.', tone: 'border-emerald-400/70 text-emerald-200', dot: 'bg-emerald-400' },
};

function describeMissingHeading(status: CompassStatus): string {
  if (status === 'needs-permission') return 'Tap the screen to start the compass';
  if (status === 'denied') return 'Allow motion access for this site in Settings';
  if (status === 'unsupported') return 'Compass not available on this device';
  return 'Waiting for compass…';
}

// What the status pill says for each stage of tracking. Without a compass, north comes from walking a few metres.
function describeTracking(state: DriverState, arrived: boolean, accuracy: number, compassStatus: CompassStatus): string {
  if (state.tracking === 'initialising') return 'Move the phone slowly sideways so it can find the floor';
  if (state.tracking === 'limited') return 'Tracking is limited. Point at textured ground and move slowly';
  if (!state.aligned) {
    return compassStatus === 'denied' || compassStatus === 'unsupported'
      ? 'Walk a few steps so the line can find north'
      : 'Waiting for the compass…';
  }
  return arrived ? `± ${accuracy} m. Not the right name? Look around this spot.` : 'Follow the line';
}

export const ARTrackedGuidanceScreen: React.FC<ARTrackedGuidanceScreenProps> = ({
  targetGrave,
  userLocation,
  distanceMeters: initialDistance = 8,
  onUpdateUserLocation,
  onClose,
  onConfirmVisit,
  onFallback,
}) => {
  useWakeLock(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const driverRef = useRef<ReturnType<typeof createSceneDriver> | null>(null);
  const visionRef = useRef<ReturnType<typeof createVisionDriver> | null>(null);
  const [visionState, setVisionState] = useState<VisionState | null>(null);
  const [visionDebug, setVisionDebug] = useState(false);
  const debugTapsRef = useRef<number[]>([]);
  const [engineStatus, setEngineStatus] = useState<'loading' | 'camera' | 'running'>('loading');
  const [driverState, setDriverState] = useState<DriverState>({
    tracking: 'initialising',
    floorMeasured: false,
    aligned: false,
    arrived: false,
  });
  const { heading: phoneHeading, status: compassStatus } = useCompassHeading();

  // Callbacks read through refs so the engine and GPS effects run once
  const onFallbackRef = useRef(onFallback);
  const onUpdateUserLocationRef = useRef(onUpdateUserLocation);
  useEffect(() => {
    onFallbackRef.current = onFallback;
    onUpdateUserLocationRef.current = onUpdateUserLocation;
  }, [onFallback, onUpdateUserLocation]);

  // Own GPS watch, smoothed like the capture screen
  const fixesRef = useRef<TimedFix[]>([]);
  // Held as the smoothed fix rather than the visit shape, since the driver needs the fix's timestamp too
  const [fix, setFix] = useState<SmoothedFix | null>(null);
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!isUsableGpsFix(pos.coords.latitude, pos.coords.longitude)) return;
        const now = Date.now();
        fixesRef.current = pruneFixes(fixesRef.current, now);
        fixesRef.current.push({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: now });
        const smoothed = smoothFixes(fixesRef.current, now);
        setFix(smoothed);
        if (smoothed) onUpdateUserLocationRef.current?.({ lat: smoothed.lat, lng: smoothed.lng });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const here = fix ?? userLocation;
  const rawDistance = here ? calculateDistanceMeters(here.lat, here.lng, targetGrave.latitude, targetGrave.longitude) : initialDistance;
  const rawBearing = here ? calculateBearing(here.lat, here.lng, targetGrave.latitude, targetGrave.longitude) : 0;

  // The grave is planted only from this screen's own GPS fix, never from the page's default location, and it
  // carries the fix's timestamp so the driver pairs it with the camera pose from that moment
  const fixDistance = fix ? calculateDistanceMeters(fix.lat, fix.lng, targetGrave.latitude, targetGrave.longitude) : null;
  const fixBearing = fix ? calculateBearing(fix.lat, fix.lng, targetGrave.latitude, targetGrave.longitude) : null;

  // Read by the engine effect when the driver is created, so the first fix and heading reach it at once
  const targetRef = useRef<{ bearingDeg: number; distanceM: number; at: number; lat: number; lng: number } | null>(null);
  targetRef.current =
    fix && fixBearing !== null && fixDistance !== null
      ? { bearingDeg: fixBearing, distanceM: fixDistance, at: fix.at, lat: fix.lat, lng: fix.lng }
      : null;
  const headingRef = useRef<number | null>(null);
  headingRef.current = phoneHeading;
  const [driverReady, setDriverReady] = useState(false);

  const [liveDistance, setLiveDistance] = useState<number | null>(null);
  const [targetBearing, setTargetBearing] = useState<number | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  useEffect(() => {
    setLiveDistance((prev) => smoothValue(prev, rawDistance, ALPHA_POSITION));
    setTargetBearing((prev) => smoothAngle(prev, rawBearing, ALPHA_POSITION));
  }, [rawDistance, rawBearing]);
  useEffect(() => {
    if (phoneHeading !== null) setHeading((prev) => smoothAngle(prev, phoneHeading, ALPHA_ORIENTATION));
  }, [phoneHeading]);

  const distance = liveDistance ?? rawDistance;
  const bearing = targetBearing ?? rawBearing;
  // The driver decides arrival once it owns the world; before that the GPS distance is all there is
  const arrived =
    engineStatus === 'running' && driverState.aligned ? driverState.arrived : distance <= ARRIVED_M;

  // Feed the scene: the grave from each fix, the compass whenever it changes.
  // driverReady is a dependency so both feeds run again once the driver exists.
  useEffect(() => {
    if (targetRef.current) driverRef.current?.setTarget(targetRef.current);
  }, [fix, fixBearing, fixDistance, driverReady]);
  useEffect(() => {
    driverRef.current?.setHeading(phoneHeading);
  }, [phoneHeading, driverReady]);

  // Feed stone matching: the whole-grave photo is what visitors are told to look for, so it is what the
  // camera looks for too; the stone close-up stands in when there is none. The matcher is fetched on the way
  // in and only runs near the grave.
  const referenceUrl = targetGrave.gravePhotoUrl ?? (hasRealGravePhoto(targetGrave.primaryPhotoUrl) ? targetGrave.primaryPhotoUrl : undefined);
  const nearEnoughToLoad = distance <= VISION_CONFIG.loadDistanceM || arrived;
  const nearEnoughToMatch = distance <= VISION_CONFIG.matchDistanceM || arrived;
  useEffect(() => {
    if (referenceUrl && nearEnoughToLoad) visionRef.current?.prepare(referenceUrl);
  }, [referenceUrl, nearEnoughToLoad, driverReady]);
  useEffect(() => {
    visionRef.current?.setActive(nearEnoughToMatch);
  }, [nearEnoughToMatch, driverReady]);
  useEffect(() => {
    visionRef.current?.setFallbackDepth(distance);
  }, [distance, driverReady]);
  useEffect(() => {
    setVisionDebug(readVisionDebug());
  }, []);
  useEffect(() => {
    visionRef.current?.setDebug(visionDebug);
  }, [visionDebug, driverReady]);

  const onTitleTap = () => {
    const t = Date.now();
    debugTapsRef.current = [...debugTapsRef.current.filter((at) => t - at < DEBUG_TAP_WINDOW_MS), t];
    if (debugTapsRef.current.length < DEBUG_TAPS) return;
    debugTapsRef.current = [];
    setVisionDebug((on) => {
      try {
        if (on) window.localStorage.removeItem(VISION_DEBUG_KEY);
        else window.localStorage.setItem(VISION_DEBUG_KEY, '1');
      } catch {
        // Private mode: the toggle still works for this visit
      }
      return !on;
    });
  };

  // Start the engine once; anything that stops it starting hands over to the sensor screen
  useEffect(() => {
    let cancelled = false;
    let engine: XR8Api | null = null;
    let onResize: (() => void) | null = null;

    const start = async () => {
      let XR8: XR8Api;
      try {
        XR8 = await loadXR8();
      } catch (err) {
        if (cancelled) return;
        onFallbackRef.current(err instanceof Error ? err.message : 'engine-load');
        return;
      }
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      engine = XR8;
      // The engine sizes its drawing buffer and inline style from the canvas attributes, so they must match the
      // screen before it starts, not the 300 by 150 default
      const fitCanvas = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
      };
      fitCanvas();
      onResize = fitCanvas;
      window.addEventListener('resize', onResize);
      window.THREE = THREE;

      const driver = createSceneDriver(XR8);
      driverRef.current = driver;
      driver.onState(setDriverState);
      driver.setHeading(headingRef.current);
      if (targetRef.current) driver.setTarget(targetRef.current);

      // Looks for the photographed stone in the camera view. It shares the pipeline and nothing else: when it
      // cannot work it says so once and this screen carries on as before.
      const vision = createVisionDriver(XR8, {
        config: VISION_CONFIG,
        makeMatcher: () => createMatcherClient(() => new Worker(MATCHER_WORKER_URL) as unknown as WorkerLike, OPENCV_SCRIPT_URL, VISION_CONFIG),
        loadReference: (url) => loadReferenceLevels(url, VISION_CONFIG),
      });
      visionRef.current = vision;
      vision.onState(setVisionState);
      setDriverReady(true);

      try {
        XR8.XrController.configure({ scale: 'absolute', disableWorldTracking: false });
        // The engine is a page-wide singleton, so the modules must go with the screen rather than pile up
        XR8.clearCameraPipelineModules();
        XR8.addCameraPipelineModules([
          XR8.XrController.pipelineModule(),
          XR8.GlTextureRenderer.pipelineModule(),
          XR8.Threejs.pipelineModule(),
          {
            name: 'qabrmap-screen',
            onStart: () => {
              // The engine writes its own inline size on start; pin the canvas to the screen again
              fitCanvas();
              setEngineStatus('running');
            },
            onCameraStatusChange: ({ status }) => {
              if (status === 'requesting') setEngineStatus('camera');
              if (status === 'failed') onFallbackRef.current('camera');
            },
            onException: (error) => onFallbackRef.current(error instanceof Error && error.message ? error.message : 'engine'),
          },
          driver.pipelineModule,
          ...vision.pipelineModules,
        ]);
        XR8.run({ canvas, allowedDevices: XR8.XrConfig.device().ANY });
      } catch (err) {
        if (cancelled) return;
        onFallbackRef.current(err instanceof Error ? err.message : 'engine-start');
      }
    };
    void start();

    return () => {
      cancelled = true;
      if (onResize) window.removeEventListener('resize', onResize);
      driverRef.current?.dispose();
      driverRef.current = null;
      visionRef.current?.dispose();
      visionRef.current = null;
      try {
        engine?.stop();
        // The engine is a page-wide singleton, so the modules must go with the screen
        engine?.clearCameraPipelineModules();
      } catch {
        // An engine that never started has nothing to stop
      }
    };
    // The heading is fed through setHeading above; the engine must not restart when it changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the world has locked the engine is doing its job; a missing compass is covered by walking, not by leaving
  const hasTrackedRef = useRef(false);
  useEffect(() => {
    if (driverState.tracking === 'normal') hasTrackedRef.current = true;
  }, [driverState.tracking]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!hasTrackedRef.current) onFallbackRef.current('startup-timeout');
    }, STARTUP_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, []);

  let guidanceText = 'Keep straight';
  const diffAngle = heading === null ? 0 : ((bearing - heading + 540) % 360) - 180;
  if (arrived) guidanceText = 'You are at the grave';
  else if (heading === null) guidanceText = describeMissingHeading(compassStatus);
  else if (Math.abs(diffAngle) > 120) guidanceText = 'Turn Around';
  else if (diffAngle > 35) guidanceText = `Turn Right (${Math.round(diffAngle)}°)`;
  else if (diffAngle < -35) guidanceText = `Turn Left (${Math.abs(Math.round(diffAngle))}°)`;

  const visionChip = engineStatus === 'running' && visionState ? VISION_CHIP[visionState.phase] : undefined;
  const accuracy = Math.max(1, targetGrave.positionAccuracyMeters || 1);
  const numberLabel = graveNumberLabel(targetGrave);
  const pill =
    engineStatus === 'loading'
      ? 'Loading the AR engine…'
      : engineStatus === 'camera'
        ? 'Starting the camera…'
        : fix === null
          ? 'Getting your position…'
          : describeTracking(driverState, arrived, accuracy, compassStatus);

  return (
    <div className="flex-1 flex flex-col relative bg-black overflow-hidden select-none">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* Top bar, as on the sensor screen */}
      <div className="absolute top-0 inset-x-0 z-30 px-4 pt-3 pb-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between text-white">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/30 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5 stroke-[2.2]" />
        </button>
        <h1 onClick={onTitleTap} className="text-sm font-bold tracking-wide text-white drop-shadow">Approaching your destination</h1>
        <div className="w-9 h-9" aria-hidden="true" />
      </div>

      {visionDebug && visionState && <VisionDebugView state={visionState} />}

      {/* Distance badge */}
      <div className="absolute top-[22%] inset-x-0 z-20 flex justify-center pointer-events-none">
        <div className="bg-brand-dark/95 backdrop-blur-md border border-emerald-500/60 rounded-2xl py-2 px-5 shadow-2xl text-center text-white">
          <div className="text-xl font-extrabold text-white tracking-wide">{Math.round(distance)} m</div>
          <div className="text-xs text-emerald-300 font-semibold mt-0.5">{guidanceText}</div>
        </div>
      </div>

      {/* The instruction pill stacks above the card, so it stays clear however tall the card grows */}
      <div className="absolute bottom-10 inset-x-5 z-30 pointer-events-auto flex flex-col items-center space-y-3">
        {visionChip && (
          <div className={`flex items-center space-x-2 bg-black/60 backdrop-blur-md border rounded-full px-3 py-1 text-xs font-semibold pointer-events-none ${visionChip.tone}`} role="status">
            <span className={`w-2 h-2 rounded-full ${visionChip.dot}`} aria-hidden="true" />
            <span>{visionChip.text}</span>
          </div>
        )}
        <div className="max-w-[300px] bg-black/60 backdrop-blur-md border border-white/20 rounded-xl px-4 py-2 text-sm font-semibold text-white text-center pointer-events-none" role="status">
          {pill}
        </div>
        <div className="w-full bg-white/95 backdrop-blur-md rounded-2xl p-3 shadow-2xl border border-white/40">
          <div className="flex items-center space-x-3.5">
            <div className="w-14 h-14 rounded-xl overflow-hidden relative shrink-0 bg-slate-100 border border-slate-200">
              <Image src={targetGrave.primaryPhotoUrl || '/sample-gravestone.svg'} alt={targetGrave.person?.fullName || 'Target Grave'} fill className="object-cover" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xs font-bold text-slate-900 truncate">{targetGrave.person?.fullName || numberLabel || 'Grave'}</h2>
              {numberLabel && <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">{numberLabel}</div>}
              <div className="text-[10px] text-slate-500 truncate mt-0.5">{targetGrave.cemeteryName || 'Athlone Muslim Cemetery'}</div>
            </div>
          </div>
          {targetGrave.gravePhotoUrl && <LookForThisGrave url={targetGrave.gravePhotoUrl} />}
          {arrived && onConfirmVisit && <VisitConfirmButton grave={targetGrave} fix={fix} onConfirm={onConfirmVisit} />}
        </div>
      </div>

      {/* Required by the XR engine licence */}
      <div className="absolute bottom-0 inset-x-0 z-30 px-4 pb-2 text-[9px] text-white/50 text-center pointer-events-auto">
        {XR_ENGINE_NOTICE}{' '}
        <a href={XR_ENGINE_LICENSE_URL} className="underline" target="_blank" rel="noopener noreferrer">
          Licence
        </a>
      </div>
    </div>
  );
};
