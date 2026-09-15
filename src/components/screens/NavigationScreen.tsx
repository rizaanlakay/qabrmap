'use client';

import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
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
  snapToRoute,
} from '@/lib/geospatial';
import { useWakeLock } from '@/lib/device/useWakeLock';
import { useCompassHeading } from '@/lib/device/useCompassHeading';
import { graveNumberLabel } from '@/lib/ui/graveLabels';
import { escapeHtml } from '@/lib/ui/escapeHtml';
import { VisitConfirmButton } from '@/components/common/VisitConfirmButton';
import { LookForThisGrave } from '@/components/common/LookForThisGrave';
import type { VisitFix } from '@/lib/graves/visits';
import {
  SHEET_CLICK_SUPPRESS_MS,
  SHEET_DRAG_THRESHOLD_PX,
  SHEET_EASING,
  SHEET_FLICK_MAX_IDLE_MS,
  SHEET_PEEK_GAP_PX,
  SHEET_SNAP_MS,
  clampSheetOffset,
  mapPaddingForSheet,
  shouldCollapseSheet,
} from '@/lib/ui/bottomSheet';
import { googleRasterStyle, registerGoogleTilesProtocol } from '@/lib/map/googleMapTiles';
import {
  REROUTE_OFF_ROUTE_METERS,
  computeRouteProgress,
  formatManeuverDistance,
  isUsableGpsFix,
  shouldReroute,
} from '@/lib/geospatial/routeProgress';
import { GoogleMapsAttribution } from '@/components/common/GoogleMapsAttribution';

// Keeps a floating map control a fixed gap above the visible top edge of the bottom sheet
function aboveSheetStyle(gapPx: number): React.CSSProperties {
  return {
    bottom: `calc(var(--sheet-visible, 0px) + ${gapPx}px)`,
    transition: `bottom var(--sheet-transition, 0ms) ${SHEET_EASING}`,
  };
}

// How long the vehicle arrow takes to glide to a new GPS fix
const MARKER_GLIDE_MS = 900;
// Beyond this the arrow jumps instead of gliding (first real fix, or a reroute)
const MARKER_GLIDE_MAX_METERS = 200;
// How often to check again for directions while the route is missing or wrong, even if the phone isn't moving
const ROUTE_RETRY_INTERVAL_MS = 5000;

interface RouteStep {
  instruction: string;
  streetName: string;
  distanceMeters: number;
  durationSeconds: number;
  type: string;
  modifier?: string;
  location: [number, number];
  bearingAfter?: number;
  bearingBefore?: number;
  exit?: string;
  ref?: string;
  destinations?: string;
}

interface NavigationScreenProps {
  targetGrave: Grave;
  cemetery?: Cemetery;
  userLocation: { lat: number; lng: number };
  onUpdateUserLocation?: (loc: { lat: number; lng: number }) => void;
  onOpenARGuidance: () => void;
  // Present only for signed-in users; records "I found it" as a position observation
  onConfirmVisit?: (grave: Grave, fix: VisitFix) => Promise<Grave>;
  onEndNavigation: () => void;
  onBack: () => void;
}

// Official Google Map Tiles, loaded through the gmaptiles:// protocol registered when the map starts
const GOOGLE_SATELLITE_STYLE = googleRasterStyle('satellite');
const GOOGLE_ROADMAP_STYLE = googleRasterStyle('roadmap');

// Calculate compass bearing along a road route from a given coordinate looking ahead 25-40m
function getRoadBearingAtCoordinate(
  route: [number, number][],
  coord: [number, number], // [lng, lat]
  fallbackBearing: number = 0
): number {
  if (!route || route.length < 2) return fallbackBearing;

  let closestIdx = 0;
  let minD = Infinity;
  for (let i = 0; i < route.length; i++) {
    const d = calculateDistanceMeters(coord[1], coord[0], route[i][1], route[i][0]);
    if (d < minD) {
      minD = d;
      closestIdx = i;
    }
  }

  // Look ahead along the route for at least 25-40 meters to get the true road tangent
  let targetIdx = closestIdx;
  let accumulatedDist = 0;
  for (let i = closestIdx + 1; i < route.length; i++) {
    accumulatedDist += calculateDistanceMeters(
      route[i - 1][1],
      route[i - 1][0],
      route[i][1],
      route[i][0]
    );
    targetIdx = i;
    if (accumulatedDist >= 25) {
      break;
    }
  }

  if (targetIdx === closestIdx && closestIdx > 0) {
    return calculateBearing(
      route[closestIdx - 1][1],
      route[closestIdx - 1][0],
      route[closestIdx][1],
      route[closestIdx][0]
    );
  }

  if (targetIdx !== closestIdx) {
    return calculateBearing(
      route[closestIdx][1],
      route[closestIdx][0],
      route[targetIdx][1],
      route[targetIdx][0]
    );
  }

  return fallbackBearing;
}

