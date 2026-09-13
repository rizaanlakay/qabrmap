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

// Google Maps Tile Styles
const GOOGLE_SATELLITE_STYLE: any = {
  version: 8,
  sources: {
    'google-tiles': {
      type: 'raster',
      tiles: [
        'https://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
        'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
        'https://mt2.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
        'https://mt3.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      ],
      tileSize: 256,
      maxzoom: 21,
      attribution: '© Google',
    },
  },
  layers: [
    {
      id: 'google-tiles-layer',
      type: 'raster',
      source: 'google-tiles',
      minzoom: 0,
      maxzoom: 21,
    },
  ],
};

const GOOGLE_ROADMAP_STYLE: any = {
  version: 8,
  sources: {
    'google-tiles': {
      type: 'raster',
      tiles: [
        'https://mt0.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        'https://mt2.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        'https://mt3.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
      ],
      tileSize: 256,
      maxzoom: 21,
      attribution: '© Google',
    },
  },
  layers: [
    {
      id: 'google-tiles-layer',
      type: 'raster',
      source: 'google-tiles',
      minzoom: 0,
      maxzoom: 21,
    },
  ],
};

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

  const [mapType, setMapType] = useState<'satellite' | 'roadmap'>('satellite');
  const [zoomDisplay, setZoomDisplay] = useState(100);
  const [isMapReady, setIsMapReady] = useState(false);

  // Position of selected grave on container for tooltip callout
  const [selectedScreenPos, setSelectedScreenPos] = useState<{ x: number; y: number } | null>(null);
  const [userScreenPos, setUserScreenPos] = useState<{ x: number; y: number } | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersMapRef = useRef<Map<string, any>>(new Map());
  const userMarkerRef = useRef<any>(null);
  const baseZoomRef = useRef<number>(18.5);

  // Compute bounding box across all cemetery graves
  const bounds = useMemo(() => {
    if (!graves || graves.length === 0) {
      return {
        minLat: cemetery.originLat - 0.0004,
        maxLat: cemetery.originLat + 0.0004,
        minLng: cemetery.originLng - 0.0004,
        maxLng: cemetery.originLng + 0.0004,
        centerLat: cemetery.originLat,
        centerLng: cemetery.originLng,
      };
    }

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

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

    if (!isFinite(minLat) || minLat >= maxLat) {
      minLat = cemetery.originLat - 0.0002;
      maxLat = cemetery.originLat + 0.0002;
    }
    if (!isFinite(minLng) || minLng >= maxLng) {
      minLng = cemetery.originLng - 0.0002;
      maxLng = cemetery.originLng + 0.0002;
    }

    return {
      minLat,
      maxLat,
      minLng,
      maxLng,
      centerLat: (minLat + maxLat) / 2,
      centerLng: (minLng + maxLng) / 2,
    };
  }, [graves, cemetery.originLat, cemetery.originLng]);

  // Function to re-fit map camera to the graves bounds
  const fitBoundsToGraves = useCallback(
    (map: any, animate: boolean = true) => {
      if (!map) return;
      map.fitBounds(
        [
          [bounds.minLng, bounds.minLat],
          [bounds.maxLng, bounds.maxLat],
        ],
        {
          padding: { top: 80, bottom: 80, left: 35, right: 65 },
          maxZoom: 19.8,
          duration: animate ? 800 : 0,
        }
      );
    },
    [bounds]
  );

  // Initialize MapLibre GL with Google Maps tiles
  useEffect(() => {
    let isCancelled = false;
    let map: any = null;

    async function initMap() {
      if (!mapContainerRef.current) return;

      try {
        const mod = await import('maplibre-gl');
        const maplibregl = mod.default || mod;

        if (isCancelled || !mapContainerRef.current) return;

        map = new maplibregl.Map({
          container: mapContainerRef.current,
          style: mapType === 'satellite' ? GOOGLE_SATELLITE_STYLE : GOOGLE_ROADMAP_STYLE,
          center: [bounds.centerLng, bounds.centerLat],
          zoom: 18.5,
          minZoom: 14,
          maxZoom: 21,
          attributionControl: false,
        });

        mapInstanceRef.current = map;

        map.on('load', () => {
          if (isCancelled) return;
          setIsMapReady(true);
          fitBoundsToGraves(map, false);
          baseZoomRef.current = map.getZoom();
        });

        // Update zoom percentage and callout projection on movement
        const handleMapTransform = () => {
          if (!map) return;
          const currentZoom = map.getZoom();
          const base = baseZoomRef.current || 18.5;
          const pct = Math.max(25, Math.min(600, Math.round(Math.pow(2, currentZoom - base) * 100)));
          setZoomDisplay(pct);

          // Update selected grave screen position
          if (selectedGrave) {
            const pt = map.project([selectedGrave.longitude, selectedGrave.latitude]);
            setSelectedScreenPos({ x: pt.x, y: pt.y });
          }

          // Update user location screen position
          if (userLocation) {
            const uPt = map.project([userLocation.lng, userLocation.lat]);
            setUserScreenPos({ x: uPt.x, y: uPt.y });
          }
        };

        map.on('zoom', handleMapTransform);
        map.on('move', handleMapTransform);
        map.on('rotate', handleMapTransform);
      } catch (err) {
        console.warn('MapLibre GL initialization fallback:', err);
      }
    }

    initMap();

    return () => {
      isCancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      setIsMapReady(false);
    };
  }, [cemetery.id]); // Re-init on cemetery switch

  // Update Map style when toggled
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isMapReady) return;
    map.setStyle(mapType === 'satellite' ? GOOGLE_SATELLITE_STYLE : GOOGLE_ROADMAP_STYLE);
  }, [mapType, isMapReady]);

  // Sync Grave Markers with Google Map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isMapReady) return;

    import('maplibre-gl').then((mod) => {
      const maplibregl = mod.default || mod;

      // Remove previous markers
      markersMapRef.current.forEach((marker) => marker.remove());
      markersMapRef.current.clear();

      graves.forEach((grave) => {
        const isSelected = selectedGrave?.id === grave.id;

        // Create marker container element
        const el = document.createElement('div');
        el.className = 'cursor-pointer p-1.5 group select-none transition-transform';

        let dotColor = 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]'; // Mapped
        if (grave.status === 'LOW_CONFIDENCE') {
          dotColor = 'bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.8)]'; // Low confidence
        } else if (grave.status === 'UNMAPPED') {
          dotColor = 'bg-slate-400/90'; // Unmapped
        }

        const dot = document.createElement('div');
        dot.className = `w-4 h-4 rounded-full border-2 border-white/90 transition-transform ${dotColor} ${
          isSelected ? 'scale-150 ring-4 ring-white shadow-2xl' : 'group-hover:scale-125'
        }`;
        el.appendChild(dot);

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelectGrave(grave);
        });

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([grave.longitude, grave.latitude])
          .addTo(map);

        markersMapRef.current.set(grave.id, marker);
      });
    });
  }, [graves, selectedGrave?.id, isMapReady, onSelectGrave]);

  // Update selected grave tooltip position whenever selectedGrave changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedGrave || !isMapReady) {
      setSelectedScreenPos(null);
      return;
    }

    const pt = map.project([selectedGrave.longitude, selectedGrave.latitude]);
    setSelectedScreenPos({ x: pt.x, y: pt.y });
  }, [selectedGrave, isMapReady]);

  // Update user location position whenever userLocation changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isMapReady) return;
    const uPt = map.project([userLocation.lng, userLocation.lat]);
    setUserScreenPos({ x: uPt.x, y: uPt.y });
  }, [userLocation, isMapReady]);

  // Control Handlers
  const handleZoomIn = () => {
    mapInstanceRef.current?.zoomIn({ duration: 250 });
  };

  const handleZoomOut = () => {
    mapInstanceRef.current?.zoomOut({ duration: 250 });
  };

  const handleRecenter = () => {
    if (mapInstanceRef.current) {
      fitBoundsToGraves(mapInstanceRef.current, true);
    }
  };

  const handleToggleMapType = () => {
    setMapType((prev) => (prev === 'satellite' ? 'roadmap' : 'satellite'));
  };

  return (
    <div className="flex-1 flex flex-col relative bg-slate-950 overflow-hidden select-none">
      {/* Top Floating Header */}
      <div className="absolute top-0 inset-x-0 z-20 px-3 pt-3 pb-2 bg-gradient-to-b from-black/80 via-black/50 to-transparent flex items-center justify-between text-white pointer-events-auto">
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

      {/* Google Map Container with Full Mouse Scrollwheel & Drag Navigation */}
      <div className="flex-1 relative w-full h-full overflow-hidden">
        {/* MapLibre Canvas Container */}
        <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />

        {/* User Location Pulse Marker (Blue GPS) */}
        {userScreenPos && (
          <div
            style={{ left: `${userScreenPos.x}px`, top: `${userScreenPos.y}px` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none transition-all duration-150"
          >
            <div className="w-5 h-5 rounded-full bg-blue-500 border-2 border-white animate-user-pulse flex items-center justify-center shadow-lg shadow-blue-500/50">
              <div className="w-1.5 h-1.5 rounded-full bg-white" />
            </div>
          </div>
        )}

        {/* Selected Grave Callout Card / Tooltip */}
        {selectedGrave && selectedScreenPos && (
          <div
            style={{
              left: `${selectedScreenPos.x}px`,
              top: `${selectedScreenPos.y}px`,
            }}
            className="absolute -translate-x-1/2 -translate-y-[125%] z-30 transition-all pointer-events-auto"
          >
            <div
              onClick={() => onOpenGraveDetails(selectedGrave)}
              className="bg-brand-forest/95 backdrop-blur-md text-white rounded-xl py-2 px-3.5 shadow-2xl flex items-center space-x-2 border border-emerald-500/40 cursor-pointer active:scale-95 transition-transform"
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
            <div className="w-3 h-3 bg-brand-forest rotate-45 mx-auto -mt-1.5 border-r border-b border-emerald-500/40 shadow-sm" />
          </div>
        )}

        {/* Floating Right Map Controls */}
        <div className="absolute right-3.5 top-20 z-20 flex flex-col space-y-2.5 pointer-events-auto">
          <button
            onClick={handleToggleMapType}
            className="w-10 h-10 rounded-full bg-white/95 backdrop-blur-md shadow-lg flex items-center justify-center text-slate-800 hover:bg-white transition-colors border border-slate-200/60"
            aria-label="Map Layer"
            title={mapType === 'satellite' ? 'Switch to Google Roadmap' : 'Switch to Google Satellite'}
          >
            <Layers className="w-5 h-5 stroke-[2]" />
          </button>
          <button
            onClick={handleRecenter}
            className="w-10 h-10 rounded-full bg-white/95 backdrop-blur-md shadow-lg flex items-center justify-center text-brand-forest hover:bg-white transition-colors border border-slate-200/60"
            aria-label="Recenter Map"
            title="Recenter and fit cemetery to screen"
          >
            <NavigationIcon className="w-5 h-5 stroke-[2.2]" />
          </button>

          {/* Zoom In / Live Percentage Indicator / Zoom Out */}
          <div className="flex flex-col bg-white/95 backdrop-blur-md rounded-2xl shadow-lg overflow-hidden border border-slate-200/60">
            <button
              onClick={handleZoomIn}
              className="w-10 h-9 flex items-center justify-center text-slate-800 hover:bg-slate-100 border-b border-slate-200/60 transition-colors"
              title="Zoom in (or use mouse scrollwheel)"
              aria-label="Zoom in"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
            </button>
            <div
              className="w-10 py-1 text-center text-[10px] font-bold text-slate-700 bg-slate-50/90 select-none border-b border-slate-200/60"
              title="Current zoom level"
            >
              {zoomDisplay}%
            </div>
            <button
              onClick={handleZoomOut}
              className="w-10 h-9 flex items-center justify-center text-slate-800 hover:bg-slate-100 transition-colors"
              title="Zoom out (or use mouse scrollwheel)"
              aria-label="Zoom out"
            >
              <Minus className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Google Maps Attribution Badge */}
        <div className="absolute bottom-14 left-3.5 z-10 pointer-events-none flex items-center space-x-1.5 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-md border border-white/10 text-white shadow-sm">
          <span className="text-[10px] font-bold tracking-tight text-white">Google</span>
          <span className="text-[8px] text-slate-300 font-medium opacity-80">Imagery ©2026</span>
        </div>

        {/* Map Legend at Bottom */}
        <div className="absolute bottom-3 inset-x-4 z-20 pointer-events-auto">
          <div className="bg-white/95 backdrop-blur-md rounded-xl py-2 px-3.5 shadow-lg flex items-center justify-around border border-slate-200/60 text-slate-700 text-[11px] font-medium">
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
