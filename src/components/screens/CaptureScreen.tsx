'use client';

import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, ArrowLeft, Check, Zap, ZapOff, Grid, MapPin, Compass, CameraOff, Loader2, Lock } from 'lucide-react';
import { Cemetery, DeviceTelemetry } from '@/types';
import { findCemeteryForLocation } from '@/lib/capture/cemeteryForLocation';
import { useWakeLock } from '@/lib/device/useWakeLock';
import { formatBearingToCardinal } from '@/lib/geospatial';
import { isUsableGpsFix } from '@/lib/geospatial/routeProgress';
import { describeCameraError } from '@/lib/device/cameraErrors';
import { useCompassHeading } from '@/lib/device/useCompassHeading';
import { getCaptureReadiness } from '@/lib/capture/readiness';
import { pruneFixes, smoothFixes, TimedFix } from '@/lib/capture/gpsFixes';

interface CaptureScreenProps {
  // single: one grave, read and confirmed straight away. survey: each photo is queued and the camera stays open.
  mode?: 'single' | 'survey';
  // gravePhotoDataUrl: a second photo of the whole grave, only after a low-accuracy capture in single mode
  onCaptureComplete: (imageDataUrl: string, telemetry: DeviceTelemetry, gravePhotoDataUrl?: string) => void | Promise<void>;
  onBack: () => void;
  // Survey mode only
  surveyCemetery?: Cemetery;
  cemeteries?: Cemetery[];
  queuedCount?: number;
}

type ShotState = 'idle' | 'storing' | 'queued' | 'failed';

type CameraStatus = 'starting' | 'live' | 'unavailable';

// stone: the usual gravestone shot. grave: the follow-up whole-grave shot after a low-accuracy capture.
type CaptureStep = 'stone' | 'grave';

// How long the accuracy blocker must persist before "Capture anyway" is offered
const CAPTURE_ANYWAY_AFTER_MS = 15_000;
const GRAVE_STEP_MESSAGE = 'Step back so the whole grave is in the frame. It helps visitors find the spot.';

