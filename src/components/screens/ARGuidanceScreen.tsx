'use client';

import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { X } from 'lucide-react';
import { Grave } from '@/types';
import { calculateDistanceMeters, calculateBearing } from '@/lib/geospatial';
import { useWakeLock } from '@/lib/device/useWakeLock';
import { useCompassHeading } from '@/lib/device/useCompassHeading';
import type { CompassStatus } from '@/lib/device/compass';
import { graveNumberLabel } from '@/lib/ui/graveLabels';

interface ARGuidanceScreenProps {
  targetGrave: Grave;
  userLocation?: { lat: number; lng: number };
  distanceMeters?: number;
  onClose: () => void;
}

type CameraStatus = 'starting' | 'live' | 'unavailable';

// Chevrons travelling along the ground path at any moment, and seconds for one to cross it
const CHEVRON_COUNT = 6;
const CHEVRON_CYCLE_S = 3.6;
// Clamp so the path never swings behind the camera
const MAX_PATH_TURN_DEG = 60;

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

export const ARGuidanceScreen: React.FC<ARGuidanceScreenProps> = ({
  targetGrave,
  userLocation,
  distanceMeters: initialDistance = 8,
  onClose,
}) => {
  // Keep mobile screen awake while using AR camera guidance
  useWakeLock(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  // The same always-on, true-north compass Capture saves with every grave, so it can't be switched off or faked
  const { heading: phoneHeading, status: compassStatus } = useCompassHeading();

  // Compute live distance and bearing if user location provided
  const liveDistance = userLocation
    ? calculateDistanceMeters(userLocation.lat, userLocation.lng, targetGrave.latitude, targetGrave.longitude)
    : initialDistance;

  const targetBearing = userLocation
    ? calculateBearing(userLocation.lat, userLocation.lng, targetGrave.latitude, targetGrave.longitude)
    : 62;

  // Relative angle between where the phone points and the grave; the path stays straight until the compass reports
  const diffAngle = phoneHeading === null ? 0 : ((targetBearing - phoneHeading + 540) % 360) - 180; // -180 to +180
  const arrived = liveDistance <= 3;

  let guidanceText = 'Keep straight';
  if (arrived) {
    guidanceText = 'Arrived at Grave Area';
  } else if (phoneHeading === null) {
    guidanceText = describeMissingHeading(compassStatus);
  } else if (Math.abs(diffAngle) > 120) {
    guidanceText = 'Turn Around';
  } else if (diffAngle > 35) {
    guidanceText = `Turn Right (${Math.round(diffAngle)}°)`;
  } else if (diffAngle < -35) {
    guidanceText = `Turn Left (${Math.abs(Math.round(diffAngle))}°)`;
  }

  const pathTurn = Math.max(-MAX_PATH_TURN_DEG, Math.min(MAX_PATH_TURN_DEG, diffAngle));

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
    <div className="flex-1 flex flex-col relative bg-black overflow-hidden select-none">
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
          }}
        >
          {arrived ? (
            <div className="absolute left-1/2 bottom-32 -ml-14 w-28 h-28 rounded-full border-4 border-emerald-300 bg-emerald-400/30 animate-radar" />
          ) : (
            <>
              <div className="absolute inset-x-6 inset-y-0 rounded-t-full bg-gradient-to-t from-emerald-400/35 via-emerald-400/10 to-transparent" />
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

      {/* Floating Distance Badge matching Screen 7 */}
      <div className="absolute top-[22%] inset-x-0 z-20 flex justify-center pointer-events-none">
        <div className="bg-brand-dark/95 backdrop-blur-md border border-emerald-500/60 rounded-2xl py-2 px-5 shadow-2xl text-center text-white">
          <div className="text-xl font-extrabold text-white tracking-wide">
            {Math.round(liveDistance)} m
          </div>
          <div className="text-xs text-emerald-300 font-semibold mt-0.5">
            {guidanceText}
          </div>
        </div>
      </div>

      {/* Bottom Floating Target Gravestone Card matching Screen 7 */}
      <div className="absolute bottom-6 inset-x-5 z-30 pointer-events-auto">
        <div className="bg-white/95 backdrop-blur-md rounded-2xl p-3 shadow-2xl border border-white/40 flex items-center space-x-3.5">
          {/* Target Gravestone Photo Thumbnail */}
          <div className="w-14 h-14 rounded-xl overflow-hidden relative shrink-0 bg-slate-100 border border-slate-200">
            <Image
              src={targetGrave.primaryPhotoUrl || '/sample-gravestone.svg'}
              alt={targetGrave.person?.fullName || 'Target Grave'}
              fill
              className="object-cover"
            />
          </div>

          {/* Details */}
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
      </div>
    </div>
  );
};
