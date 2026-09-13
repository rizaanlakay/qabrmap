'use client';

import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import {
  ArrowLeft,
  Zap,
  ZapOff,
  Grid,
  MapPin,
  Compass,
  Upload,
  RefreshCw,
} from 'lucide-react';
import { DeviceTelemetry } from '@/types';

interface CaptureScreenProps {
  onCaptureComplete: (imageDataUrl: string, telemetry: DeviceTelemetry) => void;
  onBack: () => void;
}

export const CaptureScreen: React.FC<CaptureScreenProps> = ({
  onCaptureComplete,
  onBack,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [hasStream, setHasStream] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [showGrid, setShowGrid] = useState(true);

  // Live telemetry matching mockup Screen 8
  const [lat, setLat] = useState(-33.967521);
  const [lng, setLng] = useState(18.503277);
  const [accuracy, setAccuracy] = useState(4.2);
  const [heading, setHeading] = useState(62);

  // Initialize camera
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
            setHasStream(true);
          }
        })
        .catch(() => {
          setHasStream(false);
        });
    }

    // Geolocation listener
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLat(Number(pos.coords.latitude.toFixed(6)));
          setLng(Number(pos.coords.longitude.toFixed(6)));
          setAccuracy(Number(pos.coords.accuracy.toFixed(1)));
        },
        () => {},
        { enableHighAccuracy: true }
      );
    }

    // Compass heading listener
    const handleOrientation = (e: DeviceOrientationEvent) => {
      // @ts-expect-error - webkitCompassHeading
      const h = e.webkitCompassHeading || (e.alpha ? 360 - e.alpha : null);
      if (h !== null) setHeading(Math.round(h));
    };

    if (typeof window !== 'undefined' && window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation);
    }

    return () => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      if (typeof window !== 'undefined') {
        window.removeEventListener('deviceorientation', handleOrientation);
      }
    };
  }, []);

  const handleTriggerShutter = () => {
    let capturedDataUrl = '/sample-gravestone.svg';

    if (videoRef.current && hasStream) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth || 640;
        canvas.height = videoRef.current.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          capturedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        }
      } catch {
        capturedDataUrl = '/sample-gravestone.svg';
      }
    }

    const telemetry: DeviceTelemetry = {
      latitude: lat,
      longitude: lng,
      gpsAccuracy: accuracy,
      headingDegrees: heading,
      timestamp: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    onCaptureComplete(capturedDataUrl, telemetry);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const telemetry: DeviceTelemetry = {
        latitude: lat,
        longitude: lng,
        gpsAccuracy: accuracy,
        headingDegrees: heading,
        timestamp: new Date().toISOString(),
      };
      onCaptureComplete(dataUrl, telemetry);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex-1 flex flex-col relative bg-black overflow-hidden select-none">
      {/* Hidden File Input for uploading cemetery photos directly */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="image/*"
        className="hidden"
      />

      {/* Camera Stream or Realistic Cemetery Gravestone Viewfinder */}
      {hasStream ? (
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 w-full h-full relative">
          <Image
            src="/sample-gravestone.svg"
            alt="Cemetery Gravestone"
            fill
            className="object-cover brightness-95"
          />
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

        <h1 className="text-sm font-bold tracking-tight text-white drop-shadow">
          Capture Grave
        </h1>

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
        {/* Rounded Green Target Reticle */}
        <div className="w-full max-w-[280px] aspect-[3/4] border-2 border-emerald-400/90 rounded-3xl relative shadow-[0_0_20px_rgba(16,185,129,0.3)]">
          {/* Corner Guides */}
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

        {/* Guidance Instruction Pill */}
        <div className="mt-4 bg-black/55 backdrop-blur-md text-white text-xs font-medium py-1.5 px-4 rounded-full border border-white/15">
          Position the gravestone in the frame
        </div>

        {/* Live Telemetry Pill matching Screen 8 */}
        <div className="mt-4 bg-black/75 backdrop-blur-md rounded-2xl py-2 px-4 border border-white/20 text-white text-[11px] space-y-1 shadow-xl">
          <div className="flex items-center space-x-1.5 text-emerald-300 font-mono">
            <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>{lat.toFixed(6)}, {lng.toFixed(6)}</span>
            <span className="text-white/60">± {accuracy} m</span>
          </div>
          <div className="flex items-center space-x-1.5 text-slate-200">
            <Compass className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Heading {heading}° NE</span>
          </div>
        </div>
      </div>

      {/* Bottom Shutter Controls matching Screen 8 */}
      <div className="h-28 bg-gradient-to-t from-black via-black/80 to-transparent flex items-center justify-around px-8 z-30 shrink-0 pb-3">
        {/* Recent Photo Thumbnail */}
        <div className="w-12 h-12 rounded-xl overflow-hidden relative border-2 border-white/40 bg-slate-800 shrink-0">
          <Image
            src="/sample-gravestone.svg"
            alt="Recent Thumbnail"
            fill
            className="object-cover"
          />
        </div>

        {/* Big Circular White Shutter Button */}
        <button
          onClick={handleTriggerShutter}
          className="w-18 h-18 rounded-full border-4 border-white flex items-center justify-center p-1 group active:scale-95 transition-transform"
          aria-label="Take Photo"
        >
          <div className="w-14 h-14 rounded-full bg-white group-hover:bg-emerald-100 transition-colors" />
        </button>

        {/* Upload Existing Photo Button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white hover:bg-white/30 transition-colors shrink-0"
          title="Upload Photo File"
          aria-label="Upload photo"
        >
          <Upload className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