// Photos only come from this camera, because each one records where it was taken and which way it faced
export const CaptureScreen: React.FC<CaptureScreenProps> = ({
  mode = 'single',
  onCaptureComplete,
  onBack,
  surveyCemetery,
  cemeteries = [],
  queuedCount = 0,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isSurvey = mode === 'survey';
  const [shot, setShot] = useState<ShotState>('idle');

  // A survey walks row after row, so the screen must not lock between photos
  useWakeLock(isSurvey);

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flashOn, setFlashOn] = useState(false);
  const [showGrid, setShowGrid] = useState(true);

  // Real device readings; null until the device reports one. The compass is always on here.
  const fixesRef = useRef<TimedFix[]>([]);
  const [fix, setFix] = useState<ReturnType<typeof smoothFixes>>(null);
  const [lowAccuracyAllowed, setLowAccuracyAllowed] = useState(false);
  const [offerCaptureAnyway, setOfferCaptureAnyway] = useState(false);
  const [step, setStep] = useState<CaptureStep>('stone');
  // The stone photo waiting for its whole-grave companion
  const pendingStoneRef = useRef<{ photo: string; telemetry: DeviceTelemetry } | null>(null);
  const { heading, status: compassStatus } = useCompassHeading();

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

  // Keep the position current while the gravestone is being framed. Fixes are smoothed over the last ten
  // seconds, so a single bad reading doesn't lock the shutter and standing still improves the position.
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!isUsableGpsFix(pos.coords.latitude, pos.coords.longitude)) return;
        const now = Date.now();
        fixesRef.current = pruneFixes(fixesRef.current, now);
        fixesRef.current.push({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: now });
        setFix(smoothFixes(fixesRef.current, now));
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const cameraLive = cameraStatus === 'live';
  const stoneReadiness = getCaptureReadiness({
    cameraLive,
    accuracyMeters: fix?.accuracy ?? null,
    heading,
    compassStatus,
    lowAccuracyAllowed,
  });
  // The whole-grave shot only needs the camera: its position and heading come from the stone shot
  const readiness =
    step === 'grave'
      ? {
          ready: cameraLive,
          blocker: cameraLive ? null : ('camera' as const),
          message: cameraLive ? GRAVE_STEP_MESSAGE : 'Camera is not available',
          canCaptureAnyway: false,
          lowAccuracy: false,
        }
      : stoneReadiness;

  // "Capture anyway" appears once the accuracy blocker has held for a while; a change of blocker restarts the wait
  useEffect(() => {
    if (readiness.blocker !== 'gps-accuracy') {
      setOfferCaptureAnyway(false);
      return;
    }
    const timer = window.setTimeout(() => setOfferCaptureAnyway(true), CAPTURE_ANYWAY_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [readiness.blocker]);

  const snapFrame = (): { photo: string; width: number; height: number } | null => {
    const video = videoRef.current;
    if (!video) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 960;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return { photo: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height };
  };

  const finishCapture = async (photo: string, telemetry: DeviceTelemetry, gravePhoto?: string) => {
    if (!isSurvey) {
      void onCaptureComplete(photo, telemetry, gravePhoto);
      return;
    }
    setShot('storing');
    try {
      await onCaptureComplete(photo, telemetry);
      setShot('queued');
    } catch {
      setShot('failed');
    }
  };

  const handleTriggerShutter = async () => {
    if (!readiness.ready || shot === 'storing') return;

    if (step === 'grave') {
      const pending = pendingStoneRef.current;
      const frame = snapFrame();
      if (!pending || !frame) return;
      pendingStoneRef.current = null;
      await finishCapture(pending.photo, pending.telemetry, frame.photo);
      return;
    }

    if (!fix || heading === null) return;
    const frame = snapFrame();
    if (!frame) return;
    const telemetry: DeviceTelemetry = {
      latitude: fix.lat,
      longitude: fix.lng,
      gpsAccuracy: Number(fix.accuracy.toFixed(1)),
      headingDegrees: heading,
      timestamp: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      imageDimensions: { width: frame.width, height: frame.height },
    };

    // A low-accuracy grave is harder to find again, so ask for a photo of the whole grave as a visual clue
    if (!isSurvey && readiness.lowAccuracy) {
      pendingStoneRef.current = { photo: frame.photo, telemetry };
      setStep('grave');
      return;
    }
    await finishCapture(frame.photo, telemetry);
  };

  const skipGravePhoto = () => {
    const pending = pendingStoneRef.current;
    if (!pending) return;
    pendingStoneRef.current = null;
    void finishCapture(pending.photo, pending.telemetry);
  };

  // "Queued" and the storage error clear themselves so the next photo starts clean
  useEffect(() => {
    if (shot !== 'queued' && shot !== 'failed') return;
    const timer = window.setTimeout(() => setShot('idle'), shot === 'queued' ? 1200 : 4000);
    return () => window.clearTimeout(timer);
  }, [shot]);

  const outsideSurveyCemetery =
    isSurvey && Boolean(fix) && Boolean(surveyCemetery) &&
    findCemeteryForLocation(cemeteries, fix!.lat, fix!.lng)?.id !== surveyCemetery!.id;

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
        {step === 'grave' ? (
          <button
            onClick={skipGravePhoto}
            className="h-9 px-3.5 rounded-full bg-white/20 backdrop-blur-md text-xs font-semibold hover:bg-white/30 transition-colors"
          >
            Skip
          </button>
        ) : isSurvey ? (
          <button
            onClick={onBack}
            className="h-9 px-3.5 rounded-full bg-white/20 backdrop-blur-md text-xs font-semibold hover:bg-white/30 transition-colors"
          >
            Done
          </button>
        ) : (
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/30 transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
          </button>
        )}

        <div className="min-w-0 px-2 text-center">
          <h1 className="text-sm font-bold tracking-tight text-white drop-shadow">
            {step === 'grave' ? 'Photograph the whole grave' : isSurvey ? 'Survey' : 'Capture Grave'}
          </h1>
          {isSurvey && surveyCemetery && <p className="text-[11px] text-white/70 truncate">{surveyCemetery.name}</p>}
        </div>

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
        <div
          className={`w-full border-2 border-emerald-400/90 rounded-3xl relative shadow-[0_0_20px_rgba(16,185,129,0.3)] ${
            step === 'grave' ? 'max-w-[340px] aspect-[4/3]' : 'max-w-[280px] aspect-[3/4]'
          }`}
        >
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
        <div
          role="status"
          className={`mt-4 backdrop-blur-md text-xs font-medium py-1.5 px-4 rounded-full border flex items-center ${
            shot === 'queued'
              ? 'bg-emerald-600/90 border-emerald-300/40 text-white'
              : shot === 'failed'
                ? 'bg-rose-600/90 border-rose-300/40 text-white'
                : 'bg-black/55 border-white/15 text-white'
          }`}
        >
          {shot === 'queued' ? (
            <>
              <Check className="w-3.5 h-3.5 mr-1.5" /> Queued
            </>
          ) : shot === 'failed' ? (
            "Couldn't store this photo on the phone"
          ) : shot === 'storing' ? (
            'Storing…'
          ) : (
            readiness.message
          )}
        </div>

        {offerCaptureAnyway && readiness.canCaptureAnyway && (
          <button
            onClick={() => setLowAccuracyAllowed(true)}
            className="mt-2 text-[11px] font-semibold text-amber-300 underline underline-offset-2 pointer-events-auto"
          >
            Capture anyway
          </button>
        )}

        {outsideSurveyCemetery && surveyCemetery && (
          <div className="mt-2 max-w-[280px] bg-amber-500/90 text-slate-900 text-[11px] font-semibold py-1.5 px-3 rounded-2xl flex items-start">
            <AlertTriangle className="w-3.5 h-3.5 mr-1.5 mt-px shrink-0" />
            <span>Outside {surveyCemetery.name}. Photos taken here will wait for review.</span>
          </div>
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
        {/* Survey mode shows how many photos are stored; otherwise this keeps the shutter centred */}
        <div className="w-12 h-12 shrink-0 flex flex-col items-center justify-center text-white" aria-live="polite">
          {isSurvey && (
            <>
              <span className="text-base font-bold leading-none">{queuedCount}</span>
              <span className="text-[10px] text-white/70">taken</span>
            </>
          )}
        </div>

        <button
          onClick={handleTriggerShutter}
          disabled={!readiness.ready || shot === 'storing'}
          className={`w-18 h-18 rounded-full border-4 flex items-center justify-center p-1 group active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100 ${
            readiness.lowAccuracy ? 'border-amber-400' : 'border-white'
          }`}
          aria-label="Take Photo"
          title={readiness.ready ? 'Take photo' : readiness.message}
        >
          <div className="w-14 h-14 rounded-full bg-white group-hover:bg-emerald-100 group-disabled:group-hover:bg-white transition-colors flex items-center justify-center">
            {readiness.blocker === 'gps-accuracy' && <Lock className="w-5 h-5 text-slate-500" aria-hidden="true" />}
          </div>
        </button>

        <div className="w-12 h-12 shrink-0" aria-hidden="true" />
      </div>
    </div>
  );
};
