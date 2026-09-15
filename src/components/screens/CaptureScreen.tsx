'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Zap, ZapOff, Grid, MapPin, Compass, CameraOff, Loader2 } from 'lucide-react';
import { DeviceTelemetry } from '@/types';
import { formatBearingToCardinal } from '@/lib/geospatial';
import { isUsableGpsFix } from '@/lib/geospatial/routeProgress';
import { describeCameraError } from '@/lib/device/cameraErrors';
import { useCompassHeading } from '@/lib/device/useCompassHeading';
import { getCaptureReadiness } from '@/lib/capture/readiness';

interface CaptureScreenProps {
  onCaptureComplete: (imageDataUrl: string, telemetry: DeviceTelemetry) => void;
  onBack: () => void;
}

type CameraStatus = 'starting' | 'live' | 'unavailable';

interface PositionFix {
  lat: number;
  lng: number;
  accuracy: number;
}

// Photos only come from this camera, because each one records where it was taken and which way it faced
export const CaptureScreen: React.FC<CaptureScreenProps> = ({ onCaptureComplete, onBack }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flashOn, setFlashOn] = useState(false);
  const [showGrid, setShowGrid] = useState(true);

  // Real device readings; null until the device reports one
  const [fix, setFix] = useState<PositionFix | null>(null);
  const { heading, status: compassStatus, requestPermission } = useCompassHeading();

  // Start the rear camera. The <video> element is always mounted so the stream attaches the moment it arrives.
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

  // Keep the position current while the gravestone is being framed
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!isUsableGpsFix(pos.coords.latitude, pos.coords.longitude)) return;
        setFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const cameraLive = cameraStatus === 'live';
  const readiness = getCaptureReadiness({
    cameraLive,
    accuracyMeters: fix?.accuracy ?? null,
    heading,
    compassStatus,
  });

  const handleTriggerShutter = () => {
    const video = videoRef.current;
    if (!readiness.ready || !video || !fix || heading === null) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 960;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    onCaptureComplete(canvas.toDataURL('image/jpeg', 0.85), {
      latitude: fix.lat,
      longitude: fix.lng,
      gpsAccuracy: Number(fix.accuracy.toFixed(1)),
      headingDegrees: heading,
      timestamp: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      imageDimensions: { width: canvas.width, height: canvas.height },
    });
  };

  return (
    <div className="flex-1 flex flex-col relative bg-black overflow-hidden select-none">
      {/* Live camera feed, faded in once it is actually playing */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        onPlaying={() => setCameraStatus('live')}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
          cameraLive ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Camera starting or unavailable */}
      {!cameraLive && (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-10 flex flex-col items-center px-12 text-center pointer-events-none">
          {cameraStatus === 'starting' ? (
            <>
              <Loader2 className="w-7 h-7 text-white/70 animate-spin" />
              <p className="mt-3 text-sm font-semibold text-white/80">Starting camera…</p>
            </>
          ) : (
            <>
              <CameraOff className="w-7 h-7 text-amber-300" />
              <p className="mt-3 text-sm font-semibold text-white">{cameraError || 'Camera unavailable'}</p>
              <p className="mt-1 text-xs text-white/60">Allow camera access to map a grave.</p>
            </>
          )}
        </div>
      )}

      {/* Top Header matching Mockup Screen 8 */}
      <div className="absolute top-0 inset-x-0 z-30 px-4 pt-3 pb-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between text-white">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/30 transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>

        <h1 className="text-sm font-bold tracking-tight text-white drop-shadow">Capture Grave</h1>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setFlashOn(!flashOn)}
            className={`w-9 h-9 rounded-full backdrop-blur-md flex items-center justify-center transition-colors ${
              flashOn ? 'bg-amber-400 text-slate-900' : 'bg-white/20 text-white hover:bg-white/30'
            }`}
            aria-label="Flash"
          >
            {flashOn ? <Zap className="w-4 h-4 fill-current" /> : <ZapOff className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`w-9 h-9 rounded-full backdrop-blur-md flex items-center justify-center transition-colors ${
              showGrid ? 'bg-emerald-600 text-white' : 'bg-white/20 text-white hover:bg-white/30'
            }`}
            aria-label="Grid"
          >
            <Grid className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Viewfinder Bounding Reticle matching Screen 8 */}
      <div className="flex-1 relative flex flex-col items-center justify-center pointer-events-none z-20 px-8">
        <div className="w-full max-w-[280px] aspect-[3/4] border-2 border-emerald-400/90 rounded-3xl relative shadow-[0_0_20px_rgba(16,185,129,0.3)]">
          <div className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl" />
          <div className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl" />
          <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl" />
          <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-emerald-400 rounded-br-xl" />

          {showGrid && (
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-20 pointer-events-none">
              <div className="border-r border-b border-white" />
              <div className="border-r border-b border-white" />
              <div className="border-b border-white" />
              <div className="border-r border-b border-white" />
              <div className="border-r border-b border-white" />
              <div className="border-b border-white" />
              <div className="border-r border-white" />
              <div className="border-r border-white" />
              <div />
            </div>
          )}
        </div>

        {/* Guidance: names whatever is still stopping the shutter */}
        <div className="mt-4 bg-black/55 backdrop-blur-md text-white text-xs font-medium py-1.5 px-4 rounded-full border border-white/15">
          {readiness.message}
        </div>

        {compassStatus === 'needs-permission' && (
          <button
            onClick={requestPermission}
            className="mt-3 pointer-events-auto flex items-center space-x-1.5 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 text-xs font-bold py-2 px-4 rounded-full shadow-lg active:scale-95 transition-transform"
          >
            <Compass className="w-4 h-4" />
            <span>Enable compass</span>
          </button>
        )}

        {/* Live Telemetry Pill matching Screen 8 */}
        <div className="mt-4 bg-black/75 backdrop-blur-md rounded-2xl py-2 px-4 border border-white/20 text-white text-[11px] space-y-1 shadow-xl">
          <div className="flex items-center space-x-1.5 text-emerald-300 font-mono">
            <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            {fix ? (
              <>
                <span>
                  {fix.lat.toFixed(6)}, {fix.lng.toFixed(6)}
                </span>
                <span className="text-white/60">± {Math.round(fix.accuracy)} m</span>
              </>
            ) : (
              <span className="text-white/70 font-sans">Locating…</span>
            )}
          </div>
          <div className="flex items-center space-x-1.5 text-slate-200">
            <Compass className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>{heading !== null ? `Heading ${formatBearingToCardinal(heading)}` : 'No compass heading yet'}</span>
          </div>
        </div>
      </div>

      {/* Bottom Shutter Controls matching Screen 8 */}
      <div className="h-28 bg-gradient-to-t from-black via-black/80 to-transparent flex items-center justify-around px-8 z-30 shrink-0 pb-3">
        {/* Keeps the shutter centred */}
        <div className="w-12 h-12 shrink-0" aria-hidden="true" />

        <button
          onClick={handleTriggerShutter}
          disabled={!readiness.ready}
          className="w-18 h-18 rounded-full border-4 border-white flex items-center justify-center p-1 group active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100"
          aria-label="Take Photo"
          title={readiness.ready ? 'Take photo' : readiness.message}
        >
          <div className="w-14 h-14 rounded-full bg-white group-hover:bg-emerald-100 group-disabled:group-hover:bg-white transition-colors" />
        </button>

        <div className="w-12 h-12 shrink-0" aria-hidden="true" />
      </div>
    </div>
  );
};