// Generate HTML for User Marker (Garmin/Google Maps 3D Arrow in Driving Mode; Pedestrian Dot in Walking Mode)
function getUserMarkerHtml(mode: 'driving' | 'walking', heading: number): string {
  if (mode === 'driving') {
    return `
      <div class="user-vehicle-marker flex items-center justify-center select-none filter drop-shadow-[0_4px_12px_rgba(37,99,235,0.7)] pointer-events-none">
        <div class="absolute w-12 h-12 rounded-full bg-blue-500/20 animate-ping"></div>
        <div class="relative w-10 h-10 flex items-center justify-center">
          <svg viewBox="0 0 36 36" class="w-9 h-9 drop-shadow-md" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18 3L31 31L18 24.5L5 31L18 3Z" fill="white" stroke="#1D4ED8" stroke-width="2.2" stroke-linejoin="round"/>
            <path d="M18 5.5L28.5 28.5L18 23.2L7.5 28.5L18 5.5Z" fill="url(#nav-arrow-grad)"/>
            <defs>
              <linearGradient id="nav-arrow-grad" x1="18" y1="5.5" x2="18" y2="28.5" gradientUnits="userSpaceOnUse">
                <stop stop-color="#60A5FA"/>
                <stop offset="1" stop-color="#1D4ED8"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>
    `;
  }

  return `
    <div class="relative flex items-center justify-center select-none pointer-events-none">
      <div class="w-7 h-7 rounded-full bg-blue-600 border-[2.5px] border-white shadow-2xl flex items-center justify-center animate-user-pulse">
        <div class="w-2 h-2 rounded-full bg-white"></div>
      </div>
      <div class="user-heading-pointer absolute -top-3.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[10px] border-b-blue-400 drop-shadow-md" style="transform: rotate(${heading}deg); transform-origin: center bottom;"></div>
    </div>
  `;
}

