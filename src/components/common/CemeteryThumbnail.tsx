'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { Cemetery } from '@/types';
import { streetViewThumbnailUrl } from '@/lib/cemeteries/streetView';
import { getGoogleMapsApiKey } from '@/lib/map/googleMapTiles';

interface CemeteryThumbnailProps {
  cemetery: Cemetery;
  /** Rendered size in CSS pixels; the request asks for twice this so it stays sharp on a phone */
  size?: number;
}

// A Street View look at the cemetery where Google has imagery, falling back to the placeholder.
// Each thumbnail is fetched from Google every time it is shown, because their terms allow displaying
// the imagery but not storing it. Loading is lazy so a card that never scrolls into view costs nothing.
export const CemeteryThumbnail: React.FC<CemeteryThumbnailProps> = ({ cemetery, size = 56 }) => {
  const [failed, setFailed] = useState(false);
  const streetView = failed ? null : streetViewThumbnailUrl(cemetery, getGoogleMapsApiKey() || '', size * 2);

  if (streetView) {
    return (
      // Google's endpoint is not a configured next/image host, and this must stay a live request
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={streetView}
        alt={`Street View of ${cemetery.name}`}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="absolute inset-0 h-full w-full object-cover"
      />
    );
  }

  return (
    <Image
      src={cemetery.thumbnailUrl || '/sample-gravestone.svg'}
      alt={cemetery.name}
      fill
      className="object-cover"
    />
  );
};
