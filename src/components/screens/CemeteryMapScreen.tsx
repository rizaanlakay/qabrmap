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
import { formatGravesMapped } from '@/lib/data/cemeteryStats';
import { useWakeLock } from '@/lib/device/useWakeLock';
import { googleRasterStyle, MAX_MAP_ZOOM, registerGoogleTilesProtocol } from '@/lib/map/googleMapTiles';
import { GoogleMapsAttribution } from '@/components/common/GoogleMapsAttribution';

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

// Official Google Map Tiles, loaded through the gmaptiles:// protocol registered when the map starts
const GOOGLE_SATELLITE_STYLE = googleRasterStyle('satellite');
const GOOGLE_ROADMAP_STYLE = googleRasterStyle('roadmap');

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
  useWakeLock(true);

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

  // Compute bounding box across the recorded cemetery boundary and all graves
  const bounds = useMemo(() => {
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    // Prioritize the recorded cemetery boundary polygon
    if (cemetery.boundary?.coordinates?.[0]?.length) {
      for (const [lng, lat] of cemetery.boundary.coordinates[0]) {
        if (typeof lat === 'number' && !isNaN(lat)) {
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
        if (typeof lng === 'number' && !isNaN(lng)) {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
        }
      }
    } else if (graves && graves.length > 0) {
      // Fallback: only include graves that belong to THIS cemetery
      for (const g of graves) {
        if (g.cemeteryId && g.cemeteryId !== cemetery.id) continue;
        if (typeof g.latitude === 'number' && !isNaN(g.latitude)) {
          if (g.latitude < minLat) minLat = g.latitude;
          if (g.latitude > maxLat) maxLat = g.latitude;
        }
        if (typeof g.longitude === 'number' && !isNaN(g.longitude)) {
          if (g.longitude < minLng) minLng = g.longitude;
          if (g.longitude > maxLng) maxLng = g.longitude;
        }
      }
    }

    // Fallback if no valid points found
    if (!isFinite(minLat) || minLat >= maxLat) {
      minLat = cemetery.originLat - 0.0008;
      maxLat = cemetery.originLat + 0.0008;
    }
    if (!isFinite(minLng) || minLng >= maxLng) {
      minLng = cemetery.originLng - 0.0008;
      maxLng = cemetery.originLng + 0.0008;
    }

    return {
      minLat,
      maxLat,
      minLng,
      maxLng,
      centerLat: (minLat + maxLat) / 2,
      centerLng: (minLng + maxLng) / 2,
    };
  }, [cemetery.boundary, cemetery.originLat, cemetery.originLng, graves]);

  // Function to re-fit map camera so the entire cemetery boundary is in view
  const fitBoundsToCemetery = useCallback(
    (map: any, animate: boolean = true) => {
      if (!map) return;
      map.fitBounds(
        [
          [bounds.minLng, bounds.minLat],
          [bounds.maxLng, bounds.maxLat],
        ],
        {
          padding: { top: 75, bottom: 85, left: 30, right: 30 },
          maxZoom: 19.5,
          duration: animate ? 800 : 0,
        }
      );
    },
    [bounds]
  );

  // Setup/Render the highlighted cemetery boundary polygon layers
  const setupBoundaryLayers = useCallback(
    (map: any) => {
      if (!map || !cemetery.boundary) return;

      const sourceId = 'cemetery-boundary-src';
      const fillLayerId = 'cemetery-boundary-fill';
      const glowLayerId = 'cemetery-boundary-glow';
      const lineLayerId = 'cemetery-boundary-line';

      try {
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId);
        if (map.getLayer(glowLayerId)) map.removeLayer(glowLayerId);
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);

        map.addSource(sourceId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: cemetery.boundary,
            properties: {
              name: cemetery.name,
            },
          },
        });

        // 1. Semi-transparent emerald polygon fill
        map.addLayer({
          id: fillLayerId,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': '#10B981',
            'fill-opacity': 0.16,
          },
        });

        // 2. Soft glowing outer boundary stroke
        map.addLayer({
          id: glowLayerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': '#34D399',
            'line-width': 6,
            'line-opacity': 0.35,
            'line-blur': 2,
          },
        });

        // 3. Crisp emerald perimeter line
        map.addLayer({
          id: lineLayerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': '#059669',
            'line-width': 2.5,
            'line-opacity': 0.95,
            'line-dasharray': [4, 2],
          },
        });
      } catch (err) {
        console.warn('Error setting up cemetery boundary layers:', err);
      }
    },
    [cemetery.boundary, cemetery.name]
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
        registerGoogleTilesProtocol(maplibregl);

        if (isCancelled || !mapContainerRef.current) return;

        map = new maplibregl.Map({
          container: mapContainerRef.current,
          style: mapType === 'satellite' ? GOOGLE_SATELLITE_STYLE : GOOGLE_ROADMAP_STYLE,
          center: [bounds.centerLng, bounds.centerLat],
          zoom: 18.0,
          minZoom: 13,
          maxZoom: MAX_MAP_ZOOM,
          attributionControl: false,
        });

        mapInstanceRef.current = map;

        map.on('load', () => {
          if (isCancelled) return;
          setIsMapReady(true);
          setupBoundaryLayers(map);
          fitBoundsToCemetery(map, false);
          setTimeout(() => {
            if (mapInstanceRef.current) {
              baseZoomRef.current = mapInstanceRef.current.getZoom();
              setZoomDisplay(100);
            }
          }, 80);
        });

        // Update zoom percentage and callout projection on movement
        const handleMapTransform = () => {
          if (!map) return;
          const currentZoom = map.getZoom();
          const base = baseZoomRef.current || 18.0;
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

  // Update Map style when toggled and re-render boundary highlight
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isMapReady) return;
    map.setStyle(mapType === 'satellite' ? GOOGLE_SATELLITE_STYLE : GOOGLE_ROADMAP_STYLE);
    map.once('style.load', () => {
      setupBoundaryLayers(map);
    });
  }, [mapType, isMapReady, setupBoundaryLayers]);

  // Re-apply boundary layers whenever cemetery.boundary updates
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isMapReady) return;
    setupBoundaryLayers(map);
  }, [cemetery.boundary, isMapReady, setupBoundaryLayers]);

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
        if (grave.cemeteryId && grave.cemeteryId !== cemetery.id) return;
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
      fitBoundsToCemetery(mapInstanceRef.current, true);
      setTimeout(() => {
        if (mapInstanceRef.current) {
          baseZoomRef.current = mapInstanceRef.current.getZoom();
          setZoomDisplay(100);
        }
      }, 820);
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
          </div>
          <span className="text-[11px] text-emerald-300/90 font-medium">
            {formatGravesMapped(cemetery.mappedGravesCount)}
            {cemetery.totalGravesEstimate > 0 && ` (${cemetery.coveragePercentage}%)`}
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

        {/* Cemetery Boundary Highlight Badge */}
        {cemetery.boundary && (
          <div className="absolute top-16 left-3.5 z-20 pointer-events-none flex items-center space-x-1.5 bg-black/65 backdrop-blur-md px-2.5 py-1 rounded-full border border-emerald-500/40 text-emerald-300 shadow-md">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-semibold tracking-wide">Boundary Highlighted</span>
          </div>
        )}

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
                  {selectedGrave.graveNumber && <span>{selectedGrave.graveNumber}</span>}
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

        {/* Google Maps logo and imagery copyright, required by the Map Tiles API terms; OSM credit when the outline is theirs */}
        <div className="absolute bottom-14 left-3.5 z-10 pointer-events-none flex flex-col items-start gap-1">
          <GoogleMapsAttribution map={mapInstanceRef.current} mapType={mapType} isMapReady={isMapReady} />
          {cemetery.boundary && cemetery.boundarySource === 'osm' && (
            <span className="px-1.5 py-px rounded bg-black/45 text-[9px] leading-tight text-white/90 font-medium">
              Boundary © OpenStreetMap contributors
            </span>
          )}
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
