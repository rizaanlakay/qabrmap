'use client';

import React, { useEffect, useState } from 'react';
import {
  GoogleMapType,
  fetchViewportCopyright,
  getGoogleMapsApiKey,
  isImageryUnavailableError,
} from '@/lib/map/googleMapTiles';

interface AttributionMap {
  on: (type: 'moveend', listener: () => void) => unknown;
  off: (type: 'moveend', listener: () => void) => unknown;
  getBounds: () => { getNorth(): number; getSouth(): number; getEast(): number; getWest(): number };
  getZoom: () => number;
}

interface GoogleMapsAttributionProps {
  map: AttributionMap | null;
  mapType: GoogleMapType;
  isMapReady: boolean;
}

// How long the map must stay still before looking up the copyright for the new view
const COPYRIGHT_REFRESH_DELAY_MS = 400;

// Google logo plus the copyright for the tiles in view, which the Map Tiles API terms require on the map
export const GoogleMapsAttribution: React.FC<GoogleMapsAttributionProps> = ({ map, mapType, isMapReady }) => {
  const [copyright, setCopyright] = useState('');
  const [imageryUnavailable, setImageryUnavailable] = useState(false);
  const hasApiKey = Boolean(getGoogleMapsApiKey());

  useEffect(() => {
    if (!map || !isMapReady || !hasApiKey) return;
    let timer: number | undefined;
    let controller: AbortController | null = null;

    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        controller?.abort();
        controller = new AbortController();
        const bounds = map.getBounds();
        fetchViewportCopyright(
          mapType,
          { north: bounds.getNorth(), south: bounds.getSouth(), east: bounds.getEast(), west: bounds.getWest() },
          map.getZoom(),
          controller.signal
        )
          .then((text) => {
            setCopyright(text);
            setImageryUnavailable(false);
          })
          .catch((error: unknown) => {
            // A refused session means no tiles at all; anything else keeps the last copyright
            if (isImageryUnavailableError(error)) setImageryUnavailable(true);
          });
      }, COPYRIGHT_REFRESH_DELAY_MS);
    };

    refresh();
    map.on('moveend', refresh);
    return () => {
      window.clearTimeout(timer);
      controller?.abort();
      map.off('moveend', refresh);
    };
  }, [map, mapType, isMapReady, hasApiKey]);

  if (!hasApiKey || imageryUnavailable) {
    return (
      <div className="bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-md text-[10px] font-semibold text-amber-200">
        {hasApiKey
          ? 'Map imagery unavailable: check the Google Maps API key setup'
          : 'Map imagery unavailable: Google Maps API key not set'}
      </div>
    );
  }

  return (
    <div className="flex items-end">
      {/* Official asset, unmodified, 16px tall as the attribution guidelines require */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icons/google-maps-logo.svg"
        alt="Google Maps"
        width={76}
        height={16}
        draggable={false}
        className="h-4 w-auto select-none"
      />
      {copyright && (
        <span className="ml-2.5 px-1.5 py-px rounded bg-black/45 text-[9px] leading-tight text-white/90 font-medium max-w-[240px]">
          {copyright}
        </span>
      )}
    </div>
  );
};
