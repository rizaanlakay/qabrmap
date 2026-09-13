'use client';

import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Compass,
  Crosshair,
  Footprints,
  Eye,
  CheckCircle2,
} from 'lucide-react';
import { Grave } from '@/types';
import {
  calculateDistanceMeters,
  calculateBearing,
  formatBearingToCardinal,
} from '@/lib/geospatial';

interface NavigationScreenProps {
  targetGrave: Grave;
  userLocation: { lat: number; lng: number };
  onUpdateUserLocation?: (loc: { lat: number; lng: number }) => void;
  onOpenARGuidance: () => void;
  onEndNavigation: () => void;
  onBack: () => void;
}

export const NavigationScreen: React.FC<NavigationScreenProps> = ({
  targetGrave,
  userLocation: initialUserLoc,
  onUpdateUserLocation,
  onOpenARGuidance,
  onEndNavigation,
  onBack,
}) => {
  // Current user GPS in simulation or real device
  const [currentLoc, setCurrentLoc] = useState(initialUserLoc);
  const [headingDeg, setHeadingDeg] = useState(42);

  // Compute live distance and bearing
  const distance = calculateDistanceMeters(
    currentLoc.lat,
    currentLoc.lng,
    targetGrave.latitude,
    targetGrave.longitude
  );
  const bearing = calculateBearing(
    currentLoc.lat,
    currentLoc.lng,
    targetGrave.latitude,
    targetGrave.longitude
  );
  const cardinal = formatBearingToCardinal(bearing);

  // Estimated walk time (assume average walking speed ~1.2 m/s)
  const walkTimeMinutes = Math.max(1, Math.round(distance / 70));

  // Device orientation listener when available on phone
  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      // @ts-expect-error - webkitCompassHeading for iOS Safari
      const compassHeading = e.webkitCompassHeading || (e.alpha ? 360 - e.alpha : null);
      if (compassHeading !== null) {
        setHeadingDeg(Math.round(compassHeading));
      }
    };

    if (typeof window !== 'undefined' && window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('deviceorientation', handleOrientation);
      }
    };
  }, []);

  // Step closer simulator (for testing)
  const stepCloser = () => {
    const stepRatio = 0.25; // Walk 25% closer per tap
    const newLat = currentLoc.lat + (targetGrave.latitude - currentLoc.lat) * stepRatio;
    const newLng = currentLoc.lng + (targetGrave.longitude - currentLoc.lng) * stepRatio;
    const next = { lat: newLat, lng: newLng };
    setCurrentLoc(next);
    if (onUpdateUserLocation) onUpdateUserLocation(next);
  };

  // Map Screen coordinates calculation
  const centerLat = (currentLoc.lat + targetGrave.latitude) / 2;
  const centerLng = (currentLoc.lng + targetGrave.longitude) / 2;
  const latSpan = Math.max(0.0008, Math.abs(currentLoc.lat - targetGrave.latitude) * 2.2);
  const lngSpan = Math.max(0.0008, Math.abs(currentLoc.lng - targetGrave.longitude) * 2.2);

  const toPercent = (lat: number, lng: number) => {
    const x = ((lng - (centerLng - lngSpan / 2)) / lngSpan) * 100;
    const y = (((centerLat + latSpan / 2) - lat) / latSpan) * 100;
    return { x: Math.max(10, Math.min(90, x)), y: Math.max(15, Math.min(85, y)) };
  };

  const userPos = toPercent(currentLoc.lat, currentLoc.lng);
  const targetPos = toPercent(targetGrave.latitude, targetGrave.longitude);
  const midpointPos = {
    x: (userPos.x + targetPos.x) / 2,
    y: (userPos.y + targetPos.y) / 2,
  };

  const isNearby = distance <= 12;
  const isAtGrave = distance <= 3.5;

  return (
    <div className="flex-1 flex flex-col relative bg-slate-900 overflow-hidden select-none">
      {/* Top Navigation Header matching Screen 6 */}
      <div className="absolute top-0 inset-x-0 z-20 px-4 pt-3 pb-3 bg-gradient-to-b from-black/80 via-black/50 to-transparent flex items-center justify-between text-white">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/30 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
          </button>
          <div>
            <h1 className="text-sm font-bold tracking-tight">Navigate to Grave</h1>
            <p className="text-[11px] text-emerald-300 font-medium">
              {targetGrave.person?.fullName || 'Grave'} • Grave {targetGrave.graveNumber}
            </p>
          </div>
        </div>

        <button
          onClick={onEndNavigation}
          className="px-3.5 py-1.5 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-md text-xs font-semibold text-white transition-colors"
        >
          End
        </button>
      </div>

      {/* Interactive Satellite Cemetery Navigation Map */}
      <div className="flex-1 relative w-full h-full">
        {/* Background Satellite Ground Texture */}
        <div
          className="absolute inset-0 bg-[#16271c]"
          style={{
            backgroundImage: `radial-gradient(#264030 2px, transparent 2px), linear-gradient(135deg, #18271e 0%, #0d1711 100%)`,
            backgroundSize: '28px 28px, 100% 100%',
          }}
        >
          {/* Walking Path Line SVG */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
            <line
              x1={`${userPos.x}%`}
              y1={`${userPos.y}%`}
              x2={`${targetPos.x}%`}
              y2={`${targetPos.y}%`}
              stroke="#FFFFFF"
              strokeWidth="4"
              strokeDasharray="6 6"
              strokeLinecap="round"
              className="opacity-90"
            />
          </svg>

          {/* Floating Route Pill on path matching Screen 6 */}
          <div
            style={{ left: `${midpointPos.x}%`, top: `${midpointPos.y}%` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none"
          >
            <div className="bg-brand-dark/95 backdrop-blur-md text-white rounded-full py-1 px-3 shadow-lg border border-emerald-500/40 flex items-center space-x-1.5 text-xs font-bold whitespace-nowrap">
              <span>{Math.round(distance)} m</span>
              <span className="text-emerald-300">•</span>
              <span className="text-emerald-200">Walk {cardinal}</span>
            </div>
          </div>

          {/* User Location Marker (Blue) */}
          <div
            style={{ left: `${userPos.x}%`, top: `${userPos.y}%` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-20"
          >
            <div className="relative">
              <div className="w-6 h-6 rounded-full bg-blue-500 border-2 border-white shadow-xl flex items-center justify-center animate-user-pulse">
                <div className="w-2 h-2 rounded-full bg-white" />
              </div>
              {/* Compass heading cone pointer */}
              <div
                style={{ transform: `rotate(${headingDeg}deg)` }}
                className="absolute -top-3 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[8px] border-b-blue-400"
              />
            </div>
          </div>

          {/* Target Grave Pin (Green Pin with radar) */}
          <div
            style={{ left: `${targetPos.x}%`, top: `${targetPos.y}%` }}
            className="absolute -translate-x-1/2 -translate-y-[100%] z-20"
          >
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 rounded-full bg-emerald-500 border-2 border-white text-white flex items-center justify-center shadow-lg shadow-emerald-500/50 animate-radar">
                <span className="text-[10px] font-extrabold">{targetGrave.graveNumber.slice(-2)}</span>
              </div>
              <div className="w-2 h-2 bg-emerald-500 rotate-45 -mt-1 border-r border-b border-white" />
            </div>
          </div>
        </div>

        {/* Floating Controls on Right */}
        <div className="absolute right-3.5 top-20 z-20 flex flex-col space-y-2">
          <button
            onClick={() => setHeadingDeg((h) => (h + 30) % 360)}
            className="w-10 h-10 rounded-full bg-white/90 backdrop-blur-md shadow-md flex items-center justify-center text-slate-700 hover:bg-white"
            title="Rotate compass"
          >
            <Compass className="w-5 h-5 text-brand-forest" />
          </button>
          <button
            onClick={() => {
              // Reset to user view
            }}
            className="w-10 h-10 rounded-full bg-white/90 backdrop-blur-md shadow-md flex items-center justify-center text-slate-700 hover:bg-white"
            title="Center view"
          >
            <Crosshair className="w-5 h-5 text-slate-700" />
          </button>
        </div>

        {/* Walk closer testing button for desktop demonstration */}
        <div className="absolute left-3.5 top-20 z-20">
          <button
            onClick={stepCloser}
            className="bg-white/90 hover:bg-white backdrop-blur-md text-slate-800 text-[11px] font-bold px-3 py-1.5 rounded-full shadow-md flex items-center space-x-1 border border-slate-200"
          >
            <Footprints className="w-3.5 h-3.5 text-emerald-600" />
            <span>Simulate Step</span>
          </button>
        </div>
      </div>

      {/* Bottom Navigation Stats Drawer matching Screen 6 */}
      <div className="bg-white rounded-t-3xl shadow-[0_-4px_20px_rgba(0,0,0,0.15)] p-5 z-30 shrink-0 border-t border-slate-100">
        {/* Proximity Alerts */}
        {isAtGrave ? (
          <div className="mb-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center space-x-2 text-emerald-800 text-xs font-semibold animate-pulse">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>You have arrived! Grave {targetGrave.graveNumber} should be within this area (±{targetGrave.positionAccuracyMeters}m).</span>
          </div>
        ) : isNearby ? (
          <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between text-amber-900 text-xs font-semibold">
            <span>Approaching target ({Math.round(distance)}m). Switch to AR camera guidance?</span>
            <button
              onClick={onOpenARGuidance}
              className="ml-2 px-2.5 py-1 bg-amber-600 text-white rounded-lg text-[11px] font-bold"
            >
              Open AR
            </button>
          </div>
        ) : null}

        {/* 3 Metric Stats Cards: Distance, Direction, Walk time */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
            <div className="text-xl font-extrabold text-slate-900">{Math.round(distance)} m</div>
            <div className="text-[11px] text-slate-500 font-medium mt-0.5">Distance</div>
          </div>

          <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
            <div className="text-xl font-extrabold text-slate-900">{cardinal}</div>
            <div className="text-[11px] text-slate-500 font-medium mt-0.5">Direction</div>
          </div>

          <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
            <div className="text-xl font-extrabold text-slate-900">~{walkTimeMinutes} min</div>
            <div className="text-[11px] text-slate-500 font-medium mt-0.5">Walk time</div>
          </div>
        </div>

        {/* AR Camera Guidance Launcher Button */}
        <button
          onClick={onOpenARGuidance}
          className="w-full mt-4 bg-brand-forest hover:bg-brand-dark text-white rounded-xl py-3 px-4 font-semibold text-xs flex items-center justify-center space-x-2 shadow-sm transition-all"
        >
          <Eye className="w-4 h-4" />
          <span>Switch to Camera AR Guidance</span>
        </button>
      </div>
    </div>
  );
};
