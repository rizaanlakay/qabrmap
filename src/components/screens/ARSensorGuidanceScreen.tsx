'use client';

import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import Image from 'next/image';
import { X, MapPin, ArrowUp } from 'lucide-react';
import { Grave } from '@/types';
import { calculateDistanceMeters, calculateBearing } from '@/lib/geospatial';
import { isUsableGpsFix } from '@/lib/geospatial/routeProgress';
import { useWakeLock } from '@/lib/device/useWakeLock';
import { useCompassHeading } from '@/lib/device/useCompassHeading';
import type { CompassStatus } from '@/lib/device/compass';
import { graveNumberLabel } from '@/lib/ui/graveLabels';
import { pruneFixes, smoothFixes, TimedFix } from '@/lib/capture/gpsFixes';
import { projectGroundTarget } from '@/lib/ar/markerProjection';
import { smoothAngle, smoothValue } from '@/lib/ar/smoothing';
import type { VisitFix } from '@/lib/graves/visits';
import { VisitConfirmButton } from '@/components/common/VisitConfirmButton';
import { LookForThisGrave } from '@/components/common/LookForThisGrave';

export interface ARSensorGuidanceScreenProps {
  targetGrave: Grave;
  userLocation?: { lat: number; lng: number };
  distanceMeters?: number;
  // Hands the screen's own fixes back to the page, so navigation resumes where AR left off
  onUpdateUserLocation?: (loc: { lat: number; lng: number }) => void;
  onClose: () => void;
  // Present only for signed-in users; records "I found it" as a position observation
  onConfirmVisit?: (grave: Grave, fix: VisitFix) => Promise<Grave>;
  // Why the tracked AR screen handed over to this one; shown so a phone test can report it
  fallbackNote?: string;
}

type CameraStatus = 'starting' | 'live' | 'unavailable';

// Chevrons travelling along the ground path at any moment, and seconds for one to cross it
const CHEVRON_COUNT = 6;
const CHEVRON_CYCLE_S = 3.6;
// Clamp so the path never swings behind the camera
const MAX_PATH_TURN_DEG = 60;
// Within this the marker is treated as reached: GPS can't place it more finely than that
const ARRIVED_M = 5;
// The pin on the line sits at the far end beyond this distance, and slides toward the viewer as the walk ends
const PIN_FAR_M = 25;
// Pin height along the 720 px ground plane, measured from its near edge
const PIN_NEAR_PX = 260;
const PIN_FAR_PX = 600;
// Pin size on the line: full size at the spot, shrinking toward the far end
const LINE_PIN_MAX_SCALE = 1.4;
const LINE_PIN_MIN_SCALE = 0.6;
// Sensor smoothing: quick while walking, slower when close so the marker settles instead of dancing
const ALPHA_ORIENTATION = 0.25;
const ALPHA_POSITION = 0.3;
const ALPHA_SETTLED = 0.1;

function describeCameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') return 'Camera permission denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found';
  if (name === 'NotReadableError') return 'Camera is in use by another app';
  return 'Camera unavailable';
}

// Shown instead of turn directions until the compass reports a heading
function describeMissingHeading(status: CompassStatus): string {
  if (status === 'needs-permission') return 'Tap the screen to start the compass';
  if (status === 'denied') return 'Allow motion access for this site in Settings';
  if (status === 'unsupported') return 'Compass not available on this device';
  return 'Waiting for compass…';
}

