'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { photoCounterLabel, swipeStep, wrapPhotoIndex } from '@/lib/ui/photoCarousel';

export interface CarouselPhoto {
  id: string;
  url: string;
}

interface GravePhotoCarouselProps {
  photos: CarouselPhoto[];
  alt: string;
  // Shown when the grave has no photos yet
  fallback: React.ReactNode;
}

export const GravePhotoCarousel: React.FC<GravePhotoCarouselProps> = ({ photos, alt, fallback }) => {
  const [index, setIndex] = useState(0);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const count = photos.length;
  const hasMultiple = count > 1;

  // A newly added photo or a different grave can shrink the list; keep the index in range
  useEffect(() => {
    setIndex((current) => wrapPhotoIndex(current, count));
  }, [count]);

  const go = (step: number) => setIndex((current) => wrapPhotoIndex(current + step, count));

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointerStart.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || !hasMultiple) return;
    const step = swipeStep(e.clientX - start.x, e.clientY - start.y);
    if (step !== 0) go(step);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasMultiple) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(1);
    }
  };

  return (
    <div
      className="w-full shrink-0 bg-slate-900 relative aspect-[4/3] max-h-72 overflow-hidden shadow-inner select-none touch-pan-y focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
      role="region"
      aria-roledescription="carousel"
      aria-label={`${alt} photos`}
      tabIndex={hasMultiple ? 0 : -1}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => (pointerStart.current = null)}
      onKeyDown={handleKeyDown}
    >
      {/* Slide strip */}
      <div
        className="absolute inset-0 flex transition-transform duration-300 ease-out"
        style={{ transform: `translateX(-${wrapPhotoIndex(index, count) * 100}%)` }}
      >
        {count > 0 ? (
          photos.map((photo, i) => (
            <div
              key={photo.id}
              className="relative w-full h-full shrink-0"
              role="group"
              aria-roledescription="slide"
              aria-label={photoCounterLabel(i, count)}
              aria-hidden={i !== index}
            >
              <Image src={photo.url} alt={`${alt}, photo ${i + 1}`} fill className="object-cover" priority={i === 0} draggable={false} />
            </div>
          ))
        ) : (
          <div
            className="relative w-full h-full shrink-0"
            role="group"
            aria-roledescription="slide"
            aria-label={photoCounterLabel(0, 0)}
          >
            {fallback}
          </div>
        )}
      </div>

      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

      {hasMultiple && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition-colors active:scale-95"
            aria-label="Previous photo"
          >
            <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition-colors active:scale-95"
            aria-label="Next photo"
          >
            <ChevronRight className="w-5 h-5 stroke-[2.5]" />
          </button>

          <div className="absolute bottom-3.5 left-1/2 -translate-x-1/2 flex items-center space-x-1.5">
            {photos.map((photo, i) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => setIndex(i)}
                className={`h-1.5 rounded-full transition-all ${i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/50 hover:bg-white/80'}`}
                aria-label={`Show photo ${i + 1}`}
                aria-current={i === index}
              />
            ))}
          </div>
        </>
      )}

      <div
        className="absolute bottom-3 left-4 text-white/90 text-[11px] font-medium bg-black/40 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/20"
        aria-live="polite"
      >
        {photoCounterLabel(index, count)}
      </div>
    </div>
  );
};
