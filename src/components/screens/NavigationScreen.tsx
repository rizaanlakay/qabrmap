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
  Car,
  Footprints,
  ExternalLink,
  CornerUpLeft,
  CornerUpRight,
  ArrowUp,
  Navigation,
  RotateCcw,
} from 'lucide-react';
import { Cemetery, Grave } from '@/types';
import {
  calculateDistanceMeters,
  calculateBearing,
  formatBearingToCardinal,
  isPointInPolygon,
} from '@/lib/geospatial';
import { useWakeLock } from '@/lib/device/useWakeLock';

interface RouteStep {
  instruction: string;
  streetName: string;
  distanceMeters: number;
  durationSeconds: number;
  type: string;
  modifier?: string;
  location: [number, number];
}

interface NavigationScreenProps {
  targetGrave: Grave;
  cemetery?: Cemetery;
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
  cemetery,
  userLocation: initialUserLoc,
  onUpdateUserLocation,
  onOpenARGuidance,
  onEndNavigation,
  onBack,
}) => {
  // Keep mobile screen awake during navigation
  const wakeLock = useWakeLock(true);

  // User GPS position
  const [currentLoc, setCurrentLoc] = useState(initialUserLoc);
  const [headingDeg, setHeadingDeg] = useState(42);
  const [mapType, setMapType] = useState<'satellite' | 'roadmap'>('satellite');
  const [zoomDisplay, setZoomDisplay] = useState(100);
  const [isMapReady, setIsMapReady] = useState(false);

  // Manual mode override: 'auto' | 'driving' | 'walking'
  const [manualMode, setManualMode] = useState<'auto' | 'driving' | 'walking'>('auto');

  // Follow user camera mode (Garmin / Google Maps driver tracking)
  const [isFollowingUser, setIsFollowingUser] = useState(true);

  // Driving route data from /api/directions
  const [drivingRoute, setDrivingRoute] = useState<[number, number][] | null>(null);
  const [drivingSteps, setDrivingSteps] = useState<RouteStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [drivingDistanceMeters, setDrivingDistanceMeters] = useState<number | null>(null);
  const [drivingDurationSeconds, setDrivingDurationSeconds] = useState<number | null>(null);
  const lastFetchedLocRef = useRef<{ lat: number; lng: number } | null>(null);

  // Screen position of midpoint on the route for floating distance pill
  const [midpointScreenPos, setMidpointScreenPos] = useState<{ x: number; y: number } | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const entranceMarkerRef = useRef<any>(null);
  const targetMarkerRef = useRef<any>(null);
  const baseZoomRef = useRef<number>(17.0);

  // Entrance coordinates for the cemetery
  const entranceLat = cemetery?.entranceLat ?? cemetery?.originLat ?? targetGrave.latitude;
  const entranceLng = cemetery?.entranceLng ?? cemetery?.originLng ?? targetGrave.longitude;
  const entranceName = cemetery?.entranceName ?? `${cemetery?.name || 'Cemetery'} Entrance`;

  // Compute live distances
  const distToGrave = calculateDistanceMeters(
    currentLoc.lat,
    currentLoc.lng,
    targetGrave.latitude,
    targetGrave.longitude
  );

  const distToEntrance = calculateDistanceMeters(
    currentLoc.lat,
    currentLoc.lng,
    entranceLat,
    entranceLng
  );

  // Check if user is inside the cemetery polygon
  const isInsideCemetery = useMemo(() => {
    if (!cemetery?.boundary?.coordinates?.[0]) return false;
    return isPointInPolygon(
      [currentLoc.lng, currentLoc.lat],
      cemetery.boundary.coordinates[0] as [number, number][]
    );
  }, [cemetery, currentLoc.lat, currentLoc.lng]);

  // Determine active navigation mode:
  // Beyond walking distance threshold (350m to entrance) and outside cemetery -> Driving
  // Within 350m or inside cemetery -> Walking
  const isBeyondWalking = distToEntrance > 350 && !isInsideCemetery;
  const activeMode: 'driving' | 'walking' =
    manualMode === 'auto'
      ? isBeyondWalking
        ? 'driving'
        : 'walking'
      : manualMode;

  // Bearing & Cardinal to target grave
  const bearing = calculateBearing(
    currentLoc.lat,
    currentLoc.lng,
    targetGrave.latitude,
    targetGrave.longitude
  );
  const cardinal = formatBearingToCardinal(bearing);

  // Estimated walk time (assume walking speed ~1.2 m/s -> ~70m per minute)
  const walkTimeMinutes = Math.max(1, Math.round(distToGrave / 70));

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
        { enableHighAccuracy: true, maximumAge: 4000, timeout: 10000 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [onUpdateUserLocation]);

  // Fetch authentic road driving directions when in driving mode
  useEffect(() => {
    if (activeMode !== 'driving') return;

    const last = lastFetchedLocRef.current;
    if (last) {
      const moved = calculateDistanceMeters(last.lat, last.lng, currentLoc.lat, currentLoc.lng);
      if (moved < 40 && drivingRoute) return; // avoid unnecessary refetches
    }

    let isMounted = true;
    const fetchUrl = `/api/directions?startLng=${currentLoc.lng}&startLat=${currentLoc.lat}&endLng=${entranceLng}&endLat=${entranceLat}&mode=driving`;

    fetch(fetchUrl)
      .then((res) => res.json())
      .then((data) => {
        if (!isMounted) return;
        if (data.coordinates && data.coordinates.length > 0) {
          setDrivingRoute(data.coordinates);
          setDrivingDistanceMeters(data.distanceMeters);
          setDrivingDurationSeconds(data.durationSeconds);
          if (data.steps && data.steps.length > 0) {
            setDrivingSteps(data.steps);
            setCurrentStepIndex(0);
          }
          lastFetchedLocRef.current = { lat: currentLoc.lat, lng: currentLoc.lng };
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.warn('Failed to fetch road directions:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [activeMode, currentLoc.lat, currentLoc.lng, entranceLat, entranceLng, drivingRoute]);

  // Calculate forward road bearing for driving perspective
  const initialRoadBearing = useMemo(() => {
    if (drivingRoute && drivingRoute.length > 3) {
      // Use bearing between start and 4th point along road for smooth alignment
      return calculateBearing(
        drivingRoute[0][1],
        drivingRoute[0][0],
        drivingRoute[Math.min(5, drivingRoute.length - 1)][1],
        drivingRoute[Math.min(5, drivingRoute.length - 1)][0]
      );
    }
    return calculateBearing(currentLoc.lat, currentLoc.lng, entranceLat, entranceLng);
  }, [drivingRoute, currentLoc.lat, currentLoc.lng, entranceLat, entranceLng]);

  // Center camera in Garmin / Google Maps driver view:
  // User placed near bottom third of the screen with 3D forward perspective
  const applyDriverCameraView = useCallback(
    (map: any, animate: boolean = true) => {
      if (!map) return;

      if (activeMode === 'driving') {
        // Driver 3D navigation mode (Garmin / Google Maps):
        // pitch: 56° perspective tilt, bearing oriented forward along the road,
        // offset: [0, 165] places the user dot centered near the bottom of the screen
        map.easeTo({
          center: [currentLoc.lng, currentLoc.lat],
          zoom: 16.6,
          pitch: 56,
          bearing: initialRoadBearing,
          offset: [0, 165],
          duration: animate ? 900 : 0,
        });
      } else {
        // Pedestrian walking mode: top-down 2D framing to grave plot
        const minLat = Math.min(currentLoc.lat, targetGrave.latitude);
        const maxLat = Math.max(currentLoc.lat, targetGrave.latitude);
        const minLng = Math.min(currentLoc.lng, targetGrave.longitude);
        const maxLng = Math.max(currentLoc.lng, targetGrave.longitude);

        map.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          {
            padding: { top: 100, bottom: 240, left: 50, right: 50 },
            maxZoom: 20,
            pitch: 0,
            bearing: 0,
            duration: animate ? 800 : 0,
          }
        );
      }
    },
    [activeMode, currentLoc.lat, currentLoc.lng, initialRoadBearing, targetGrave.latitude, targetGrave.longitude]
  );

  // Setup / Update Direction Line on top of Google Maps
  const setupRouteLayers = useCallback(
    (map: any) => {
      if (!map) return;

      let routeCoords: [number, number][];
      if (activeMode === 'driving') {
        routeCoords =
          drivingRoute && drivingRoute.length > 1
            ? drivingRoute
            : [
                [currentLoc.lng, currentLoc.lat],
                [entranceLng, entranceLat],
              ];
      } else {
        // Walking path directly to grave
        routeCoords = [
          [currentLoc.lng, currentLoc.lat],
          [targetGrave.longitude, targetGrave.latitude],
        ];
      }

      const routeGeoJSON = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: routeCoords,
        },
      };

      try {
        if (map.getSource('navigation-route')) {
          map.getSource('navigation-route').setData(routeGeoJSON);
        } else {
          map.addSource('navigation-route', {
            type: 'geojson',
            data: routeGeoJSON,
          });

          // Glow layer
          map.addLayer({
            id: 'navigation-route-glow',
            type: 'line',
            source: 'navigation-route',
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
            },
            paint: {
              'line-color': activeMode === 'driving' ? '#2563EB' : '#10B981',
              'line-width': 8,
              'line-blur': 3,
              'line-opacity': 0.8,
            },
          });

          // Line layer
          map.addLayer({
            id: 'navigation-route-line',
            type: 'line',
            source: 'navigation-route',
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
            },
            paint: {
              'line-color': activeMode === 'driving' ? '#60A5FA' : '#FFFFFF',
              'line-width': activeMode === 'driving' ? 5 : 3.5,
              'line-opacity': 0.95,
              ...(activeMode === 'walking' ? { 'line-dasharray': [3, 2] } : {}),
            },
          });
        }

        // Update paint styling dynamically when mode changes
        if (map.getLayer('navigation-route-glow')) {
          map.setPaintProperty(
            'navigation-route-glow',
            'line-color',
            activeMode === 'driving' ? '#1D4ED8' : '#10B981'
          );
          map.setPaintProperty(
            'navigation-route-glow',
            'line-width',
            activeMode === 'driving' ? 10 : 8
          );
        }
        if (map.getLayer('navigation-route-line')) {
          map.setPaintProperty(
            'navigation-route-line',
            'line-color',
            activeMode === 'driving' ? '#38BDF8' : '#FFFFFF'
          );
          map.setPaintProperty(
            'navigation-route-line',
            'line-width',
            activeMode === 'driving' ? 5.5 : 3.5
          );
          if (activeMode === 'walking') {
            map.setPaintProperty('navigation-route-line', 'line-dasharray', [3, 2]);
          } else {
            // Remove dasharray to make solid highway line
            map.setPaintProperty('navigation-route-line', 'line-dasharray', undefined);
          }
        }
      } catch (err) {
        console.warn('Error setting up navigation route layer:', err);
      }
    },
    [
      activeMode,
      drivingRoute,
      currentLoc.lat,
      currentLoc.lng,
      entranceLat,
      entranceLng,
      targetGrave.latitude,
      targetGrave.longitude,
    ]
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

        // Initialize with driver perspective if in driving mode
        map = new maplibregl.Map({
          container: mapContainerRef.current,
          style: mapType === 'satellite' ? GOOGLE_SATELLITE_STYLE : GOOGLE_ROADMAP_STYLE,
          center: [currentLoc.lng, currentLoc.lat],
          zoom: 16.8,
          pitch: activeMode === 'driving' ? 52 : 0,
          bearing: activeMode === 'driving' ? initialRoadBearing : 0,
          minZoom: 10,
          maxZoom: 21,
          attributionControl: false,
        });

        mapInstanceRef.current = map;

        // Custom HTML Marker for Target Grave Plot
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

        // Custom HTML Marker for Cemetery Entrance Gate
        const entranceEl = document.createElement('div');
        entranceEl.className = 'navigation-entrance-pin';
        entranceEl.innerHTML = `
          <div class="flex flex-col items-center select-none cursor-pointer">
            <div class="bg-blue-950/90 backdrop-blur-md text-blue-100 border border-blue-400/50 text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-lg mb-1 whitespace-nowrap flex items-center space-x-1">
              <span>🚗</span>
              <span>${entranceName}</span>
            </div>
            <div class="relative flex items-center justify-center">
              <div class="w-7 h-7 rounded-full bg-blue-600 border-2 border-white text-white flex items-center justify-center shadow-lg shadow-blue-500/50">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/>
                  <circle cx="7" cy="17" r="2"/>
                  <circle cx="17" cy="17" r="2"/>
                </svg>
              </div>
              <div class="w-2 h-2 bg-blue-600 rotate-45 -mt-1 border-r border-b border-white"></div>
            </div>
          </div>
        `;

        entranceMarkerRef.current = new maplibregl.Marker({ element: entranceEl, anchor: 'bottom' })
          .setLngLat([entranceLng, entranceLat])
          .addTo(map);

        // Custom HTML Marker for User Vehicle / Dot with dynamic heading cone
        const userEl = document.createElement('div');
        userEl.className = 'navigation-user-dot';
        userEl.innerHTML = `
          <div class="relative flex items-center justify-center select-none">
            <div class="w-7 h-7 rounded-full bg-blue-600 border-[2.5px] border-white shadow-2xl flex items-center justify-center animate-user-pulse">
              <div class="w-2 h-2 rounded-full bg-white"></div>
            </div>
            <div class="user-heading-pointer absolute -top-3.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[10px] border-b-blue-400 drop-shadow-md" style="transform: rotate(${headingDeg}deg); transform-origin: center bottom;"></div>
          </div>
        `;

        userMarkerRef.current = new maplibregl.Marker({ element: userEl, anchor: 'center' })
          .setLngLat([currentLoc.lng, currentLoc.lat])
          .addTo(map);

        map.on('load', () => {
          if (isCancelled) return;
          setIsMapReady(true);
          setupRouteLayers(map);
          applyDriverCameraView(map, false);

          setTimeout(() => {
            if (mapInstanceRef.current) {
              baseZoomRef.current = mapInstanceRef.current.getZoom();
              setZoomDisplay(100);
            }
          }, 80);
        });

        // User drag gesture unlocks follow mode (free look)
        map.on('dragstart', () => {
          setIsFollowingUser(false);
        });

        // Update screen projection for live zoom % and badges
        const handleMapTransform = () => {
          if (!map) return;
          const currentZoom = map.getZoom();
          const base = baseZoomRef.current || 16.8;
          const pct = Math.max(25, Math.min(600, Math.round(Math.pow(2, currentZoom - base) * 100)));
          setZoomDisplay(pct);

          // In driving mode, if route exists, calculate position
          if (activeMode === 'driving' && drivingRoute && drivingRoute.length > 1) {
            const pt = map.project([drivingRoute[Math.floor(drivingRoute.length / 2)][0], drivingRoute[Math.floor(drivingRoute.length / 2)][1]]);
            setMidpointScreenPos({ x: pt.x, y: pt.y });
          } else {
            const pt = map.project([(currentLoc.lng + targetGrave.longitude) / 2, (currentLoc.lat + targetGrave.latitude) / 2]);
            setMidpointScreenPos({ x: pt.x, y: pt.y });
          }
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
      if (entranceMarkerRef.current) {
        entranceMarkerRef.current.remove();
        entranceMarkerRef.current = null;
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

  // Update route layer, markers, and follow-me tracking as user moves
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (map && isMapReady) {
      setupRouteLayers(map);

      if (userMarkerRef.current) {
        userMarkerRef.current.setLngLat([currentLoc.lng, currentLoc.lat]);
      }
      if (entranceMarkerRef.current) {
        entranceMarkerRef.current.setLngLat([entranceLng, entranceLat]);
      }

      // Update heading arrow rotation
      const pointer = document.querySelector('.user-heading-pointer') as HTMLElement;
      if (pointer) {
        pointer.style.transform = `rotate(${headingDeg}deg)`;
      }

      // Follow user camera in driving mode (keeps user at bottom third, forward perspective)
      if (isFollowingUser) {
        applyDriverCameraView(map, true);
      }
    }
  }, [
    activeMode,
    drivingRoute,
    currentLoc.lat,
    currentLoc.lng,
    entranceLat,
    entranceLng,
    headingDeg,
    isFollowingUser,
    isMapReady,
    setupRouteLayers,
    applyDriverCameraView,
  ]);

  // Zoom handlers
  const handleZoomIn = () => {
    if (mapInstanceRef.current) mapInstanceRef.current.zoomIn({ duration: 300 });
  };

  const handleZoomOut = () => {
    if (mapInstanceRef.current) mapInstanceRef.current.zoomOut({ duration: 300 });
  };

  // Re-center follow-me mode (Garmin / Google Maps driver view)
  const handleRecenter = () => {
    setIsFollowingUser(true);
    if (mapInstanceRef.current) {
      applyDriverCameraView(mapInstanceRef.current, true);
    }
  };

  const handleResetNorth = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.easeTo({ bearing: 0, pitch: 0, duration: 400 });
      setIsFollowingUser(false);
    }
  };

  const handleToggleMapType = () => {
    setMapType((prev) => (prev === 'satellite' ? 'roadmap' : 'satellite'));
  };

  const isNearby = distToGrave <= 12;
  const isAtGrave = distToGrave <= 3.5;

  // External turn-by-turn navigation URL for drivers
  const externalGoogleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${currentLoc.lat},${currentLoc.lng}&destination=${entranceLat},${entranceLng}&travelmode=driving`;

  // Current turn instruction from OSRM
  const activeStep = drivingSteps[currentStepIndex] || drivingSteps[0];
  const nextStep = drivingSteps[currentStepIndex + 1];

  // Helper to render maneuver icon
  const renderManeuverIcon = (step?: RouteStep) => {
    if (!step) return <Navigation className="w-6 h-6 text-white" />;
    const mod = step.modifier?.toLowerCase() || '';
    if (mod.includes('left')) return <CornerUpLeft className="w-7 h-7 text-white stroke-[2.5]" />;
    if (mod.includes('right')) return <CornerUpRight className="w-7 h-7 text-white stroke-[2.5]" />;
    if (step.type === 'arrive') return <CheckCircle2 className="w-7 h-7 text-white stroke-[2.5]" />;
    return <ArrowUp className="w-7 h-7 text-white stroke-[2.5]" />;
  };

  return (
    <div className="flex-1 flex flex-col relative bg-slate-950 overflow-hidden select-none">
      {/* Top Floating Navigation Bar */}
      <div className="absolute top-0 inset-x-0 z-20 px-4 pt-3 pb-2 bg-gradient-to-b from-black/90 via-black/60 to-transparent flex items-center justify-between text-white pointer-events-auto">
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
              <h1 className="text-sm font-bold tracking-tight">
                {activeMode === 'driving' ? 'Drive to Cemetery' : 'Navigate to Grave'}
              </h1>
              {wakeLock.isActive && (
                <span
                  className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-[9px] font-semibold text-emerald-300"
                  title="Screen stays awake while navigating"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Awake</span>
                </span>
              )}
            </div>
            <p className="text-[11px] text-emerald-300 font-medium truncate max-w-[190px]">
              {activeMode === 'driving'
                ? `🚗 ${entranceName}`
                : `${targetGrave.person?.fullName || 'Grave'} • Plot ${targetGrave.graveNumber}`}
            </p>
          </div>
        </div>

        {/* Mode Toggle & End Button */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center bg-white/15 backdrop-blur-md p-0.5 rounded-full border border-white/20">
            <button
              onClick={() => {
                setManualMode('driving');
                setIsFollowingUser(true);
              }}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
                activeMode === 'driving'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-white/75 hover:text-white'
              }`}
              title="Switch to driving directions to entrance"
            >
              <Car className="w-3.5 h-3.5" />
              <span>Drive</span>
            </button>
            <button
              onClick={() => {
                setManualMode('walking');
                setIsFollowingUser(false);
              }}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
                activeMode === 'walking'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-white/75 hover:text-white'
              }`}
              title="Switch to walking directions to grave"
            >
              <Footprints className="w-3.5 h-3.5" />
              <span>Walk</span>
            </button>
          </div>

          <button
            onClick={onEndNavigation}
            className="px-3.5 py-1 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-md text-xs font-semibold text-white transition-colors"
          >
            End
          </button>
        </div>
      </div>

      {/* Garmin / Google Maps Turn Guidance Banner (Only in Driving Mode) */}
      {activeMode === 'driving' && (
        <div className="absolute top-14 inset-x-3 z-20 pointer-events-auto transition-all duration-300">
          <div className="bg-emerald-800/95 backdrop-blur-md text-white rounded-2xl p-3.5 shadow-2xl border border-emerald-500/40 flex items-center justify-between">
            <div className="flex items-center space-x-3.5">
              <div className="w-11 h-11 rounded-xl bg-emerald-900/90 border border-emerald-400/50 flex items-center justify-center shrink-0 shadow-md">
                {renderManeuverIcon(activeStep)}
              </div>
              <div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-lg font-black tracking-tight text-white">
                    {activeStep ? `${activeStep.distanceMeters} m` : 'Drive'}
                  </span>
                  <span className="text-xs font-semibold text-emerald-200 truncate max-w-[220px]">
                    {activeStep?.instruction || `Proceed towards ${entranceName}`}
                  </span>
                </div>
                {nextStep && (
                  <p className="text-[11px] text-emerald-100/80 font-medium truncate max-w-[240px] mt-0.5">
                    Then {nextStep.instruction.toLowerCase()}
                  </p>
                )}
              </div>
            </div>

            {/* Maneuver steps counter & GPS Live indicator */}
            <div className="flex items-center space-x-2 shrink-0 pl-2">
              {drivingSteps.length > 1 && (
                <div className="flex items-center bg-black/30 rounded-lg p-0.5 border border-emerald-400/20">
                  <button
                    onClick={() => setCurrentStepIndex((prev) => Math.max(0, prev - 1))}
                    disabled={currentStepIndex === 0}
                    className="w-6 h-6 flex items-center justify-center text-white/80 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed text-xs font-bold active:scale-95 transition-transform"
                    title="Previous maneuver"
                  >
                    ‹
                  </button>
                  <span className="text-[10px] font-bold text-emerald-200 px-1 select-none">
                    {currentStepIndex + 1}/{drivingSteps.length}
                  </span>
                  <button
                    onClick={() => setCurrentStepIndex((prev) => Math.min(drivingSteps.length - 1, prev + 1))}
                    disabled={currentStepIndex >= drivingSteps.length - 1}
                    className="w-6 h-6 flex items-center justify-center text-white/80 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed text-xs font-bold active:scale-95 transition-transform"
                    title="Next maneuver"
                  >
                    ›
                  </button>
                </div>
              )}
              <span className="hidden sm:inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-400/30 text-[9px] font-bold text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                <span>GPS Live</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Main Google Maps Interactive Container */}
      <div className="flex-1 relative w-full h-full overflow-hidden">
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Floating Route Badge along the Direction Line (in Walking Mode) */}
        {activeMode === 'walking' && midpointScreenPos && (
          <div
            style={{
              left: `${midpointScreenPos.x}px`,
              top: `${midpointScreenPos.y}px`,
            }}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none transition-transform duration-75"
          >
            <div className="bg-slate-950/90 backdrop-blur-md text-white rounded-full py-1.5 px-3.5 shadow-xl border border-emerald-400/50 flex items-center space-x-1.5 text-xs font-bold whitespace-nowrap">
              <Footprints className="w-3.5 h-3.5 text-emerald-400" />
              <span>{Math.round(distToGrave)} m</span>
              <span className="text-emerald-400">•</span>
              <span className="text-emerald-200">Walk {cardinal}</span>
            </div>
          </div>
        )}

        {/* Re-center Follow-Me Driver Button (Appears if user panned away) */}
        {!isFollowingUser && activeMode === 'driving' && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
            <button
              onClick={handleRecenter}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2.5 rounded-full shadow-2xl border-2 border-white flex items-center space-x-2 active:scale-95 transition-all"
            >
              <Navigation className="w-4 h-4 fill-white" />
              <span>Re-center Driver View</span>
            </button>
          </div>
        )}

        {/* Floating Controls Toolbar (Top Right) */}
        <div
          className={`absolute right-3.5 z-20 flex flex-col space-y-2 pointer-events-auto transition-all ${
            activeMode === 'driving' ? 'top-32' : 'top-16'
          }`}
        >
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

          {/* Recenter View on User & Route */}
          <button
            onClick={handleRecenter}
            className={`w-10 h-10 rounded-full backdrop-blur-md shadow-lg border flex items-center justify-center active:scale-95 transition-all ${
              isFollowingUser
                ? 'bg-blue-600 text-white border-blue-500'
                : 'bg-white/95 text-slate-700 border-slate-200/80 hover:bg-white'
            }`}
            title="Recenter driver follow-me view"
          >
            <Crosshair className="w-5 h-5" />
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
        {activeMode === 'driving' ? (
          <>
            {/* Driving Mode Banner */}
            <div className="mb-3 p-2.5 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between text-blue-900 text-xs">
              <div className="flex items-center space-x-2">
                <Car className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="font-semibold">
                  Driver Navigation Mode: Positioned at bottom facing direction of travel.
                </span>
              </div>
            </div>

            {/* 3 Metric Cards for Driving: Road Distance, Est. Drive Time, Gate Name */}
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                <div className="text-xl font-extrabold text-blue-700">
                  {drivingDistanceMeters
                    ? `${(drivingDistanceMeters / 1000).toFixed(1)} km`
                    : `${(distToEntrance / 1000).toFixed(1)} km`}
                </div>
                <div className="text-[11px] text-slate-500 font-medium mt-0.5">Drive Distance</div>
              </div>

              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                <div className="text-xl font-extrabold text-slate-900">
                  ~
                  {drivingDurationSeconds
                    ? Math.max(1, Math.round(drivingDurationSeconds / 60))
                    : Math.max(1, Math.round(distToEntrance / 12.5 / 60))}{' '}
                  min
                </div>
                <div className="text-[11px] text-slate-500 font-medium mt-0.5">Drive Time</div>
              </div>

              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100 truncate">
                <div className="text-sm font-bold text-slate-800 truncate" title={entranceName}>
                  {entranceName.replace(/Main Gate|Gate/i, '').trim() || 'Entrance'}
                </div>
                <div className="text-[11px] text-slate-500 font-medium mt-0.5">Entrance Gate</div>
              </div>
            </div>

            {/* Action Buttons for Drivers */}
            <div className="mt-4 flex flex-col space-y-2">
              <button
                onClick={() => {
                  setManualMode('walking');
                  setIsFollowingUser(false);
                }}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-3 px-4 font-semibold text-xs flex items-center justify-center space-x-2 shadow-md active:scale-[0.99] transition-all"
              >
                <Footprints className="w-4 h-4" />
                <span>I have arrived at the gate (Switch to Walking)</span>
              </button>

              <a
                href={externalGoogleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl py-2.5 px-4 font-semibold text-xs flex items-center justify-center space-x-2 border border-slate-200 active:scale-[0.99] transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5 text-slate-600" />
                <span>Open in Google Maps / Waze for Audio Navigation</span>
              </a>
            </div>
          </>
        ) : (
          <>
            {/* Walking Mode Content */}
            {isAtGrave ? (
              <div className="mb-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center space-x-2 text-emerald-800 text-xs font-semibold animate-pulse">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  You have arrived! Grave {targetGrave.graveNumber} is right here (±
                  {targetGrave.positionAccuracyMeters}m).
                </span>
              </div>
            ) : isNearby ? (
              <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between text-amber-900 text-xs font-semibold">
                <span>Approaching target ({Math.round(distToGrave)}m). Switch to AR camera guidance?</span>
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
                <div className="text-xl font-extrabold text-emerald-700">{Math.round(distToGrave)} m</div>
                <div className="text-[11px] text-slate-500 font-medium mt-0.5">Walk Distance</div>
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
          </>
        )}
      </div>
    </div>
  );
};
