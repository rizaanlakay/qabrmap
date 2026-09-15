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
import { pruneFixes, smoothFixes, TimedFix } from '@/lib/capture/gpsFixes';
import { smoothAngle, smoothValue } from '@/lib/ar/smoothing';
import { loadXR8, XR8Api, XR_ENGINE_LICENSE_URL, XR_ENGINE_NOTICE } from '@/lib/ar/xr8';
import { ARRIVED_M, createSceneDriver, DriverState } from '@/lib/ar/sceneDriver';
import type { VisitFix } from '@/lib/graves/visits';
import { VisitConfirmButton } from '@/components/common/VisitConfirmButton';
import { LookForThisGrave } from '@/components/common/LookForThisGrave';

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

function describeMissingHeading(status: CompassStatus): string {
  if (status === 'needs-permission') return 'Tap the screen to start the compass';
  if (status === 'denied') return 'Allow motion access for this site in Settings';
  if (status === 'unsupported') return 'Compass not available on this device';
  return 'Waiting for compass…';
}

// What the status pill says for each stage of tracking
function describeTracking(state: DriverState, arrived: boolean, accuracy: number): string {
  if (state.tracking === 'initialising') return 'Move the phone slowly sideways so it can find the floor';
  if (state.tracking === 'limited') return 'Tracking is limited. Point at the ground and move slowly';
  if (!state.aligned) return 'Waiting for the compass…';
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
  const [engineStatus, setEngineStatus] = useState<'loading' | 'camera' | 'running'>('loading');
  const [driverState, setDriverState] = useState<DriverState>({ tracking: 'initialising', floorMeasured: false, aligned: false });
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
  const [fix, setFix] = useState<VisitFix | null>(null);
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
  const arrived = distance <= ARRIVED_M;

  // Feed the scene: the grave from each fix, the compass whenever it changes
  useEffect(() => {
    if (here) driverRef.current?.setTarget({ bearingDeg: rawBearing, distanceM: rawDistance });
  }, [here, rawBearing, rawDistance]);
  useEffect(() => {
    driverRef.current?.setHeading(phoneHeading);
  }, [phoneHeading]);

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
        onFallbackRef.current(err instanceof Error ? err.message : 'engine-load');
        return;
      }
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      engine = XR8;
      // The engine sizes its buffer and inline style from the canvas attributes, so they must match the screen
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
      driver.setHeading(phoneHeading);

      try {
        XR8.XrController.configure({ scale: 'absolute', disableWorldTracking: false });
        XR8.addCameraPipelineModules([
          XR8.XrController.pipelineModule(),
          XR8.GlTextureRenderer.pipelineModule(),
          XR8.Threejs.pipelineModule(),
          {
            name: 'qabrmap-screen',
            onStart: () => {
              fitCanvas();
              setEngineStatus('running');
            },
            onCameraStatusChange: ({ status }) => {
              if (status === 'requesting') setEngineStatus('camera');
              if (status === 'failed') onFallbackRef.current('camera');
            },
            onException: (error) => onFallbackRef.current(error instanceof Error ? error.message : 'engine'),
          },
          driver.pipelineModule,
        ]);
        XR8.run({ canvas, allowedDevices: XR8.XrConfig.device().ANY });
      } catch (err) {
        onFallbackRef.current(err instanceof Error ? err.message : 'engine-start');
      }
    };
    void start();

    return () => {
      cancelled = true;
      if (onResize) window.removeEventListener('resize', onResize);
      driverRef.current?.dispose();
      driverRef.current = null;
      try {
        engine?.stop();
      } catch {
        // An engine that never started has nothing to stop
      }
    };
    // The heading is fed through setHeading above; the engine must not restart when it changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let guidanceText = 'Keep straight';
  const diffAngle = heading === null ? 0 : ((bearing - heading + 540) % 360) - 180;
  if (arrived) guidanceText = 'You are at the grave';
  else if (heading === null) guidanceText = describeMissingHeading(compassStatus);
  else if (Math.abs(diffAngle) > 120) guidanceText = 'Turn Around';
  else if (diffAngle > 35) guidanceText = `Turn Right (${Math.round(diffAngle)}°)`;
  else if (diffAngle < -35) guidanceText = `Turn Left (${Math.abs(Math.round(diffAngle))}°)`;

  const accuracy = Math.max(1, targetGrave.positionAccuracyMeters || 1);
  const numberLabel = graveNumberLabel(targetGrave);
  const pill =
    engineStatus === 'loading'
      ? 'Loading the AR engine…'
      : engineStatus === 'camera'
        ? 'Starting the camera…'
        : describeTracking(driverState, arrived, accuracy);

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
        <h1 className="text-sm font-bold tracking-wide text-white drop-shadow">Approaching your destination</h1>
        <div className="w-9 h-9" aria-hidden="true" />
      </div>

      {/* Distance badge */}
      <div className="absolute top-[22%] inset-x-0 z-20 flex justify-center pointer-events-none">
        <div className="bg-brand-dark/95 backdrop-blur-md border border-emerald-500/60 rounded-2xl py-2 px-5 shadow-2xl text-center text-white">
          <div className="text-xl font-extrabold text-white tracking-wide">{Math.round(distance)} m</div>
          <div className="text-xs text-emerald-300 font-semibold mt-0.5">{guidanceText}</div>
        </div>
      </div>

      {/* What to do right now */}
      <div className="absolute inset-x-0 bottom-36 z-30 flex justify-center pointer-events-none px-6">
        <div className="max-w-[300px] bg-black/60 backdrop-blur-md border border-white/20 rounded-xl px-4 py-2 text-sm font-semibold text-white text-center" role="status">
          {pill}
        </div>
      </div>

      {/* Grave card */}
      <div className="absolute bottom-10 inset-x-5 z-30 pointer-events-auto">
        <div className="bg-white/95 backdrop-blur-md rounded-2xl p-3 shadow-2xl border border-white/40">
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
