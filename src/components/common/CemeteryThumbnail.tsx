'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { Cemetery } from '@/types';

interface CemeteryThumbnailProps {
  cemetery: Cemetery;
}

// The cemetery's own photograph where one has been approved, otherwise the placeholder.
// The image is served from our storage, not fetched from Google on every render, so a list of cards
// costs nothing to show. Google requires the photographer to be credited wherever their photo appears,
// which the card does beneath the name and the cemetery screen does in full.
export const CemeteryThumbnail: React.FC<CemeteryThumbnailProps> = ({ cemetery }) => {
  const [failed, setFailed] = useState(false);
  const photo = failed ? null : cemetery.photoUrl;

  if (photo) {
    return (
      // Supabase storage is not a configured next/image host, so this stays a plain tag
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photo}
        alt={
          cemetery.photoAttribution
            ? `${cemetery.name}, photographed by ${cemetery.photoAttribution}`
            : cemetery.name
        }
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
