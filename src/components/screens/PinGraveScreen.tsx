'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, LocateFixed, MapPinOff } from 'lucide-react';
import type { DeviceTelemetry, MapPin } from '@/types';
import { googleRasterStyle, MAX_MAP_ZOOM, registerGoogleTilesProtocol } from '@/lib/map/googleMapTiles';
import { checkPin, accuracyRing, PIN_MAP_MIN_ZOOM, PIN_MAP_ZOOM } from '@/lib/capture/mapPin';
import { GoogleMapsAttribution } from '@/components/common/GoogleMapsAttribution';

interface PinGraveScreenProps {
  telemetry: DeviceTelemetry;
  onPinned: (pin: MapPin) => void;
  onKeepGps: () => void;
  onBack: () => void;
}

const SATELLITE_STYLE = googleRasterStyle('satellite');
const FIX_SOURCE = 'gps-fix';

// After the stone photo: the satellite map at its deepest zoom, centred on the phone's fix, with a pin fixed
// in the middle of the screen. The user drags the map, not the pin, until the pin sits on the grave.
export const PinGraveScreen: React.FC<PinGraveScreenProps> = ({ telemetry, onPinned, onKeepGps, onBack }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  // Where the pin is: the map's centre
  const [center, setCenter] = useState<MapPin>({ latitude: telemetry.latitude, longitude: telemetry.longitude });

  const check = checkPin(telemetry, center);
  const canPin = isMapReady && !check.tooFar;

  useEffect(() => {
    let cancelled = false;
    let map: any = null;

    async function initMap() {
      if (!mapContainerRef.current) return;
      try {
        const mod = await import('maplibre-gl');
        const maplibregl = mod.default || mod;
        registerGoogleTilesProtocol(maplibregl);
        if (cancelled || !mapContainerRef.current) return;

        map = new maplibregl.Map({
          container: mapContainerRef.current,
          style: SATELLITE_STYLE,
          center: [telemetry.longitude, telemetry.latitude],
          zoom: PIN_MAP_ZOOM,
          minZoom: PIN_MAP_MIN_ZOOM,
          maxZoom: MAX_MAP_ZOOM,
          attributionControl: false,
          // North stays up, so the imagery matches the phone's own map and the compass
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });
        map.touchZoomRotate.disableRotation();
        mapRef.current = map;

        map.on('load', () => {
          if (cancelled) return;
          // The phone's fix and its accuracy circle, so the user can see how far GPS may be off
          map.addSource(FIX_SOURCE, {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  properties: { kind: 'accuracy' },
                  geometry: {
                    type: 'Polygon',
                    coordinates: [accuracyRing(telemetry.latitude, telemetry.longitude, telemetry.gpsAccuracy)],
                  },
                },
                {
                  type: 'Feature',
                  properties: { kind: 'fix' },
                  geometry: { type: 'Point', coordinates: [telemetry.longitude, telemetry.latitude] },
                },
              ],
            },
          });
          map.addLayer({
            id: 'gps-accuracy-fill',
            type: 'fill',
            source: FIX_SOURCE,
            filter: ['==', ['get', 'kind'], 'accuracy'],
            paint: { 'fill-color': '#3B82F6', 'fill-opacity': 0.15 },
          });
          map.addLayer({
            id: 'gps-accuracy-line',
            type: 'line',
            source: FIX_SOURCE,
            filter: ['==', ['get', 'kind'], 'accuracy'],
            paint: { 'line-color': '#3B82F6', 'line-width': 1.5, 'line-opacity': 0.8 },
          });
          map.addLayer({
            id: 'gps-fix-dot',
            type: 'circle',
            source: FIX_SOURCE,
            filter: ['==', ['get', 'kind'], 'fix'],
            paint: { 'circle-radius': 6, 'circle-color': '#3B82F6', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2 },
          });
          setIsMapReady(true);
        });

        map.on('move', () => {
          const c = map.getCenter();
          setCenter({ latitude: c.lat, longitude: c.lng });
        });
      } catch (err) {
        console.warn('Pin map could not start:', err);
        if (!cancelled) setMapFailed(true);
      }
    }

    void initMap();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setIsMapReady(false);
    };
    // The fix is taken once with the photo, so the map is only built once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recentre = () => {
    mapRef.current?.easeTo({ center: [telemetry.longitude, telemetry.latitude], zoom: PIN_MAP_ZOOM, duration: 400 });
  };

  const confirmPin = () => {
    if (!canPin) return;
    const c = mapRef.current?.getCenter();
    if (!c) return;
    onPinned({ latitude: c.lat, longitude: c.lng });
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-900 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-slate-200/80 flex items-center shrink-0 z-20">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-colors mr-2"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-900 tracking-tight leading-tight">Pin the grave</h1>
          <p className="text-[12px] text-slate-500 leading-tight">Drag the map until the pin sits on the grave</p>
        </div>
      </div>

      {/* Map with the pin fixed at its centre */}
      <div className="flex-1 relative overflow-hidden">
        <div ref={mapContainerRef} className="absolute inset-0" />

        {!isMapReady && !mapFailed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none">
            <Loader2 className="w-7 h-7 text-white/80 animate-spin" />
            <p className="mt-3 text-sm font-semibold text-white/80">Loading satellite imagery…</p>
          </div>
        )}

        {mapFailed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-10 text-center">
            <MapPinOff className="w-7 h-7 text-amber-300" />
            <p className="mt-3 text-sm font-semibold text-white">The map couldn&apos;t load</p>
            <p className="mt-1 text-xs text-white/70">The grave will be saved at your phone&apos;s GPS position instead.</p>
          </div>
        )}

        {isMapReady && (
          <>
            <div className="absolute top-3 inset-x-4 z-10 pointer-events-none flex justify-center">
              <p className="px-3 py-1.5 rounded-full bg-black/60 backdrop-blur text-[12px] font-medium text-white text-center">
                Be as accurate as you can. Pinch to zoom.
              </p>
            </div>

            {/* The pin: its tip is the exact centre of the map, which is where the grave is saved */}
            <div className="absolute left-1/2 top-1/2 z-10 pointer-events-none" aria-hidden="true">
              <svg
                width="40"
                height="52"
                viewBox="0 0 40 52"
                className="absolute left-1/2 -translate-x-1/2 -translate-y-full drop-shadow-[0_3px_4px_rgba(0,0,0,0.45)]"
              >
                <path
                  d="M20 51 C20 51 4 30 4 18 A16 16 0 0 1 36 18 C36 30 20 51 20 51 Z"
                  fill="#DC2626"
                  stroke="#FFFFFF"
                  strokeWidth="2.5"
                />
                <circle cx="20" cy="18" r="6" fill="#FFFFFF" />
              </svg>
              <span className="absolute left-1/2 top-1/2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-2 ring-red-600" />
            </div>

            <button
              onClick={recentre}
              className="absolute right-3 top-14 z-10 w-10 h-10 rounded-full bg-white shadow-lg flex items-center justify-center text-slate-700 hover:bg-slate-100"
              aria-label="Back to my GPS position"
              title="Back to my GPS position"
            >
              <LocateFixed className="w-5 h-5" />
            </button>
          </>
        )}

        {/* Google Maps logo and imagery copyright, required by the Map Tiles API terms */}
        <div className="absolute bottom-2 left-3.5 z-10 pointer-events-none">
          <GoogleMapsAttribution map={mapRef.current} mapType="satellite" isMapReady={isMapReady} />
        </div>
      </div>

      {/* Distance from the fix and the choice */}
      <div className="px-4 pt-3 pb-4 bg-white border-t border-slate-200/80 shrink-0 z-20">
        <p className={`text-[12px] font-medium text-center mb-3 ${check.tooFar ? 'text-amber-700' : 'text-slate-500'}`}>
          {mapFailed ? `GPS accuracy ${Math.ceil(telemetry.gpsAccuracy)} m` : check.message}
        </p>
        {mapFailed ? (
          <button
            onClick={onKeepGps}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition-colors"
          >
            Use GPS position
          </button>
        ) : (
          <>
            <button
              onClick={confirmPin}
              disabled={!canPin}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 text-white font-semibold text-sm transition-colors"
            >
              This is the grave
            </button>
            <button
              onClick={onKeepGps}
              className="w-full mt-2 py-2 text-[13px] font-semibold text-slate-500 hover:text-slate-700 underline underline-offset-4"
            >
              Keep GPS position instead
            </button>
          </>
        )}
      </div>
    </div>
  );
};
