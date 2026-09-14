'use client';

import React, { useId } from 'react';
import { buildGravestoneInscription, layoutInscription } from '@/lib/ui/gravestoneInscription';

interface GravestonePlaceholderProps {
  graveNumber?: string;
  fullName?: string;
  birthDate?: string;
  deathDate?: string;
  className?: string;
}

// A drawn gravestone engraved with the grave's own details, shown until someone photographs the real stone
export const GravestonePlaceholder: React.FC<GravestonePlaceholderProps> = ({
  graveNumber,
  fullName,
  birthDate,
  deathDate,
  className,
}) => {
  // Several stones can be on screen at once (search results), so the gradient ids must be unique per stone
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ids = {
    sky: `stone-sky-${uid}`,
    ground: `stone-ground-${uid}`,
    face: `stone-face-${uid}`,
    bevel: `stone-bevel-${uid}`,
    noise: `stone-noise-${uid}`,
  };

  const inscription = buildGravestoneInscription({ graveNumber, fullName, birthDate, deathDate });
  const layout = layoutInscription(inscription);
  const dateLines = [inscription.bornLine, inscription.diedLine].filter((line): line is string => Boolean(line));
  const description = [fullName, graveNumber ? `grave ${graveNumber}` : null].filter(Boolean).join(', ');

  return (
    <svg
      viewBox="0 0 600 800"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      role="img"
      aria-label={description ? `Gravestone for ${description}, no photo yet` : 'Gravestone, no photo yet'}
    >
      <defs>
        <linearGradient id={ids.sky} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#7CA3B5" />
          <stop offset="60%" stopColor="#C2D6DC" />
          <stop offset="100%" stopColor="#9FB898" />
        </linearGradient>
        <linearGradient id={ids.ground} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#556644" />
          <stop offset="50%" stopColor="#3D4B33" />
          <stop offset="100%" stopColor="#2D3826" />
        </linearGradient>
        <linearGradient id={ids.face} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#E8EAE6" />
          <stop offset="35%" stopColor="#D5D9D2" />
          <stop offset="70%" stopColor="#BFC5BC" />
          <stop offset="100%" stopColor="#9FA69B" />
        </linearGradient>
        <linearGradient id={ids.bevel} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#000000" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </linearGradient>
        <filter id={ids.noise} x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves={4} result="noise" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.1  0 0 0 0 0.1  0 0 0 0 0.1  0 0 0 0.15 0"
            in="noise"
            result="coloredNoise"
          />
          <feComposite operator="in" in2="SourceGraphic" />
        </filter>
      </defs>

      {/* Sky, trees and cemetery ground */}
      <rect width="600" height="480" fill={`url(#${ids.sky})`} />
      <path d="M0 430 Q80 370 160 410 T320 380 T480 400 T600 370 L600 500 L0 500 Z" fill="#4B6347" />
      <path d="M0 450 Q100 410 220 440 T440 420 T600 440 L600 520 L0 520 Z" fill="#3D5039" />
      <rect y="480" width="600" height="320" fill={`url(#${ids.ground})`} />
      <path d="M40 450 L75 440 L90 475 L55 485 Z" fill="#C5CAC2" opacity="0.6" />
      <path d="M505 455 L545 445 L560 480 L520 490 Z" fill="#BCC2B9" opacity="0.6" />

      {/* The stone */}
      <ellipse cx="300" cy="740" rx="210" ry="30" fill="#1C2419" opacity="0.7" />
      <path d="M140 730 L140 270 Q300 130 460 270 L460 730 Z" fill={`url(#${ids.face})`} />
      <path d="M140 730 L140 270 Q160 240 180 230 L180 730 Z" fill={`url(#${ids.bevel})`} />
      <path d="M140 730 L140 270 Q300 130 460 270 L460 730 Z" filter={`url(#${ids.noise})`} opacity="0.7" />
      <path d="M140 730 L140 270 Q300 130 460 270 L460 730" fill="none" stroke="#FFFFFF" strokeWidth="3" opacity="0.4" />

      {/* Engraving */}
      <text
        x="300"
        y={layout.bismillahY}
        fontFamily="'Amiri', 'Traditional Arabic', serif"
        fontSize="28"
        fontWeight="bold"
        fill="#2C3529"
        textAnchor="middle"
        opacity="0.85"
      >
        بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
      </text>
      {inscription.graveNumber && layout.graveNumberY !== null && (
        <text
          x="300"
          y={layout.graveNumberY}
          fontFamily="'Inter', 'Arial Black', sans-serif"
          fontSize="44"
          fontWeight="900"
          fill="#1A2218"
          textAnchor="middle"
          letterSpacing="4"
        >
          {inscription.graveNumber}
        </text>
      )}
      {inscription.nameLines.map((line, i) => (
        <text
          key={`name-${i}`}
          x="300"
          y={layout.nameYs[i]}
          fontFamily="'Inter', sans-serif"
          fontSize={inscription.nameFontSize}
          fontWeight="800"
          fill="#1E271C"
          textAnchor="middle"
          letterSpacing="3"
        >
          {line}
        </text>
      ))}
      {dateLines.map((line, i) => (
        <text
          key={line}
          x="300"
          y={layout.dateYs[i]}
          fontFamily="'Inter', monospace"
          fontSize="26"
          fontWeight="700"
          fill="#253023"
          textAnchor="middle"
          letterSpacing="2"
        >
          {line}
        </text>
      ))}

      {/* Grass in front of the stone */}
      <path d="M120 735 Q135 700 145 745 Q160 705 175 750" stroke="#465839" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M420 740 Q435 695 445 745 Q465 710 475 750" stroke="#465839" strokeWidth="4" fill="none" strokeLinecap="round" />
      <ellipse cx="300" cy="745" rx="190" ry="12" fill="#3B4831" opacity="0.5" />
    </svg>
  );
};