export const ARSensorGuidanceScreen: React.FC<ARSensorGuidanceScreenProps> = ({
  targetGrave,
  userLocation,
  distanceMeters: initialDistance = 8,
  onUpdateUserLocation,
  onClose,
  onConfirmVisit,
  fallbackNote,
}) => {
  // Keep mobile screen awake while using AR camera guidance
  useWakeLock(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  // The same always-on, true-north compass Capture saves with every grave, so it can't be switched off or faked
  const { heading: phoneHeading, pitch: phonePitch, status: compassStatus } = useCompassHeading();

  // Latest location callback, read through a ref so a new function from the parent can't restart the GPS watch
  const onUpdateUserLocationRef = useRef(onUpdateUserLocation);
  useEffect(() => {
    onUpdateUserLocationRef.current = onUpdateUserLocation;
  }, [onUpdateUserLocation]);

  // Own GPS watch: the navigation screen's watch stops while this screen is open
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
  const rawBearing = here ? calculateBearing(here.lat, here.lng, targetGrave.latitude, targetGrave.longitude) : 62;

  // Smoothed readings. Orientation arrives many times a second, GPS about once, so each eases at its own rate.
  const [liveDistance, setLiveDistance] = useState<number | null>(null);
  const [targetBearing, setTargetBearing] = useState<number | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [pitch, setPitch] = useState<number | null>(null);
  const settled = (liveDistance ?? rawDistance) <= ARRIVED_M;
  const alphaPosition = settled ? ALPHA_SETTLED : ALPHA_POSITION;
  const alphaOrientation = settled ? ALPHA_SETTLED : ALPHA_ORIENTATION;

  useEffect(() => {
    setLiveDistance((prev) => smoothValue(prev, rawDistance, alphaPosition));
    setTargetBearing((prev) => smoothAngle(prev, rawBearing, alphaPosition));
  }, [rawDistance, rawBearing, alphaPosition]);

  useEffect(() => {
    if (phoneHeading !== null) setHeading((prev) => smoothAngle(prev, phoneHeading, alphaOrientation));
  }, [phoneHeading, alphaOrientation]);

  useEffect(() => {
    if (phonePitch !== null) setPitch((prev) => smoothValue(prev, phonePitch, alphaOrientation));
  }, [phonePitch, alphaOrientation]);

  const distance = liveDistance ?? rawDistance;
  const bearing = targetBearing ?? rawBearing;

  // Relative angle between where the phone points and the grave; the path stays straight until the compass reports
  const diffAngle = heading === null ? 0 : ((bearing - heading + 540) % 360) - 180; // -180 to +180
  const arrived = distance <= ARRIVED_M;

  let guidanceText = 'Keep straight';
  if (arrived) {
    guidanceText = 'You are at the grave';
  } else if (heading === null) {
    guidanceText = describeMissingHeading(compassStatus);
  } else if (Math.abs(diffAngle) > 120) {
    guidanceText = 'Turn Around';
  } else if (diffAngle > 35) {
    guidanceText = `Turn Right (${Math.round(diffAngle)}°)`;
  } else if (diffAngle < -35) {
    guidanceText = `Turn Left (${Math.abs(Math.round(diffAngle))}°)`;
  }

  const pathTurn = Math.max(-MAX_PATH_TURN_DEG, Math.min(MAX_PATH_TURN_DEG, diffAngle));

  // Viewport size for the projection; the container fills the screen
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 390, height: 780 });
  useLayoutEffect(() => {
    const measure = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) setViewport({ width: rect.width, height: rect.height });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Without a compass the marker sits straight ahead, which is what the chevron path shows too
  const marker = projectGroundTarget({
    bearingDiffDeg: diffAngle,
    pitchDeg: pitch ?? 0,
    distanceM: distance,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  });
  const accuracy = Math.max(1, targetGrave.positionAccuracyMeters || 1);
  // The line is the guide while walking; the marker and ring only take over once the person is at the spot
  const caption = arrived ? `± ${accuracy} m. Not the right name? Look around this spot.` : 'Follow the line';
  // Where the pin stands along the line: near the far end when the grave is far, closer as the walk ends
  const pinAlong = Math.min(1, Math.max(0, (distance - ARRIVED_M) / PIN_FAR_M));
  const pinBottom = PIN_NEAR_PX + pinAlong * (PIN_FAR_PX - PIN_NEAR_PX);
  // The pin shrinks as the grave gets further away, on top of the plane's own perspective
  const linePinScale = Math.min(LINE_PIN_MAX_SCALE, Math.max(LINE_PIN_MIN_SCALE, LINE_PIN_MAX_SCALE - (distance - ARRIVED_M) / 40));

  // Start the rear camera. The <video> element is always mounted so the stream
  // can be attached as soon as permission is granted.
  useEffect(() => {
    const video = videoRef.current;
    let cancelled = false;
    let stream: MediaStream | null = null;

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(window.isSecureContext ? 'Camera not supported in this browser' : 'Camera requires HTTPS');
      setCameraStatus('unavailable');
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        if (video) {
          video.srcObject = s;
          video.play().catch(() => {});
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCameraError(describeCameraError(err));
        setCameraStatus('unavailable');
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, []);

  const cameraLive = cameraStatus === 'live';
  const numberLabel = graveNumberLabel(targetGrave);

  return (
    <div ref={containerRef} className="flex-1 flex flex-col relative bg-black overflow-hidden select-none">
      {/* Fallback preview while the camera starts or when it is unavailable */}
      {!cameraLive && (
        <div className="absolute inset-0 overflow-hidden">
          <Image
            src="/sample-gravestone.svg"
            alt="AR View"
            fill
            className="object-cover scale-110 filter blur-[1px] brightness-75"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60" />
        </div>
      )}

      {/* Live camera feed */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        onPlaying={() => setCameraStatus('live')}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
          cameraLive ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Top Bar matching Mockup Screen 7 */}
      <div className="absolute top-0 inset-x-0 z-30 px-4 pt-3 pb-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between text-white">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/30 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5 stroke-[2.2]" />
        </button>

        <div className="flex flex-col items-center">
          <h1 className="text-sm font-bold tracking-wide text-white drop-shadow">
            Approaching your destination
          </h1>
          {cameraStatus === 'unavailable' && cameraError && (
            <span className="mt-1 px-2 py-0.5 rounded-full bg-black/50 text-[10px] font-semibold text-amber-200">
              {cameraError}
            </span>
          )}
          {fallbackNote && (
            <span className="mt-1 px-2 py-0.5 rounded-full bg-black/50 text-[10px] font-semibold text-amber-200">
              Simple AR: {fallbackNote}
            </span>
          )}
        </div>

        {/* Keeps the title centred now that there is no compass button */}
        <div className="w-9 h-9" aria-hidden="true" />
      </div>

      {/* 3D ground path: a plane tilted away from the viewer, turned toward the target */}
      <div
        className="absolute inset-0 z-10 pointer-events-none overflow-hidden"
        style={{ perspective: '600px', perspectiveOrigin: '50% 35%' }}
      >
        <div
          className="absolute left-1/2 bottom-24 w-44 h-[720px] transition-transform duration-500 ease-out"
          style={{
            transform: `translateX(-50%) rotateX(66deg) rotateZ(${pathTurn}deg)`,
            transformOrigin: '50% 100%',
            // Lets the pin below counter-rotate and stand upright on the tilted plane
            transformStyle: 'preserve-3d',
          }}
        >
          {!arrived && (
            <>
              <div className="absolute inset-x-6 inset-y-0 rounded-t-full bg-gradient-to-t from-emerald-400/35 via-emerald-400/10 to-transparent" />
              {/* The destination pin stands on the line where the walk ends */}
              <div
                className="absolute left-1/2"
                style={{ bottom: pinBottom, transform: `translateX(-50%) rotateX(-66deg) scale(${linePinScale})`, transformOrigin: '50% 100%' }}
              >
                <div className="animate-ar-marker">
                  <MapPin className="w-28 h-28 text-emerald-400 fill-emerald-500/70 drop-shadow-[0_6px_12px_rgba(0,0,0,0.6)]" strokeWidth={1.5} />
                </div>
              </div>
              {Array.from({ length: CHEVRON_COUNT }, (_, i) => (
                <svg
                  key={i}
                  viewBox="0 0 120 80"
                  className="ar-chevron absolute left-1/2 bottom-0 w-[150px] text-emerald-400"
                  style={{
                    animationDuration: `${CHEVRON_CYCLE_S}s`,
                    animationDelay: `${-(i * CHEVRON_CYCLE_S) / CHEVRON_COUNT}s`,
                  }}
                  aria-hidden="true"
                >
                  <polyline
                    points="14,66 60,20 106,66"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="24"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ))}
            </>
          )}
        </div>
      </div>

      {/* At the spot the line stops and the marker takes over: placed from compass, tilt and distance, so it can be a
          few metres out, which is what the pill under it says */}
      {arrived && (
        <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden" aria-hidden="true">
          {marker.onScreen ? (
            <div className="absolute" style={{ left: marker.x, top: marker.y }}>
              {/* The pin stands on the ground point. Scale sits on this wrapper because the bounce owns transform inside */}
              <div
                className="absolute left-0 bottom-0"
                style={{ transform: `translateX(-50%) scale(${marker.scale})`, transformOrigin: '50% 100%' }}
              >
                <div className="animate-ar-marker">
                  <MapPin className="w-24 h-24 text-emerald-400 fill-emerald-500/70 drop-shadow-[0_6px_12px_rgba(0,0,0,0.6)]" strokeWidth={1.5} />
                </div>
              </div>
            </div>
          ) : (
            <div
              className="absolute left-1/2 top-1/2 w-36 h-36 flex items-start justify-center"
              style={{ marginLeft: -72, marginTop: -72, transform: `rotate(${marker.edgeAngleDeg + 90}deg)` }}
            >
              <ArrowUp className="w-10 h-10 text-emerald-400 drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)]" strokeWidth={2.5} />
            </div>
          )}
        </div>
      )}

      {/* Floating Distance Badge matching Screen 7 */}
      <div className="absolute top-[22%] inset-x-0 z-20 flex justify-center pointer-events-none">
        <div className="bg-brand-dark/95 backdrop-blur-md border border-emerald-500/60 rounded-2xl py-2 px-5 shadow-2xl text-center text-white">
          <div className="text-xl font-extrabold text-white tracking-wide">
            {Math.round(distance)} m
          </div>
          <div className="text-xs text-emerald-300 font-semibold mt-0.5">
            {guidanceText}
          </div>
        </div>
      </div>

      {/* The instruction pill stacks above the card, so it stays clear however tall the card grows */}
      <div className="absolute bottom-6 inset-x-5 z-30 pointer-events-auto flex flex-col items-center space-y-3">
        <div className="max-w-[300px] bg-black/60 backdrop-blur-md border border-white/20 rounded-xl px-4 py-2 text-sm font-semibold text-white text-center pointer-events-none" role="status">
          {caption}
        </div>
        <div className="w-full bg-white/95 backdrop-blur-md rounded-2xl p-3 shadow-2xl border border-white/40">
          <div className="flex items-center space-x-3.5">
            <div className="w-14 h-14 rounded-xl overflow-hidden relative shrink-0 bg-slate-100 border border-slate-200">
              <Image
                src={targetGrave.primaryPhotoUrl || '/sample-gravestone.svg'}
                alt={targetGrave.person?.fullName || 'Target Grave'}
                fill
                className="object-cover"
              />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xs font-bold text-slate-900 truncate">
                {targetGrave.person?.fullName || numberLabel || 'Grave'}
              </h2>
              {numberLabel && (
                <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">{numberLabel}</div>
              )}
              <div className="text-[10px] text-slate-500 truncate mt-0.5">
                {targetGrave.cemeteryName || 'Athlone Muslim Cemetery'}
              </div>
            </div>
          </div>
          {targetGrave.gravePhotoUrl && <LookForThisGrave url={targetGrave.gravePhotoUrl} />}
          {arrived && onConfirmVisit && <VisitConfirmButton grave={targetGrave} fix={fix} onConfirm={onConfirmVisit} />}
        </div>
      </div>
    </div>
  );
};
