'use client';

import React from 'react';
import Image from 'next/image';
import { Grave } from '@/types';
import { hasRealGravePhoto } from '@/lib/ui/gravestoneInscription';
import { GravestonePlaceholder } from './GravestonePlaceholder';

interface GraveImageProps {
  grave: Grave;
  alt?: string;
  priority?: boolean;
}

// The grave's photo, or a stone engraved with its own details when nobody has photographed it yet.
// Fills its parent, which must be positioned.
export const GraveImage: React.FC<GraveImageProps> = ({ grave, alt, priority }) => {
  if (hasRealGravePhoto(grave.primaryPhotoUrl)) {
    return (
      <Image
        src={grave.primaryPhotoUrl as string}
        alt={alt ?? grave.person?.fullName ?? `Grave ${grave.graveNumber}`}
        fill
        className="object-cover"
        priority={priority}
      />
    );
  }

  return (
    <GravestonePlaceholder
      graveNumber={grave.graveNumber}
      fullName={grave.person?.fullName}
      birthDate={grave.person?.birthDate}
      deathDate={grave.person?.deathDate}
      className="absolute inset-0 w-full h-full"
    />
  );
};
