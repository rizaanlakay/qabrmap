'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  Compass,
  Crosshair,
  Layers,
  Plus,
  Minus,
  Eye,
  CheckCircle2,
} from 'lucide-react';
import { Grave } from '@/types';
import {
  calculateDistanceMeters,
  calculateBearing,
  formatBearingToCardinal,
} from '@/lib/geospatial';
import { useWakeLock } from '@/lib/device/useWakeLock';

interface NavigationScreenProps {
  targetGrave: Grave;
  userLocation: { lat: number; lng: number };
  onUpdateUserLocation?: (loc: { lat: number; lng: number }) => void;
  onOpenARGuidance: () => void;
  onEndNavigation: () => void;
  onBack: () => void;
}

// Google Maps Raster Tile Styles
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

export const NavigationScreen: React.FC<NavigationScreenProps> = ({
  targetGrave,
  userLocation: initialUserLoc,
  onUpdateUserLocation,
  onOpenARGuidance,
  onEndNavigation,
  onBack,
}) => {
  // Keep mobile screen awake during grave navigation
  const wakeLock = useWakeLock(true);

  // Current user GPS in real device or fallback
  const [currentLoc, setCurrentLoc] = useState(initialUserLoc);
  const [headingDeg, setHeadingDeg] = useState(42);
  const [mapType, setMapType] = useState<'satellite' | 'roadmap'>('satellite');
  const [zoomDisplay, setZoomDisplay] = useState(100);
  const [isMapReady, setIsMapReady] = useState(false);

  // Screen position of midpoint on the route for floating distance pill
  const [midpointScreenPos, setMidpointScreenPos] = useState<{ x: number; y: number } | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const targetMarkerRef = useRef<any>(null);
  const baseZoomRef = useRef<number>(18.5);

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

  // Real GPS Geolocation watcher if supported
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setCurrentLoc(next);
          if (onUpdateUserLocation) onUpdateUserLocation(next);
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [onUpdateUserLocation]);

  // Midpoint GPS coordinates between user and target grave
  const midLng = (currentLoc.lng + targetGrave.longitude) / 2;
  const midLat = (currentLoc.lat + targetGrave.latitude) / 2;

  // Bounding box framing both user location and target grave
  const bounds = useMemo(() => {
    const minLat = Math.min(currentLoc.lat, targetGrave.latitude);
    const maxLat = Math.max(currentLoc.lat, targetGrave.latitude);
    const minLng = Math.min(currentLoc.lng, targetGrave.longitude);
    const maxLng = Math.max(currentLoc.lng, targetGrave.longitude);

    return {
      minLat,
      maxLat,
      minLng,
      maxLng,
      centerLat: (minLat + maxLat) / 2,
      centerLng: (minLng + maxLng) / 2,
    };
  }, [currentLoc.lat, currentLoc.lng, targetGrave.latitude, targetGrave.longitude]);

  // Function to re-fit map camera framing user and target grave
  const fitBoundsToRoute = useCallback(
    (map: any, animate: boolean = true) => {
      if (!map) return;
      map.fitBounds(
        [
          [bounds.minLng, bounds.minLat],
          [bounds.maxLng, bounds.maxLat],
        ],
        {
          padding: { top: 90, bottom: 230, left: 45, right: 45 },
          maxZoom: 20,
          duration: animate ? 800 : 0,
        }
      );
    },
    [bounds]
  );

  // Setup / Update Direction Line on top of Google Maps
  const setupRouteLayers = useCallback(
    (map: any) => {
      if (!map) return;
      const routeGeoJSON = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [currentLoc.lng, currentLoc.lat],
            [targetGrave.longitude, targetGrave.latitude],
          ],
        },
      };

      try {
        if (map.getSource('navigation-route')) {
          map.getSource('navigation-route').setData(routeGeoJSON);
          return;
        }

        map.addSource('navigation-route', {
          type: 'geojson',
          data: routeGeoJSON,
        });

        // Luminous emerald glow stroke
        map.addLayer({
          id: 'navigation-route-glow',
          type: 'line',
          source: 'navigation-route',
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#10B981',
            'line-width': 7,
            'line-blur': 3,
            'line-opacity': 0.75,
          },
        });

        // Bright crisp white dashed core line
        map.addLayer({
          id: 'navigation-route-line',
          type: 'line',
          source: 'navigation-route',
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#FFFFFF',
            'line-width': 3.5,
            'line-dasharray': [3, 2],
            'line-opacity': 0.95,
          },
        });
      } catch (err) {
        console.warn('Error setting up navigation route layer:', err);
      }
    },
    [currentLoc.lat, currentLoc.lng, targetGrave.latitude, targetGrave.longitude]
  );

  // Initialize MapLibre GL with Google Maps raster tiles
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
          zoom: 18.0,
          minZoom: 12,
          maxZoom: 21,
          attributionControl: false,
        });

        mapInstanceRef.current = map;

        // Custom HTML Marker for Target Grave
        const targetEl = document.createElement('div');
        targetEl.className = 'navigation-target-pin';
        targetEl.innerHTML = `
          <div class="flex flex-col items-center select-none cursor-pointer">
            <div class="bg-emerald-950/90 backdrop-blur-md text-emerald-100 border border-emerald-400/40 text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg mb-1 whitespace-nowrap">
              ${targetGrave.person?.fullName || `Grave ${targetGrave.graveNumber}`}
            </div>
            <div class="relative flex items-center justify-center">
              <div class="w-8 h-8 rounded-full bg-emerald-600 border-2 border-white text-white flex items-center justify-center shadow-lg shadow-emerald-500/50 animate-radar">
                <span class="text-[10px] font-black">${targetGrave.graveNumber.slice(-4)}</span>
              </div>
              <div class="w-2.5 h-2.5 bg-emerald-600 rotate-45 -mt-1 border-r border-b border-white"></div>
            </div>
          </div>
        `;

        targetMarkerRef.current = new maplibregl.Marker({ element: targetEl, anchor: 'bottom' })
          .setLngLat([targetGrave.longitude, targetGrave.latitude])
          .addTo(map);

        // Custom HTML Marker for Live User Location
        const userEl = document.createElement('div');
        userEl.className = 'navigation-user-dot';
        userEl.innerHTML = `
          <div class="relative flex items-center justify-center select-none">
            <div class="w-6 h-6 rounded-full bg-blue-500 border-2 border-white shadow-xl flex items-center justify-center animate-user-pulse">
              <div class="w-2 h-2 rounded-full bg-white"></div>
            </div>
            <div class="user-heading-pointer absolute -top-3 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[8px] border-b-blue-400" style="transform: rotate(${headingDeg}deg); transform-origin: center bottom;"></div>
          </div>
        `;

        userMarkerRef.current = new maplibregl.Marker({ element: userEl, anchor: 'center' })
          .setLngLat([currentLoc.lng, currentLoc.lat])
          .addTo(map);

        map.on('load', () => {
          if (isCancelled) return;
          setIsMapReady(true);
          setupRouteLayers(map);
          fitBoundsToRoute(map, false);

          setTimeout(() => {
            if (mapInstanceRef.current) {
              baseZoomRef.current = mapInstanceRef.current.getZoom();
              setZoomDisplay(100);
            }
          }, 80);
        });

        // Update screen projection for floating route callout & live zoom %
        const handleMapTransform = () => {
          if (!map) return;
          const currentZoom = map.getZoom();
          const base = baseZoomRef.current || 18.0;
          const pct = Math.max(25, Math.min(600, Math.round(Math.pow(2, currentZoom - base) * 100)));
          setZoomDisplay(pct);

          // Project midpoint between user and target grave
          const pt = map.project([midLng, midLat]);
          setMidpointScreenPos({ x: pt.x, y: pt.y });
        };

        map.on('zoom', handleMapTransform);
        map.on('move', handleMapTransform);
        map.on('rotate', handleMapTransform);
      } catch (err) {
        console.warn('MapLibre GL Navigation init error:', err);
      }
    }

    initMap();

    return () => {
      isCancelled = true;
      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
        userMarkerRef.current = null;
      }
      if (targetMarkerRef.current) {
        targetMarkerRef.current.remove();
        targetMarkerRef.current = null;
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      setIsMapReady(false);
    };
  }, []); // Mount map once

  // Update map style on switch
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isMapReady) return;
    map.setStyle(mapType === 'satellite' ? GOOGLE_SATELLITE_STYLE : GOOGLE_ROADMAP_STYLE);
    map.once('style.load', () => {
      setupRouteLayers(map);
    });
  }, [mapType, isMapReady, setupRouteLayers]);

  // Update route line & user marker position when GPS changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (map && isMapReady) {
      setupRouteLayers(map);
      if (userMarkerRef.current) {
        userMarkerRef.current.setLngLat([currentLoc.lng, currentLoc.lat]);
      }
      // Update heading arrow rotation
      const pointer = document.querySelector('.user-heading-pointer') as HTMLElement;
      if (pointer) {
        pointer.style.transform = `rotate(${headingDeg}deg)`;
      }
      // Update midpoint projection
      const pt = map.project([midLng, midLat]);
      setMidpointScreenPos({ x: pt.x, y: pt.y });
    }
  }, [currentLoc.lat, currentLoc.lng, headingDeg, midLat, midLng, isMapReady, setupRouteLayers]);

  // Zoom handlers
  const handleZoomIn = () => {
    if (mapInstanceRef.current) mapInstanceRef.current.zoomIn({ duration: 300 });
  };

  const handleZoomOut = () => {
    if (mapInstanceRef.current) mapInstanceRef.current.zoomOut({ duration: 300 });
  };

  const handleRecenter = () => {
    if (mapInstanceRef.current) fitBoundsToRoute(mapInstanceRef.current, true);
  };

  const handleResetNorth = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.easeTo({ bearing: 0, pitch: 0, duration: 400 });
    }
  };

  const handleToggleMapType = () => {
    setMapType((prev) => (prev === 'satellite' ? 'roadmap' : 'satellite'));
  };

  const isNearby = distance <= 12;
  const isAtGrave = distance <= 3.5;

  return (
    <div className="flex-1 flex flex-col relative bg-slate-950 overflow-hidden select-none">
      {/* Top Floating Navigation Header */}
      <div className="absolute top-0 inset-x-0 z-20 px-4 pt-3 pb-3 bg-gradient-to-b from-black/85 via-black/55 to-transparent flex items-center justify-between text-white pointer-events-auto">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/30 transition-colors shrink-0"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
          </button>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-bold tracking-tight">Navigate to Grave</h1>
              {wakeLock.isActive && (
                <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-[9px] font-semibold text-emerald-300" title="Screen stays awake while navigating">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Awake</span>
                </span>
              )}
            </div>
            <p className="text-[11px] text-emerald-300 font-medium truncate max-w-[200px]">
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

      {/* Main Google Maps Interactive Container */}
      <div className="flex-1 relative w-full h-full overflow-hidden">
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Floating Route Badge along the Direction Line */}
        {midpointScreenPos && (
          <div
            style={{
              left: `${midpointScreenPos.x}px`,
              top: `${midpointScreenPos.y}px`,
            }}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none transition-transform duration-75"
          >
            <div className="bg-slate-950/90 backdrop-blur-md text-white rounded-full py-1 px-3 shadow-xl border border-emerald-400/40 flex items-center space-x-1.5 text-xs font-bold whitespace-nowrap">
              <span>{Math.round(distance)} m</span>
              <span className="text-emerald-400">•</span>
              <span className="text-emerald-200">Walk {cardinal}</span>
            </div>
          </div>
        )}

        {/* Floating Controls Toolbar (Top Right) */}
        <div className="absolute right-3.5 top-16 z-20 flex flex-col space-y-2 pointer-events-auto">
          {/* Layer Switcher (Satellite <-> Roadmap) */}
          <button
            onClick={handleToggleMapType}
            className="w-10 h-10 rounded-full bg-white/95 backdrop-blur-md shadow-lg border border-slate-200/80 flex items-center justify-center text-slate-700 hover:bg-white active:scale-95 transition-all"
            title={`Switch to ${mapType === 'satellite' ? 'Roadmap' : 'Satellite'} view`}
          >
            <Layers className="w-5 h-5 text-emerald-700" />
          </button>

          {/* Compass (Reset North) */}
          <button
            onClick={handleResetNorth}
            className="w-10 h-10 rounded-full bg-white/95 backdrop-blur-md shadow-lg border border-slate-200/80 flex items-center justify-center text-slate-700 hover:bg-white active:scale-95 transition-all"
            title="Reset North orientation"
          >
            <Compass className="w-5 h-5 text-emerald-700" />
          </button>

          {/* Recenter View on User & Destination Grave */}
          <button
            onClick={handleRecenter}
            className="w-10 h-10 rounded-full bg-white/95 backdrop-blur-md shadow-lg border border-slate-200/80 flex items-center justify-center text-slate-700 hover:bg-white active:scale-95 transition-all"
            title="Recenter route view"
          >
            <Crosshair className="w-5 h-5 text-slate-700" />
          </button>

          {/* Zoom In & Out Controls */}
          <div className="flex flex-col rounded-full bg-white/95 backdrop-blur-md shadow-lg border border-slate-200/80 overflow-hidden">
            <button
              onClick={handleZoomIn}
              className="w-10 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition-colors"
              title="Zoom in"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
            </button>
            <div className="text-[9px] font-bold text-slate-500 text-center py-0.5 border-y border-slate-100 select-none">
              {zoomDisplay}%
            </div>
            <button
              onClick={handleZoomOut}
              className="w-10 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition-colors"
              title="Zoom out"
            >
              <Minus className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Google Maps Attribution Badge */}
        <div className="absolute left-2.5 bottom-2 z-10 pointer-events-none">
          <div className="bg-black/50 backdrop-blur-xs px-2 py-0.5 rounded text-[10px] text-white/90 font-medium tracking-tight">
            <span className="font-bold">Google</span> Imagery ©2026
          </div>
        </div>
      </div>

      {/* Bottom Navigation Stats Drawer */}
      <div className="bg-white rounded-t-3xl shadow-[0_-4px_25px_rgba(0,0,0,0.18)] p-5 z-30 shrink-0 border-t border-slate-100 pointer-events-auto">
        {/* Proximity Alerts */}
        {isAtGrave ? (
          <div className="mb-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center space-x-2 text-emerald-800 text-xs font-semibold animate-pulse">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>You have arrived! Grave {targetGrave.graveNumber} is right here (±{targetGrave.positionAccuracyMeters}m).</span>
          </div>
        ) : isNearby ? (
          <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between text-amber-900 text-xs font-semibold">
            <span>Approaching target ({Math.round(distance)}m). Switch to AR camera guidance?</span>
            <button
              onClick={onOpenARGuidance}
              className="ml-2 px-2.5 py-1 bg-amber-600 text-white rounded-lg text-[11px] font-bold active:scale-95 transition-transform"
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
          className="w-full mt-4 bg-brand-forest hover:bg-brand-dark text-white rounded-xl py-3.5 px-4 font-semibold text-xs flex items-center justify-center space-x-2 shadow-md active:scale-[0.99] transition-all"
        >
          <Eye className="w-4 h-4" />
          <span>Switch to Camera AR Guidance</span>
        </button>
      </div>
    </div>
  );
};
