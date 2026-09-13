'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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
import { useWakeLock } from '@/lib/device/useWakeLock';

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

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4.5;

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
  // Keep mobile screen awake while browsing cemetery map on location
  const wakeLock = useWakeLock(true);

  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 }); // Viewport percentage offset
  const [isDragging, setIsDragging] = useState(false);
  const [mapType, setMapType] = useState<'satellite' | 'vector'>('satellite');

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const isPointerDownRef = useRef(false);
  const pointerStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const dragDistanceRef = useRef(0);
  const touchDistanceRef = useRef<number | null>(null);

  // Compute bounding box and auto-fit viewport spans for current cemetery graves
  // This ensures graves fill the screen prominently upon entering without vast empty margins
  const { centerLat, centerLng, baseLatSpan, baseLngSpan } = useMemo(() => {
    if (!graves || graves.length === 0) {
      return {
        centerLat: cemetery.originLat,
        centerLng: cemetery.originLng,
        baseLatSpan: 0.00030,
        baseLngSpan: 0.00040,
      };
    }

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;

    for (const g of graves) {
      if (typeof g.latitude === 'number' && !isNaN(g.latitude)) {
        if (g.latitude < minLat) minLat = g.latitude;
        if (g.latitude > maxLat) maxLat = g.latitude;
      }
      if (typeof g.longitude === 'number' && !isNaN(g.longitude)) {
        if (g.longitude < minLng) minLng = g.longitude;
        if (g.longitude > maxLng) maxLng = g.longitude;
      }
    }

    // Fallbacks if single grave or invalid bounds
    if (!isFinite(minLat) || minLat >= maxLat) {
      minLat = cemetery.originLat - 0.00007;
      maxLat = cemetery.originLat + 0.00007;
    }
    if (!isFinite(minLng) || minLng >= maxLng) {
      minLng = cemetery.originLng - 0.00007;
      maxLng = cemetery.originLng + 0.00007;
    }

    const rawLatSpan = maxLat - minLat;
    const rawLngSpan = maxLng - minLng;

    // Target fill ratios on the screen:
    // - Width: graves fill ~68% of the viewport width (leaving comfortable margins on sides)
    // - Height: graves fill ~50% of the viewport height (leaving room for top header & bottom legend)
    const targetWidthRatio = 0.68;
    const targetHeightRatio = 0.50;

    const calculatedLngSpan = Math.max(0.00012, rawLngSpan / targetWidthRatio);
    const calculatedLatSpan = Math.max(0.00012, rawLatSpan / targetHeightRatio);

    // Center is the geometric midpoint of the cemetery's graves,
    // with a slight vertical offset (3% of span) to provide clearance for the grave callout card above markers
    const cLat = (minLat + maxLat) / 2 + calculatedLatSpan * 0.03;
    const cLng = (minLng + maxLng) / 2;

    return {
      centerLat: cLat,
      centerLng: cLng,
      baseLatSpan: calculatedLatSpan,
      baseLngSpan: calculatedLngSpan,
    };
  }, [graves, cemetery.originLat, cemetery.originLng]);

  // Reset to auto-fit view when switching cemetery
  useEffect(() => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  }, [cemetery.id]);

  const latSpan = baseLatSpan / zoomLevel;
  const lngSpan = baseLngSpan / zoomLevel;

  // Compute screen coordinates for lat/lng based on auto-fitted zoom and pan offset
  const getScreenCoordinates = useCallback(
    (lat: number, lng: number) => {
      const x = ((lng - (centerLng - lngSpan / 2)) / lngSpan) * 100 + panOffset.x;
      const y = (((centerLat + latSpan / 2) - lat) / latSpan) * 100 + panOffset.y;
      return { x, y };
    },
    [centerLat, centerLng, latSpan, lngSpan, panOffset.x, panOffset.y]
  );

  // Mouse wheel zoom handler (attached natively with passive: false to prevent browser window scroll)
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      const rect = container.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      // Cursor position in percentage of the map viewport
      const px = (cursorX / rect.width) * 100;
      const py = (cursorY / rect.height) * 100;

      // Proportional zoom factor: scroll up zooms in, scroll down zooms out
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;

      setZoomLevel((prevZoom) => {
        const nextZoom = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, Number((prevZoom * zoomFactor).toFixed(3)))
        );
        const actualScale = nextZoom / prevZoom;

        // Anchor zooming so point under cursor stays stationary
        setPanOffset((prevPan) => ({
          x: Number((px - 50 - (px - 50 - prevPan.x) * actualScale).toFixed(2)),
          y: Number((py - 50 - (py - 50 - prevPan.y) * actualScale).toFixed(2)),
        }));

        return nextZoom;
      });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Mouse Drag / Pan Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only primary mouse button
    isPointerDownRef.current = true;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...panOffset };
    dragDistanceRef.current = 0;
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPointerDownRef.current || !mapContainerRef.current) return;
    const dx = e.clientX - pointerStartRef.current.x;
    const dy = e.clientY - pointerStartRef.current.y;
    dragDistanceRef.current += Math.hypot(dx, dy);

    const rect = mapContainerRef.current.getBoundingClientRect();
    const percentDx = (dx / rect.width) * 100;
    const percentDy = (dy / rect.height) * 100;

    setPanOffset({
      x: Number((panStartRef.current.x + percentDx).toFixed(2)),
      y: Number((panStartRef.current.y + percentDy).toFixed(2)),
    });
  };

  const handleMouseUp = () => {
    isPointerDownRef.current = false;
    setIsDragging(false);
  };

  // Touch Pan and Pinch-to-Zoom Handlers (Mobile)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      isPointerDownRef.current = true;
      pointerStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      panStartRef.current = { ...panOffset };
      dragDistanceRef.current = 0;
      touchDistanceRef.current = null;
      setIsDragging(true);
    } else if (e.touches.length === 2) {
      isPointerDownRef.current = false;
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchDistanceRef.current = dist;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && isPointerDownRef.current && mapContainerRef.current) {
      const dx = e.touches[0].clientX - pointerStartRef.current.x;
      const dy = e.touches[0].clientY - pointerStartRef.current.y;
      dragDistanceRef.current += Math.hypot(dx, dy);

      const rect = mapContainerRef.current.getBoundingClientRect();
      const percentDx = (dx / rect.width) * 100;
      const percentDy = (dy / rect.height) * 100;

      setPanOffset({
        x: Number((panStartRef.current.x + percentDx).toFixed(2)),
        y: Number((panStartRef.current.y + percentDy).toFixed(2)),
      });
    } else if (e.touches.length === 2 && touchDistanceRef.current) {
      const newDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = newDist / touchDistanceRef.current;
      touchDistanceRef.current = newDist;

      setZoomLevel((prevZoom) =>
        Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((prevZoom * ratio).toFixed(3))))
      );
    }
  };

  const handleTouchEnd = () => {
    isPointerDownRef.current = false;
    touchDistanceRef.current = null;
    setIsDragging(false);
  };

  // Safe marker click that ignores drag gestures
  const handleMarkerClick = (grave: Grave, e: React.MouseEvent) => {
    e.stopPropagation();
    if (dragDistanceRef.current < 6) {
      onSelectGrave(grave);
    }
  };

  // Zoom Button Controls
  const handleZoomIn = () => {
    setZoomLevel((z) => Math.min(MAX_ZOOM, Number((z * 1.25).toFixed(2))));
  };

  const handleZoomOut = () => {
    setZoomLevel((z) => Math.max(MIN_ZOOM, Number((z * 0.8).toFixed(2))));
  };

  const handleRecenter = () => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const userScreenPos = getScreenCoordinates(userLocation.lat, userLocation.lng);

  return (
    <div className="flex-1 flex flex-col relative bg-slate-900 overflow-hidden select-none">
      {/* Top Floating Header */}
      <div className="absolute top-0 inset-x-0 z-20 px-3 pt-3 pb-2 bg-gradient-to-b from-black/70 via-black/40 to-transparent flex items-center justify-between text-white pointer-events-auto">
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
          <div className="flex items-center space-x-1.5 text-sm font-bold tracking-tight">
            <span className="truncate">{cemetery.name}</span>
            <ChevronDown className="w-4 h-4 opacity-80 shrink-0" />
            {wakeLock.isActive && (
              <span
                className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-full bg-emerald-500/25 border border-emerald-400/40 text-[9px] font-semibold text-emerald-300"
                title="Screen stays awake in cemetery map"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Awake</span>
              </span>
            )}
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

      {/* Primary Interactive Map View Container */}
      <div
        ref={mapContainerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`flex-1 relative w-full h-full overflow-hidden select-none ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        {/* Background Satellite Texture & Paths */}
        <div
          className={`absolute inset-0 transition-colors duration-300 ${
            mapType === 'satellite' ? 'bg-[#18271e]' : 'bg-[#e2e8e2]'
          }`}
          style={{
            backgroundImage:
              mapType === 'satellite'
                ? `radial-gradient(#253d30 2px, transparent 2px), linear-gradient(135deg, #18271e 0%, #101c15 100%)`
                : `radial-gradient(#cbd5e1 1.5px, transparent 1.5px)`,
            backgroundSize: `${32 * Math.min(2.5, Math.max(0.6, zoomLevel))}px ${
              32 * Math.min(2.5, Math.max(0.6, zoomLevel))
            }px, 100% 100%`,
            backgroundPosition: `${panOffset.x * 2.5}px ${panOffset.y * 2.5}px`,
          }}
        >
          {/* Simulated Cemetery Cobblestone / Earth Pathways */}
          <svg
            className="absolute inset-0 w-full h-full opacity-40 pointer-events-none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <g transform={`translate(${panOffset.x * 3}, ${panOffset.y * 3})`}>
              <path
                d="M 50% 0 L 50% 100% M 0 45% L 100% 45% M 0 75% L 100% 75%"
                stroke={mapType === 'satellite' ? '#5a7866' : '#94a3b8'}
                strokeWidth={Math.max(6, 10 * Math.min(2.0, zoomLevel))}
                strokeDasharray="6 3"
                fill="none"
              />
            </g>
          </svg>
        </div>

        {/* Grave Markers Layer */}
        <div className="absolute inset-0 pointer-events-none">
          {graves.map((grave) => {
            const pos = getScreenCoordinates(grave.latitude, grave.longitude);
            // Skip markers that are far outside the viewport to optimize performance
            if (pos.x < -20 || pos.x > 120 || pos.y < -20 || pos.y > 120) {
              return null;
            }

            const isSelected = selectedGrave?.id === grave.id;

            // Confidence dot colors
            let dotColor = 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]'; // Mapped
            if (grave.status === 'LOW_CONFIDENCE') {
              dotColor = 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.7)]'; // Low confidence
            } else if (grave.status === 'UNMAPPED') {
              dotColor = 'bg-slate-400/80'; // Unmapped
            }

            return (
              <div
                key={grave.id}
                onClick={(e) => handleMarkerClick(grave, e)}
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer z-10 p-1 group pointer-events-auto"
              >
                {/* Marker Dot */}
                <div
                  className={`w-4 h-4 rounded-full border-2 border-white/90 transition-transform ${dotColor} ${
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

          {/* Selected Grave Callout Card / Tooltip */}
          {selectedGrave &&
            (() => {
              const pos = getScreenCoordinates(selectedGrave.latitude, selectedGrave.longitude);
              return (
                <div
                  style={{
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
                  }}
                  className="absolute -translate-x-1/2 -translate-y-[120%] z-30 transition-all pointer-events-auto"
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
            })()}
        </div>

        {/* Floating Right Map Controls */}
        <div className="absolute right-3.5 top-20 z-20 flex flex-col space-y-2.5 pointer-events-auto">
          <button
            onClick={() => setMapType(mapType === 'satellite' ? 'vector' : 'satellite')}
            className="w-10 h-10 rounded-full bg-white/90 backdrop-blur-md shadow-md flex items-center justify-center text-slate-700 hover:bg-white transition-colors"
            aria-label="Map Layer"
            title="Toggle satellite / vector view"
          >
            <Layers className="w-5 h-5 stroke-[2]" />
          </button>
          <button
            onClick={handleRecenter}
            className="w-10 h-10 rounded-full bg-white/90 backdrop-blur-md shadow-md flex items-center justify-center text-brand-forest hover:bg-white transition-colors"
            aria-label="My Location"
            title="Recenter and fit cemetery to screen"
          >
            <NavigationIcon className="w-5 h-5 stroke-[2.2]" />
          </button>

          {/* Zoom In / Indicator / Zoom Out */}
          <div className="flex flex-col bg-white/90 backdrop-blur-md rounded-2xl shadow-md overflow-hidden border border-slate-200/50">
            <button
              onClick={handleZoomIn}
              className="w-10 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100 border-b border-slate-200/50 transition-colors"
              title="Zoom in (or use mouse scrollwheel)"
              aria-label="Zoom in"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
            </button>
            <div
              className="w-10 py-1 text-center text-[10px] font-bold text-slate-600 bg-slate-50/90 select-none border-b border-slate-200/50"
              title="Current zoom level"
            >
              {Math.round(zoomLevel * 100)}%
            </div>
            <button
              onClick={handleZoomOut}
              className="w-10 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors"
              title="Zoom out (or use mouse scrollwheel)"
              aria-label="Zoom out"
            >
              <Minus className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Map Legend at Bottom */}
        <div className="absolute bottom-3 inset-x-4 z-20 pointer-events-auto">
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
