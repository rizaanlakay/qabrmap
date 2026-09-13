'use client';

import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { X, ChevronUp, Compass } from 'lucide-react';
import { Grave } from '@/types';
import { calculateDistanceMeters, calculateBearing } from '@/lib/geospatial';
import { useWakeLock } from '@/lib/device/useWakeLock';

interface ARGuidanceScreenProps {
  targetGrave: Grave;
  userLocation?: { lat: number; lng: number };
  distanceMeters?: number;
  onClose: () => void;
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
  const [hasCameraStream, setHasCameraStream] = useState(false);
  const [phoneHeading, setPhoneHeading] = useState(62);

  // Compute live distance and bearing if user location provided
  const liveDistance = userLocation
    ? calculateDistanceMeters(userLocation.lat, userLocation.lng, targetGrave.latitude, targetGrave.longitude)
    : initialDistance;

  const targetBearing = userLocation
    ? calculateBearing(userLocation.lat, userLocation.lng, targetGrave.latitude, targetGrave.longitude)
    : 62;

  // Calculate relative angle difference between phone heading and target bearing
  const diffAngle = ((targetBearing - phoneHeading + 540) % 360) - 180; // -180 to +180

  let guidanceText = 'Keep straight';
  let chevronRotation = 0;

  if (liveDistance <= 3) {
    guidanceText = 'Arrived at Grave Area';
  } else if (diffAngle > 35) {
    guidanceText = `Turn Right (${Math.abs(Math.round(diffAngle))}°)`;
    chevronRotation = Math.min(45, diffAngle);
  } else if (diffAngle < -35) {
    guidanceText = `Turn Left (${Math.abs(Math.round(diffAngle))}°)`;
    chevronRotation = Math.max(-45, diffAngle);
  } else if (Math.abs(diffAngle) > 120) {
    guidanceText = 'Turn Around';
    chevronRotation = 180;
  }

  // Initialize hardware camera stream if supported
  useEffect(() => {
    let stream: MediaStream | null = null;
    if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        .then((s) => {
          stream = s;
          if (videoRef.current) {
            videoRef.current.srcObject = s;
            videoRef.current.play().catch(() => {});
            setHasCameraStream(true);
          }
        })
        .catch(() => {
          setHasCameraStream(false);
        });
    }

    // Compass listener
    const handleOrientation = (e: DeviceOrientationEvent) => {
      // @ts-expect-error - webkitCompassHeading
      const h = e.webkitCompassHeading || (e.alpha ? 360 - e.alpha : null);
      if (h !== null) setPhoneHeading(Math.round(h));
    };

    if (typeof window !== 'undefined' && window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation);
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('deviceorientation', handleOrientation);
      }
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col relative bg-black overflow-hidden select-none">
      {/* Background Camera Feed or Realistic Cemetery Photogrammetry View */}
      {hasCameraStream ? (
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 w-full h-full relative overflow-hidden">
          <Image
            src="/sample-gravestone.svg"
            alt="AR View"
            fill
            className="object-cover scale-110 filter blur-[1px] brightness-75"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60" />
        </div>
      )}

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
        </div>

        <button
          onClick={() => setPhoneHeading((h) => (h + 30) % 360)}
          className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/30"
          title="Simulate heading rotate"
        >
          <Compass className="w-4 h-4 text-emerald-400" />
        </button>
      </div>

      {/* AR Overlays Layer (3D perspective ground arrows and floating HUD) */}
      <div className="flex-1 relative flex flex-col items-center justify-center pointer-events-none z-20">
        {/* Floating Distance Badge matching Screen 7 */}
        <div className="mb-8 transform -translate-y-6">
          <div className="bg-brand-dark/95 backdrop-blur-md border border-emerald-500/60 rounded-2xl py-2 px-5 shadow-2xl text-center text-white">
            <div className="text-xl font-extrabold text-white tracking-wide">
              {Math.round(liveDistance)} m
            </div>
            <div className="text-xs text-emerald-300 font-semibold mt-0.5">
              {guidanceText}
            </div>
          </div>
        </div>

        {/* Dynamic 3D Ground Perspective Chevrons Pointing Toward Destination */}
        <div
          style={{ transform: `rotate(${chevronRotation}deg)` }}
          className="flex flex-col items-center space-y-2.5 opacity-95 transition-transform duration-300 ease-out"
        >
          {/* Distant chevron */}
          <div className="text-emerald-400 transform scale-75 opacity-60">
            <ChevronUp className="w-12 h-12 stroke-[4]" />
          </div>
          {/* Midground chevron */}
          <div className="text-emerald-400 transform scale-100 opacity-80">
            <ChevronUp className="w-14 h-14 stroke-[4]" />
          </div>
          {/* Foreground chevron */}
          <div className="text-emerald-300 transform scale-125 drop-shadow-[0_0_15px_rgba(16,185,129,0.9)] animate-pulse">
            <ChevronUp className="w-16 h-16 stroke-[4]" />
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
              {targetGrave.person?.fullName || 'Grave'}
            </h2>
            <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">
              Grave {targetGrave.graveNumber}
            </div>
            <div className="text-[10px] text-slate-500 truncate mt-0.5">
              {targetGrave.cemeteryName || 'Athlone Muslim Cemetery'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
