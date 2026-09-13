'use client';

import React, { useState } from 'react';
import {
  ArrowLeft,
  MoreVertical,
  ChevronDown,
  Layers,
  Navigation as NavigationIcon,
  Plus,
  Minus,
  CheckCircle2,
} from 'lucide-react';
import { Cemetery, Grave } from '@/types';

interface CemeteryMapScreenProps {
  cemetery: Cemetery;
  graves: Grave[];
  selectedGrave: Grave | null;
  userLocation: { lat: number; lng: number };
  onSelectGrave: (grave: Grave) => void;
  onOpenGraveDetails: (grave: Grave) => void;
  onBack: () => void;
  onSwitchCemetery: () => void;
}

export const CemeteryMapScreen: React.FC<CemeteryMapScreenProps> = ({
  cemetery,
  graves,
  selectedGrave,
  userLocation,
  onSelectGrave,
  onOpenGraveDetails,
  onBack,
  onSwitchCemetery,
}) => {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [mapType, setMapType] = useState<'satellite' | 'vector'>('satellite');

  // Coordinates normalized to view frame
  // Center is cemetery origin
  const centerLat = cemetery.originLat;
  const centerLng = cemetery.originLng;

  const latSpan = 0.00075 / zoomLevel;
  const lngSpan = 0.00095 / zoomLevel;

  const getScreenCoordinates = (lat: number, lng: number) => {
    const x = ((lng - (centerLng - lngSpan / 2)) / lngSpan) * 100;
    const y = (((centerLat + latSpan / 2) - lat) / latSpan) * 100;
    return { x: Math.max(5, Math.min(95, x)), y: Math.max(8, Math.min(92, y)) };
  };

  const userScreenPos = getScreenCoordinates(userLocation.lat, userLocation.lng);

  return (
    <div className="flex-1 flex flex-col relative bg-slate-900 overflow-hidden select-none">
      {/* Top Floating Header */}
      <div className="absolute top-0 inset-x-0 z-20 px-3 pt-3 pb-2 bg-gradient-to-b from-black/70 via-black/40 to-transparent flex items-center justify-between text-white">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/30 transition-colors shrink-0"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>

        {/* Cemetery Dropdown title */}
        <button
          onClick={onSwitchCemetery}
          className="flex flex-col items-center max-w-[240px] px-2 py-0.5 rounded-lg hover:bg-white/10 transition-colors"
        >
          <div className="flex items-center space-x-1 text-sm font-bold tracking-tight">
            <span className="truncate">{cemetery.name}</span>
            <ChevronDown className="w-4 h-4 opacity-80 shrink-0" />
          </div>
          <span className="text-[11px] text-emerald-300/90 font-medium">
            {cemetery.mappedGravesCount.toLocaleString()} graves mapped ({cemetery.coveragePercentage}%)
          </span>
        </button>

        <button
          className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/30 transition-colors shrink-0"
          aria-label="Options"
        >
          <MoreVertical className="w-5 h-5 stroke-[2.2]" />
        </button>
      </div>

      {/* Primary Map View Container */}
      <div className="flex-1 relative w-full h-full overflow-hidden">
        {/* Background Satellite Texture & Paths */}
        <div
          className={`absolute inset-0 transition-all ${
            mapType === 'satellite'
              ? 'bg-[#18271e]'
              : 'bg-[#e2e8e2]'
          }`}
          style={{
            backgroundImage:
              mapType === 'satellite'
                ? `radial-gradient(#253d30 2px, transparent 2px), linear-gradient(135deg, #18271e 0%, #101c15 100%)`
                : `radial-gradient(#cbd5e1 1.5px, transparent 1.5px)`,
            backgroundSize: '32px 32px, 100% 100%',
          }}
        >
          {/* Simulated Cemetery Cobblestone / Earth Pathways */}
          <svg className="absolute inset-0 w-full h-full opacity-40" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M 50% 0 L 50% 100% M 0 45% L 100% 45% M 0 75% L 100% 75%"
              stroke={mapType === 'satellite' ? '#5a7866' : '#94a3b8'}
              strokeWidth="10"
              strokeDasharray="6 3"
              fill="none"
            />
          </svg>
        </div>

        {/* Grave Markers Layer */}
        <div className="absolute inset-0 pointer-events-auto">
          {graves.map((grave) => {
            const pos = getScreenCoordinates(grave.latitude, grave.longitude);
            const isSelected = selectedGrave?.id === grave.id;

            // Confidence dot colors matching Mockup Screen 3
            let dotColor = 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]'; // Mapped
            if (grave.status === 'LOW_CONFIDENCE') {
              dotColor = 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.7)]'; // Low confidence
            } else if (grave.status === 'UNMAPPED') {
              dotColor = 'bg-slate-400/80'; // Unmapped
            }

            return (
              <div
                key={grave.id}
                onClick={() => onSelectGrave(grave)}
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer z-10 p-1 group"
              >
                {/* Marker Dot */}
                <div
                  className={`w-3.5 h-3.5 rounded-full border-2 border-white/80 transition-transform ${dotColor} ${
                    isSelected ? 'scale-150 ring-4 ring-white shadow-xl' : 'group-hover:scale-125'
                  }`}
                />
              </div>
            );
          })}

          {/* User Location Pulse Marker (Blue) */}
          <div
            style={{ left: `${userScreenPos.x}%`, top: `${userScreenPos.y}%` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none"
          >
            <div className="w-5 h-5 rounded-full bg-blue-500 border-2 border-white animate-user-pulse flex items-center justify-center shadow-lg shadow-blue-500/50">
              <div className="w-1.5 h-1.5 rounded-full bg-white" />
            </div>
          </div>

          {/* Selected Grave Callout Card / Tooltip (Screen 3) */}
          {selectedGrave && (
            (() => {
              const pos = getScreenCoordinates(selectedGrave.latitude, selectedGrave.longitude);
              return (
                <div
                  style={{
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
                  }}
                  className="absolute -translate-x-1/2 -translate-y-[120%] z-30 transition-all"
                >
                  <div
                    onClick={() => onOpenGraveDetails(selectedGrave)}
                    className="bg-brand-forest/95 backdrop-blur-md text-white rounded-xl py-2 px-3.5 shadow-xl flex items-center space-x-2 border border-emerald-500/30 cursor-pointer active:scale-95 transition-transform"
                  >
                    <div>
                      <div className="text-xs font-bold leading-tight">
                        {selectedGrave.person?.fullName || `Grave ${selectedGrave.graveNumber}`}
                      </div>
                      <div className="text-[10px] text-emerald-200 mt-0.5 flex items-center">
                        <span>{selectedGrave.graveNumber}</span>
                        {selectedGrave.positionConfidence === 'HIGH' && (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 ml-1.5" />
                        )}
                      </div>
                    </div>
                    <span className="text-emerald-300 font-bold ml-1 text-sm">&gt;</span>
                  </div>
                  {/* Speech bubble arrow pointer */}
                  <div className="w-3 h-3 bg-brand-forest rotate-45 mx-auto -mt-1.5 border-r border-b border-emerald-500/30" />
                </div>
              );
            })()
          )}
        </div>

        {/* Floating Right Map Controls */}
        <div className="absolute right-3.5 top-20 z-20 flex flex-col space-y-2.5">
          <button
            onClick={() => setMapType(mapType === 'satellite' ? 'vector' : 'satellite')}
            className="w-10 h-10 rounded-full bg-white/90 backdrop-blur-md shadow-md flex items-center justify-center text-slate-700 hover:bg-white transition-colors"
            aria-label="Map Layer"
          >
            <Layers className="w-5 h-5 stroke-[2]" />
          </button>
          <button
            onClick={() => {
              // Recenter on user
              setZoomLevel(1);
            }}
            className="w-10 h-10 rounded-full bg-white/90 backdrop-blur-md shadow-md flex items-center justify-center text-brand-forest hover:bg-white transition-colors"
            aria-label="My Location"
          >
            <NavigationIcon className="w-5 h-5 stroke-[2.2]" />
          </button>
          <div className="flex flex-col bg-white/90 backdrop-blur-md rounded-2xl shadow-md overflow-hidden border border-slate-200/50">
            <button
              onClick={() => setZoomLevel((z) => Math.min(2.5, z + 0.3))}
              className="w-10 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100 border-b border-slate-200/50"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
            </button>
            <button
              onClick={() => setZoomLevel((z) => Math.max(0.6, z - 0.3))}
              className="w-10 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100"
            >
              <Minus className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Map Legend at Bottom matching Mockup Screen 3 */}
        <div className="absolute bottom-3 inset-x-4 z-20">
          <div className="bg-white/95 backdrop-blur-md rounded-xl py-2 px-3.5 shadow-md flex items-center justify-around border border-slate-200/60 text-slate-700 text-[11px] font-medium">
            <div className="flex items-center space-x-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm" />
              <span>Mapped</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-sm" />
              <span>Low confidence</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-400 shadow-sm" />
              <span>Unmapped</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