export const NavigationScreen: React.FC<NavigationScreenProps> = ({
  targetGrave,
  cemetery,
  userLocation: initialUserLoc,
  onUpdateUserLocation,
  onOpenARGuidance,
  onConfirmVisit,
  onEndNavigation,
  onBack,
}) => {
  // Keep mobile screen awake during navigation
  useWakeLock(true);

  // User GPS position
  const [currentLoc, setCurrentLoc] = useState(initialUserLoc);
  const [headingDeg, setHeadingDeg] = useState(42);
  // waiting: no fix yet, so the arrow still sits on the default start; denied/unavailable: no fixes are coming
  const [gpsStatus, setGpsStatus] = useState<'waiting' | 'live' | 'denied' | 'unavailable'>('waiting');
  // Accuracy of the latest fix, for "I found it"
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [mapType, setMapType] = useState<'satellite' | 'roadmap'>('satellite');
  const [zoomDisplay, setZoomDisplay] = useState(100);
  const [isMapReady, setIsMapReady] = useState(false);
  const [mapBearing, setMapBearing] = useState(0);

  // Manual mode override: 'auto' | 'driving' | 'walking'
  const [manualMode, setManualMode] = useState<'auto' | 'driving' | 'walking'>('auto');

  // Follow user camera mode (Garmin / Google Maps driver tracking)
  const [isFollowingUser, setIsFollowingUser] = useState(true);

  // Driving route data from /api/directions
  const [drivingRoute, setDrivingRoute] = useState<[number, number][] | null>(null);
  const [drivingSteps, setDrivingSteps] = useState<RouteStep[]>([]);
  // A step the driver is previewing with the ‹ › buttons; null while following live progress along the route
  const [previewStepIndex, setPreviewStepIndex] = useState<number | null>(null);
  const [drivingDistanceMeters, setDrivingDistanceMeters] = useState<number | null>(null);
  const [drivingDurationSeconds, setDrivingDurationSeconds] = useState<number | null>(null);
  const lastRouteFetchAtRef = useRef(0);
  const routeRequestRef = useRef<AbortController | null>(null);

  // Screen position of midpoint on the route for floating distance pill
  const [midpointScreenPos, setMidpointScreenPos] = useState<{ x: number; y: number } | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const entranceMarkerRef = useRef<any>(null);
  const targetMarkerRef = useRef<any>(null);
  const baseZoomRef = useRef<number>(17.0);

  // Swipeable bottom sheet. Position lives in CSS variables on the root so dragging doesn't re-render the screen.
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetPeekRef = useRef<HTMLDivElement>(null);
  const [isSheetExpanded, setIsSheetExpanded] = useState(true);
  const sheetExpandedRef = useRef(true);
  const sheetHeightRef = useRef(0);
  const sheetCollapsedOffsetRef = useRef(0);
  const sheetOffsetRef = useRef(0);
  const sheetVisibleRef = useRef(0);
  const sheetDragRef = useRef<{
    pointerId: number;
    startY: number;
    startOffset: number;
    lastY: number;
    lastTime: number;
    velocity: number;
    dragging: boolean;
  } | null>(null);
  const suppressSheetClickUntilRef = useRef(0);

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

  // Road-snapped user location for driving navigation (aligns vehicle arrow directly on the road route)
  const displayedUserLoc = useMemo(() => {
    if (activeMode === 'driving' && drivingRoute && drivingRoute.length > 0) {
      const snapped = snapToRoute(currentLoc, drivingRoute, 75);
      if (snapped.snapped) {
        return { lat: snapped.lat, lng: snapped.lng };
      }
    }
    return currentLoc;
  }, [activeMode, drivingRoute, currentLoc]);

  // Live position along the driving route: current step, distance to the next turn, and what's left of the trip
  const routeProgress = useMemo(
    () =>
      activeMode === 'driving' && drivingRoute
        ? computeRouteProgress({
            route: drivingRoute,
            steps: drivingSteps,
            position: currentLoc,
            totalDurationSeconds: drivingDurationSeconds,
          })
        : null,
    [activeMode, drivingRoute, drivingSteps, currentLoc, drivingDurationSeconds]
  );

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

  // Heading from the shared true-north compass, so it matches the direction saved when a grave was captured
  const { heading: compassHeading } = useCompassHeading();
  useEffect(() => {
    if (compassHeading !== null) setHeadingDeg(compassHeading);
  }, [compassHeading]);

  // Latest location callback, read through a ref so a new function from the parent can't restart the GPS watch
  const onUpdateUserLocationRef = useRef(onUpdateUserLocation);
  useEffect(() => {
    onUpdateUserLocationRef.current = onUpdateUserLocation;
  }, [onUpdateUserLocation]);

  // Real GPS Geolocation watcher if supported. Started once per visit: restarting it on every render
  // switched location tracking off and on hundreds of times a second, flickering Android's status bar.
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      let lastFix: { lat: number; lng: number } | null = null;
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          // A 0,0 or malformed fix means the device has no real position; keep the last good one instead
          if (!isUsableGpsFix(next.lat, next.lng)) return;
          setGpsStatus('live');
          setGpsAccuracy(pos.coords.accuracy);
          // A stationary device repeats the same fix; skip it rather than re-render the map for nothing
          if (lastFix && lastFix.lat === next.lat && lastFix.lng === next.lng) return;
          lastFix = next;
          setCurrentLoc(next);
          onUpdateUserLocationRef.current?.(next);
        },
        (error) => {
          // A denied permission is final; timeouts and lost signal usually recover with the next fix
          setGpsStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, []);

  // Fetch road directions when driving: once at the start, then again only when the driver leaves the route
  const offRouteMeters = routeProgress?.offRouteMeters ?? 0;
  const needsRoute = activeMode === 'driving' && (!drivingRoute || offRouteMeters > REROUTE_OFF_ROUTE_METERS);
  // Whether the current route was planned from a real GPS fix rather than the default start position
  const routeFromLiveFixRef = useRef(false);
  const [routeRetryTick, setRouteRetryTick] = useState(0);

  // A parked phone produces no new GPS fixes, so check again on a timer while the route is missing or wrong
  useEffect(() => {
    if (!needsRoute) return;
    const timer = window.setInterval(() => setRouteRetryTick((tick) => tick + 1), ROUTE_RETRY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [needsRoute]);

  useEffect(() => {
    if (activeMode !== 'driving' || routeRequestRef.current) return;
    // The first real GPS fix replaces a route planned from the default start straight away, without the reroute wait
    const plannedFromStartGuess =
      Boolean(drivingRoute) && !routeFromLiveFixRef.current && gpsStatus === 'live' && offRouteMeters > REROUTE_OFF_ROUTE_METERS;
    if (
      !plannedFromStartGuess &&
      !shouldReroute({
        hasRoute: Boolean(drivingRoute),
        offRouteMeters,
        msSinceLastFetch: Date.now() - lastRouteFetchAtRef.current,
      })
    ) {
      return;
    }

    // Not cancelled when the position changes: with a GPS fix every second, that discarded every reroute mid-drive
    const controller = new AbortController();
    routeRequestRef.current = controller;
    lastRouteFetchAtRef.current = Date.now();
    routeFromLiveFixRef.current = gpsStatus === 'live';
    const fetchUrl = `/api/directions?startLng=${currentLoc.lng}&startLat=${currentLoc.lat}&endLng=${entranceLng}&endLat=${entranceLat}&mode=driving`;

    fetch(fetchUrl, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (data.coordinates && data.coordinates.length > 0) {
          setDrivingRoute(data.coordinates);
          setDrivingDistanceMeters(data.distanceMeters);
          setDrivingDurationSeconds(data.durationSeconds);
          if (data.steps && data.steps.length > 0) {
            setDrivingSteps(data.steps);
            setPreviewStepIndex(null);
          }
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.warn('Failed to fetch road directions:', err);
      })
      .finally(() => {
        if (routeRequestRef.current === controller) routeRequestRef.current = null;
      });
  }, [activeMode, currentLoc.lat, currentLoc.lng, entranceLat, entranceLng, drivingRoute, offRouteMeters, gpsStatus, routeRetryTick]);

  // Abandon an in-flight directions request when leaving the screen
  useEffect(() => () => routeRequestRef.current?.abort(), []);

  // Direct bearing to entrance gate as foundational baseline
  const directEntranceBearing = useMemo(() => {
    return calculateBearing(currentLoc.lat, currentLoc.lng, entranceLat, entranceLng);
  }, [currentLoc.lat, currentLoc.lng, entranceLat, entranceLng]);

  // Current turn instruction: the step live progress has reached, unless the driver is previewing another one
  const liveStepIndex = routeProgress ? Math.min(routeProgress.stepIndex, Math.max(0, drivingSteps.length - 1)) : 0;
  const isPreviewingStep = previewStepIndex !== null;
  const currentStepIndex = previewStepIndex ?? liveStepIndex;
  const activeStep = drivingSteps[currentStepIndex] || drivingSteps[0];
  const nextStep = drivingSteps[currentStepIndex + 1];

  // Helper: Find the next turn maneuver to display on the HUD sign (always matches the upcoming "Then..." guidance)
  const nextTurnStep = useMemo(() => {
    if (!drivingSteps || drivingSteps.length === 0) return activeStep;
    return nextStep || activeStep;
  }, [drivingSteps, activeStep, nextStep]);

  // Active vehicle marker location on map:
  // While previewing a manoeuvre, the vehicle marker moves to that manoeuvre's location.
  // While live navigating, it sits at displayedUserLoc (snapped to road).
  const vehicleMarkerCoord = useMemo<[number, number]>(() => {
    if (activeMode === 'driving' && isPreviewingStep && activeStep?.location && activeStep.location[0] !== 0) {
      return activeStep.location;
    }
    return [displayedUserLoc.lng, displayedUserLoc.lat];
  }, [activeMode, isPreviewingStep, activeStep, displayedUserLoc.lng, displayedUserLoc.lat]);

  // Calculate forward road bearing so that "UP" on the map ALWAYS aligns with the road we travel in
  const activeRoadBearing = useMemo(() => {
    // 1. Previewing a manoeuvre: face the way the road goes after it
    if (isPreviewingStep && activeStep?.bearingAfter !== undefined && activeStep.bearingAfter !== null) {
      return activeStep.bearingAfter;
    }

    // 2. Live: follow the road just ahead of the driver so the map turns through bends as they drive
    if (drivingRoute && drivingRoute.length > 1) {
      const coord: [number, number] =
        isPreviewingStep && activeStep?.location && activeStep.location[0] !== 0
          ? activeStep.location
          : [displayedUserLoc.lng, displayedUserLoc.lat];
      return getRoadBearingAtCoordinate(drivingRoute, coord, activeStep?.bearingAfter ?? directEntranceBearing);
    }

    // 3. No route yet: the step's own bearing, otherwise straight towards the gate
    if (activeStep?.bearingAfter !== undefined && activeStep.bearingAfter !== null) {
      return activeStep.bearingAfter;
    }
    return directEntranceBearing;
  }, [isPreviewingStep, activeStep, drivingRoute, displayedUserLoc.lat, displayedUserLoc.lng, directEntranceBearing]);

  // Center camera in Garmin / Google Maps driver view:
  // User placed near bottom third of the screen with 3D forward perspective and road aligned UP
  const applyDriverCameraView = useCallback(
    (map: any, animate: boolean = true) => {
      if (!map) return;

      if (activeMode === 'driving') {
        // When previewing a manoeuvre, frame on its location;
        // When live navigating, center on user's road-snapped location:
        const targetCenter: [number, number] =
          isPreviewingStep && activeStep?.location && activeStep.location[0] !== 0
            ? [activeStep.location[0], activeStep.location[1]]
            : [displayedUserLoc.lng, displayedUserLoc.lat];

        // Driver 3D navigation mode (Garmin / Google Maps):
        // pitch: 58° perspective tilt, bearing aligned so UP is the road direction,
        // offset: [0, 165] places the user dot centered near the bottom of the screen
        map.easeTo({
          center: targetCenter,
          zoom: 16.8,
          pitch: 58,
          bearing: activeRoadBearing,
          offset: [0, 165],
          padding: mapPaddingForSheet(sheetVisibleRef.current),
          duration: animate ? 800 : 0,
        });
      } else {
        // Pedestrian walking mode: top-down 2D framing to grave plot
        const minLat = Math.min(currentLoc.lat, targetGrave.latitude);
        const maxLat = Math.max(currentLoc.lat, targetGrave.latitude);
        const minLng = Math.min(currentLoc.lng, targetGrave.longitude);
        const maxLng = Math.max(currentLoc.lng, targetGrave.longitude);

        // cameraForBounds sizes the fit with the map's current padding plus these options, but centres using
        // only the options. Size against the sheet padding we ease to, and offset away the extra centre shift.
        const sheetPadding = mapPaddingForSheet(sheetVisibleRef.current);
        const paddingDelta = sheetPadding.bottom - (map.getPadding()?.bottom ?? 0);
        const camera = map.cameraForBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          {
            padding: { top: 100, bottom: 240 + paddingDelta, left: 50, right: 50 },
            offset: [0, paddingDelta / 2],
            maxZoom: 20,
            bearing: 0,
          }
        );
        if (camera) {
          map.easeTo({ ...camera, pitch: 0, padding: sheetPadding, duration: animate ? 800 : 0 });
        }
      }
    },
    [activeMode, isPreviewingStep, activeStep, displayedUserLoc.lat, displayedUserLoc.lng, currentLoc.lat, currentLoc.lng, activeRoadBearing, targetGrave.latitude, targetGrave.longitude]
  );

  // Handle step selection (e.g. clicking ‹ / › on the maneuver badge)
  const handleSelectStep = useCallback(
    (newIndex: number) => {
      if (!drivingSteps || newIndex < 0 || newIndex >= drivingSteps.length) return;
      // Stepping back to where the driver actually is resumes live guidance
      const isLiveStep = newIndex === liveStepIndex;
      setPreviewStepIndex(isLiveStep ? null : newIndex);

      const step = drivingSteps[newIndex];
      const map = mapInstanceRef.current;
      if (!map) return;

      let stepBearing = step.bearingAfter;
      if (stepBearing === undefined || stepBearing === null) {
        stepBearing = drivingRoute
          ? getRoadBearingAtCoordinate(drivingRoute, step.location, directEntranceBearing)
          : directEntranceBearing;
      }

      const targetCoord: [number, number] =
        isLiveStep
          ? [displayedUserLoc.lng, displayedUserLoc.lat]
          : step.location && step.location[0] !== 0
          ? step.location
          : [displayedUserLoc.lng, displayedUserLoc.lat];

      // Move the blue vehicle arrow marker along with the scrubbed turn
      if (userMarkerRef.current) {
        userMarkerRef.current.setLngLat(targetCoord);
      }

      map.easeTo({
        center: targetCoord,
        zoom: 16.8,
        pitch: 58,
        bearing: stepBearing,
        offset: [0, 165],
        padding: mapPaddingForSheet(sheetVisibleRef.current),
        duration: 700,
      });
    },
    [drivingSteps, drivingRoute, displayedUserLoc.lng, displayedUserLoc.lat, directEntranceBearing, liveStepIndex]
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
        // Adding layers while a style is still (re)loading throws; draw the line once it has loaded instead of dropping it
        if (err instanceof Error && /style is not done loading/i.test(err.message)) {
          map.once('style.load', () => setupRouteLayersRef.current(map));
          return;
        }
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

  // Latest route drawer, for redrawing after a style finishes loading
  const setupRouteLayersRef = useRef(setupRouteLayers);
  useEffect(() => {
    setupRouteLayersRef.current = setupRouteLayers;
  }, [setupRouteLayers]);

  // Initialize MapLibre GL with Google Maps raster tiles
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

        // Initialize with driver perspective if in driving mode
        map = new maplibregl.Map({
          container: mapContainerRef.current,
          style: mapType === 'satellite' ? GOOGLE_SATELLITE_STYLE : GOOGLE_ROADMAP_STYLE,
          center: [currentLoc.lng, currentLoc.lat],
          zoom: 16.8,
          pitch: activeMode === 'driving' ? 58 : 0,
          bearing: activeMode === 'driving' ? directEntranceBearing : 0,
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
              ${escapeHtml(targetGrave.person?.fullName || graveNumberLabel(targetGrave) || 'Grave')}
            </div>
            <div class="relative flex items-center justify-center">
              <div class="w-8 h-8 rounded-full bg-emerald-600 border-2 border-white text-white flex items-center justify-center shadow-lg shadow-emerald-500/50 animate-radar">
                <span class="text-[10px] font-black">${escapeHtml(targetGrave.graveNumber.slice(-4))}</span>
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
              <span>${escapeHtml(entranceName)}</span>
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

        // Custom HTML Marker for User Vehicle / Dot (Garmin/Google Maps 3D Arrow in Driving, Dot in Walking)
        const userEl = document.createElement('div');
        userEl.className = 'navigation-user-marker';
        userEl.innerHTML = getUserMarkerHtml(activeMode, headingDeg);

        userMarkerRef.current = new maplibregl.Marker({ element: userEl, anchor: 'center' })
          .setLngLat(vehicleMarkerCoord)
          .addTo(map);

        // Draw the route as soon as the style is ready. The 'load' event only fires once every visible satellite
        // tile has downloaded, which in the tilted driving view kept the line off the map for seconds.
        let styleReadyHandled = false;
        const handleStyleReady = () => {
          if (isCancelled || styleReadyHandled) return;
          styleReadyHandled = true;
          setIsMapReady(true);
          setupRouteLayers(map);
          applyDriverCameraView(map, false);

          setTimeout(() => {
            if (mapInstanceRef.current) {
              baseZoomRef.current = mapInstanceRef.current.getZoom();
              setZoomDisplay(100);
            }
          }, 80);
        };
        map.once('style.load', handleStyleReady);
        if (map.isStyleLoaded()) handleStyleReady();

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
          setMapBearing(Math.round(map.getBearing()));

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

  // Glide the vehicle arrow between GPS fixes instead of jumping, like in-car navigation
  const markerAnimationRef = useRef<number | null>(null);
  const animateUserMarkerTo = useCallback((target: [number, number], durationMs: number) => {
    const marker = userMarkerRef.current;
    if (!marker) return;
    if (markerAnimationRef.current !== null) cancelAnimationFrame(markerAnimationRef.current);
    markerAnimationRef.current = null;

    const from = marker.getLngLat();
    const glideMeters = from ? calculateDistanceMeters(from.lat, from.lng, target[1], target[0]) : Infinity;
    if (durationMs <= 0 || glideMeters > MARKER_GLIDE_MAX_METERS) {
      marker.setLngLat(target);
      return;
    }

    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      marker.setLngLat([from.lng + (target[0] - from.lng) * eased, from.lat + (target[1] - from.lat) * eased]);
      markerAnimationRef.current = t < 1 ? requestAnimationFrame(frame) : null;
    };
    markerAnimationRef.current = requestAnimationFrame(frame);
  }, []);

  useEffect(
    () => () => {
      if (markerAnimationRef.current !== null) cancelAnimationFrame(markerAnimationRef.current);
    },
    []
  );

  // Update route layer, markers, and follow-me tracking as user moves or scrubs steps
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (map && isMapReady) {
      setupRouteLayers(map);

      if (userMarkerRef.current) {
        animateUserMarkerTo(vehicleMarkerCoord, isPreviewingStep ? 0 : MARKER_GLIDE_MS);
        const el = userMarkerRef.current.getElement();
        if (el) {
          el.innerHTML = getUserMarkerHtml(activeMode, headingDeg);
        }
      }
      if (entranceMarkerRef.current) {
        entranceMarkerRef.current.setLngLat([entranceLng, entranceLat]);
      }

      // Follow user camera in driving mode when not previewing an upcoming turn
      if (isFollowingUser && !isPreviewingStep) {
        applyDriverCameraView(map, true);
      }
    }
  }, [
    activeMode,
    drivingRoute,
    vehicleMarkerCoord,
    isPreviewingStep,
    entranceLat,
    entranceLng,
    headingDeg,
    isFollowingUser,
    isMapReady,
    setupRouteLayers,
    applyDriverCameraView,
    animateUserMarkerTo,
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
    setPreviewStepIndex(null);
    if (userMarkerRef.current) {
      userMarkerRef.current.setLngLat([displayedUserLoc.lng, displayedUserLoc.lat]);
    }
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

  // Slide the sheet to `offset` px below fully expanded and move the floating controls with it
  const applySheetOffset = useCallback((offset: number, animate: boolean) => {
    sheetOffsetRef.current = offset;
    sheetVisibleRef.current = Math.max(0, sheetHeightRef.current - offset);
    const root = rootRef.current;
    if (!root) return;
    root.style.setProperty('--sheet-offset', `${offset}px`);
    root.style.setProperty('--sheet-visible', `${sheetVisibleRef.current}px`);
    root.style.setProperty('--sheet-transition', animate ? `${SHEET_SNAP_MS}ms` : '0ms');
  }, []);

  const snapSheet = useCallback(
    (expanded: boolean) => {
      sheetExpandedRef.current = expanded;
      setIsSheetExpanded(expanded);
      applySheetOffset(expanded ? 0 : sheetCollapsedOffsetRef.current, true);
    },
    [applySheetOffset]
  );

  // Collapsed, only the handle and stats row stay visible. Re-measure when the content changes (e.g. Drive/Walk).
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    const peek = sheetPeekRef.current;
    if (!sheet || !peek) return;

    const measure = () => {
      sheetHeightRef.current = sheet.offsetHeight;
      sheetCollapsedOffsetRef.current = Math.max(
        0,
        sheet.offsetHeight - (peek.offsetTop + peek.offsetHeight + SHEET_PEEK_GAP_PX)
      );
      if (!sheetDragRef.current?.dragging) {
        applySheetOffset(sheetExpandedRef.current ? 0 : sheetCollapsedOffsetRef.current, false);
      }
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    observer.observe(peek);
    return () => observer.disconnect();
  }, [applySheetOffset]);

  // Re-frame the followed route into the space the sheet frees up or covers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isMapReady || !isFollowingUser || isPreviewingStep) return;
    applyDriverCameraView(map, true);
  }, [isSheetExpanded]);

  const handleSheetPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    suppressSheetClickUntilRef.current = 0;
    sheetDragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startOffset: sheetOffsetRef.current,
      lastY: e.clientY,
      lastTime: e.timeStamp,
      velocity: 0,
      dragging: false,
    };
  };

  const handleSheetPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = sheetDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    if (!drag.dragging) {
      if (Math.abs(e.clientY - drag.startY) < SHEET_DRAG_THRESHOLD_PX) return;
      drag.dragging = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Capture isn't available for synthetic or already-released pointers; dragging still works
      }
    }

    const elapsed = e.timeStamp - drag.lastTime;
    if (elapsed > 0) drag.velocity = (e.clientY - drag.lastY) / elapsed;
    drag.lastY = e.clientY;
    drag.lastTime = e.timeStamp;

    applySheetOffset(
      clampSheetOffset(drag.startOffset + e.clientY - drag.startY, sheetCollapsedOffsetRef.current),
      false
    );
  };

  const handleSheetPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = sheetDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    sheetDragRef.current = null;
    if (!drag.dragging) return;

    // The click a mouse drag produces must not press whichever button it started on. Touch swipes produce
    // no click, so this is a short window rather than a flag that would eat the next real tap or key press.
    suppressSheetClickUntilRef.current = e.timeStamp + SHEET_CLICK_SUPPRESS_MS;
    const released = e.timeStamp - drag.lastTime > SHEET_FLICK_MAX_IDLE_MS;
    snapSheet(
      !shouldCollapseSheet({
        offset: sheetOffsetRef.current,
        collapsedOffset: sheetCollapsedOffsetRef.current,
        velocity: released ? 0 : drag.velocity,
      })
    );
  };

  const handleSheetClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.timeStamp > suppressSheetClickUntilRef.current) return;
    suppressSheetClickUntilRef.current = 0;
    e.preventDefault();
    e.stopPropagation();
  };

  const isNearby = distToGrave <= 12;
  const isAtGrave = distToGrave <= 3.5;

  // Raise a collapsed sheet when the grave is close so the arrival and AR prompts aren't hidden
  useEffect(() => {
    if (isNearby) snapSheet(true);
  }, [isNearby, snapSheet]);

  // External turn-by-turn navigation URL for drivers
  const externalGoogleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${currentLoc.lat},${currentLoc.lng}&destination=${entranceLat},${entranceLng}&travelmode=driving`;

  // Helper to render maneuver icon
  const renderManeuverIcon = (step?: RouteStep) => {
    if (!step) return <Navigation className="w-6 h-6 text-white" />;
    if (step.type === 'arrive') return <CheckCircle2 className="w-7 h-7 text-white stroke-[2.5]" />;
    if (step.type === 'depart') return <ArrowUp className="w-7 h-7 text-white stroke-[2.5]" />;
    const mod = (step.modifier || '').toLowerCase();
    const inst = (step.instruction || '').toLowerCase();
    if (mod.includes('u-turn') || mod.includes('uturn') || inst.includes('u-turn')) return <RotateCcw className="w-7 h-7 text-white stroke-[2.5]" />;
    if (mod.includes('left') || inst.includes('turn left') || inst.includes('keep left') || inst.includes('bear left')) return <CornerUpLeft className="w-7 h-7 text-white stroke-[2.5]" />;
    if (mod.includes('right') || inst.includes('turn right') || inst.includes('keep right') || inst.includes('bear right')) return <CornerUpRight className="w-7 h-7 text-white stroke-[2.5]" />;
    return <ArrowUp className="w-7 h-7 text-white stroke-[2.5]" />;
  };

  return (
    <div ref={rootRef} className="flex-1 flex flex-col relative bg-slate-950 overflow-hidden select-none">
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
            <h1 className="text-sm font-bold tracking-tight">
              {activeMode === 'driving' ? 'Drive to Cemetery' : 'Navigate to Grave'}
            </h1>
            <p className="text-[11px] text-emerald-300 font-medium truncate max-w-[190px]">
              {activeMode === 'driving'
                ? `🚗 ${entranceName}`
                : [targetGrave.person?.fullName || 'Grave', targetGrave.graveNumber && `Plot ${targetGrave.graveNumber}`]
                    .filter(Boolean)
                    .join(' • ')}
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
          <div className="relative bg-emerald-800/95 backdrop-blur-md text-white rounded-2xl p-3.5 shadow-2xl border border-emerald-500/40 flex items-center justify-between">
            {/* Top-Right Maneuver Step Badge (e.g. 2/13) */}
            {drivingSteps.length > 1 && (
              <div className="absolute top-2.5 right-3 flex items-center bg-black/40 backdrop-blur-xs rounded-lg p-0.5 border border-emerald-400/25 z-10">
                <button
                  onClick={() => handleSelectStep(Math.max(0, currentStepIndex - 1))}
                  disabled={currentStepIndex === 0}
                  className="w-5 h-5 flex items-center justify-center text-white/80 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed text-xs font-bold active:scale-95 transition-transform"
                  title="Previous maneuver"
                >
                  ‹
                </button>
                <span className="text-[10px] font-bold text-emerald-200 px-1.5 select-none tracking-wider">
                  {currentStepIndex + 1}/{drivingSteps.length}
                </span>
                <button
                  onClick={() => handleSelectStep(Math.min(drivingSteps.length - 1, currentStepIndex + 1))}
                  disabled={currentStepIndex >= drivingSteps.length - 1}
                  className="w-5 h-5 flex items-center justify-center text-white/80 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed text-xs font-bold active:scale-95 transition-transform"
                  title="Next maneuver"
                >
                  ›
                </button>
              </div>
            )}

            <div className="flex items-center space-x-3.5 pr-16 w-full">
              <div className="flex flex-col items-center shrink-0">
                <div className="w-11 h-11 rounded-xl bg-emerald-900/90 border border-emerald-400/50 flex items-center justify-center shadow-md">
                  {renderManeuverIcon(nextTurnStep)}
                </div>
                <span className="text-[9px] font-bold text-emerald-200 uppercase tracking-wide mt-1 text-center select-none leading-none">
                  {nextTurnStep?.type === 'arrive' ? 'Destination' : 'Next Turn'}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline space-x-2 flex-wrap">
                  <span className="text-xl font-black tracking-tight text-white whitespace-nowrap shrink-0">
                    {activeStep
                      ? formatManeuverDistance(
                          !isPreviewingStep && routeProgress
                            ? routeProgress.distanceToNextManeuverMeters
                            : activeStep.distanceMeters
                        )
                      : 'Drive'}
                  </span>
                  <span className="text-xs font-semibold text-emerald-200 truncate max-w-[260px]">
                    {activeStep?.instruction || `Proceed towards ${entranceName}`}
                  </span>
                </div>
                {nextStep && (
                  <p className="text-[11px] text-emerald-100/80 font-medium truncate max-w-[300px] mt-0.5">
                    Then {nextStep.instruction ? (nextStep.instruction.charAt(0).toLowerCase() + nextStep.instruction.slice(1)) : ''}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Google Maps Interactive Container */}
      <div className="flex-1 relative w-full overflow-hidden">
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

        {/* GPS status: tells the driver when the arrow isn't following their real position */}
        {gpsStatus !== 'live' && (
          <div
            className={`absolute left-3.5 z-20 pointer-events-none ${activeMode === 'driving' ? 'top-44' : 'top-16'}`}
            role="status"
          >
            <div
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full shadow-lg text-[11px] font-semibold backdrop-blur-md ${
                gpsStatus === 'waiting' ? 'bg-slate-900/85 text-white' : 'bg-amber-500/95 text-amber-950'
              }`}
            >
              <Crosshair className={`w-3.5 h-3.5 ${gpsStatus === 'waiting' ? 'animate-pulse' : ''}`} />
              <span>
                {gpsStatus === 'waiting'
                  ? 'Waiting for GPS…'
                  : gpsStatus === 'denied'
                  ? 'Location access is blocked'
                  : 'GPS signal lost'}
              </span>
            </div>
          </div>
        )}

        {/* Re-center / Resume Live Navigation Button (Appears if user panned away or is scrubbing turns) */}
        {(!isFollowingUser || isPreviewingStep) && activeMode === 'driving' && (
          <div
            className="absolute left-1/2 -translate-x-1/2 z-20 pointer-events-auto"
            style={aboveSheetStyle(14)}
          >
            <button
              onClick={handleRecenter}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2.5 rounded-full shadow-2xl border-2 border-white flex items-center space-x-2 active:scale-95 transition-all"
            >
              <Navigation className="w-4 h-4 fill-white" />
              <span>{isPreviewingStep ? 'Resume Live Navigation' : 'Re-center Driver View'}</span>
            </button>
          </div>
        )}

        {/* Floating Controls Toolbar (Top Right) - Moved down below guidance card in driving mode */}
        <div
          className={`absolute right-3.5 z-20 flex flex-col space-y-2 pointer-events-auto transition-all ${
            activeMode === 'driving' ? 'top-44' : 'top-16'
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
            <Compass
              className="w-5 h-5 text-emerald-700 transition-transform duration-200"
              style={{ transform: `rotate(${-mapBearing}deg)` }}
            />
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

        {/* Google Maps logo and imagery copyright, required by the Map Tiles API terms */}
        <div className="absolute left-2.5 z-10 pointer-events-none" style={aboveSheetStyle(6)}>
          <GoogleMapsAttribution map={mapInstanceRef.current} mapType={mapType} isMapReady={isMapReady} />
        </div>
      </div>

      {/* Bottom Navigation Stats Drawer: swipe or tap the handle to slide it down to just the stats row */}
      <div
        ref={sheetRef}
        onPointerDown={handleSheetPointerDown}
        onPointerMove={handleSheetPointerMove}
        onPointerUp={handleSheetPointerEnd}
        onPointerCancel={handleSheetPointerEnd}
        onClickCapture={handleSheetClickCapture}
        style={{
          transform: 'translateY(var(--sheet-offset, 0px))',
          transition: `transform var(--sheet-transition, 0ms) ${SHEET_EASING}`,
        }}
        className="absolute inset-x-0 bottom-0 bg-white rounded-t-3xl shadow-[0_-4px_25px_rgba(0,0,0,0.18)] px-5 pb-5 z-30 border-t border-slate-100 pointer-events-auto touch-none"
      >
        {/* Drag Handle */}
        <button
          type="button"
          onClick={() => snapSheet(!isSheetExpanded)}
          aria-expanded={isSheetExpanded}
          aria-label={isSheetExpanded ? 'Collapse trip details' : 'Expand trip details'}
          className="w-full flex justify-center pt-2.5 pb-3 cursor-grab active:cursor-grabbing rounded-t-3xl focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          <span className="block w-10 h-1.5 rounded-full bg-slate-300" />
        </button>

        {/* Stats row: the part that stays visible when the sheet is collapsed */}
        <div ref={sheetPeekRef}>
          {activeMode === 'driving' ? (
            /* 3 Metric Cards for Driving: Road Distance, Est. Drive Time, Gate Name */
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                <div className="text-xl font-extrabold text-blue-700">
                  {`${((routeProgress?.remainingMeters ?? drivingDistanceMeters ?? distToEntrance) / 1000).toFixed(1)} km`}
                </div>
                <div className="text-[11px] text-slate-500 font-medium mt-0.5">Drive Distance</div>
              </div>

              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                <div className="text-xl font-extrabold text-slate-900">
                  ~
                  {Math.max(
                    1,
                    Math.round((routeProgress?.remainingSeconds ?? drivingDurationSeconds ?? distToEntrance / 12.5) / 60)
                  )}{' '}
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
          ) : (
            /* 3 Metric Stats Cards: Distance, Direction, Walk time */
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
          )}
        </div>

        {activeMode === 'driving' ? (
          <>
            {/* Driving Mode Banner */}
            <div className="mt-3 p-2.5 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between text-blue-900 text-xs">
              <div className="flex items-center space-x-2">
                <Car className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="font-semibold">
                  Driver Navigation Mode: Positioned at bottom facing direction of travel.
                </span>
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
              <div className="mt-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold">
                <div className="flex items-center space-x-2 animate-pulse">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    You have arrived! {graveNumberLabel(targetGrave) ?? targetGrave.person?.fullName ?? 'The grave'} is right here (±
                    {targetGrave.positionAccuracyMeters}m).
                  </span>
                </div>
                {targetGrave.gravePhotoUrl && <LookForThisGrave url={targetGrave.gravePhotoUrl} />}
                {onConfirmVisit && (
                  <VisitConfirmButton
                    grave={targetGrave}
                    fix={gpsAccuracy === null ? null : { lat: currentLoc.lat, lng: currentLoc.lng, accuracy: gpsAccuracy }}
                    onConfirm={onConfirmVisit}
                  />
                )}
              </div>
            ) : isNearby ? (
              <div className="mt-3 p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between text-amber-900 text-xs font-semibold">
                <span>Approaching target ({Math.round(distToGrave)}m). Switch to AR camera guidance?</span>
                <button
                  onClick={onOpenARGuidance}
                  className="ml-2 px-2.5 py-1 bg-amber-600 text-white rounded-lg text-[11px] font-bold active:scale-95 transition-transform"
                >
                  Open AR
                </button>
              </div>
            ) : null}

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
