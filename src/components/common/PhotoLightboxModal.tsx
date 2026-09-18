'use client';

import React, { useEffect, useRef } from 'react';
import Image from 'next/image';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { photoCounterLabel, swipeStep, wrapPhotoIndex } from '@/lib/ui/photoCarousel';

export interface LightboxPhoto {
  id: string;
  url: string;
}

interface PhotoLightboxModalProps {
  photos: LightboxPhoto[];
  initialIndex?: number;
  alt: string;
  isOpen: boolean;
  onClose: () => void;
}

export const PhotoLightboxModal: React.FC<PhotoLightboxModalProps> = ({
  photos,
  initialIndex = 0,
  alt,
  isOpen,
  onClose,
}) => {
  const [index, setIndex] = React.useState(initialIndex);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const count = photos.length;
  const hasMultiple = count > 1;

  useEffect(() => {
    if (isOpen) {
      setIndex(wrapPhotoIndex(initialIndex, count));
    }
  }, [isOpen, initialIndex, count]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft' && hasMultiple) {
        e.preventDefault();
        setIndex((curr) => wrapPhotoIndex(curr - 1, count));
      } else if (e.key === 'ArrowRight' && hasMultiple) {
        e.preventDefault();
        setIndex((curr) => wrapPhotoIndex(curr + 1, count));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, hasMultiple, count, onClose]);

  if (!isOpen || count === 0) return null;

  const go = (step: number) => {
    setIndex((current) => wrapPhotoIndex(current + step, count));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointerStart.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const step = swipeStep(e.clientX - start.x, e.clientY - start.y);
    if (step !== 0) {
      go(step);
    }
  };

  const currentPhoto = photos[wrapPhotoIndex(index, count)];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} full-size photos`}
      className="fixed inset-0 z-50 bg-black/95 flex flex-col justify-between select-none touch-none"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => (pointerStart.current = null)}
    >
      {/* Top Bar with Counter and Close Button */}
      <div className="flex items-center justify-between p-4 z-10">
        <span className="text-white/90 text-sm font-medium bg-black/40 backdrop-blur-md px-3 py-1 rounded-full border border-white/20">
          {photoCounterLabel(index, count)}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-black/40 hover:bg-black/70 backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition-colors active:scale-95"
          aria-label="Close lightbox"
        >
          <X className="w-6 h-6 stroke-[2.5]" />
        </button>
      </div>

      {/* Main image container */}
      <div className="relative flex-1 w-full h-full flex items-center justify-center p-2 sm:p-6">
        {currentPhoto && (
          <div className="relative w-full h-full max-w-5xl max-h-[85vh]">
            <Image
              src={currentPhoto.url}
              alt={`${alt}, photo ${wrapPhotoIndex(index, count) + 1}`}
              fill
              className="object-contain"
              priority
              draggable={false}
            />
          </div>
        )}

        {/* Side navigation arrows */}
        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                go(-1);
              }}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/40 hover:bg-black/70 backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition-colors active:scale-95 z-20"
              aria-label="Previous photo"
            >
              <ChevronLeft className="w-6 h-6 stroke-[2.5]" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                go(1);
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/40 hover:bg-black/70 backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition-colors active:scale-95 z-20"
              aria-label="Next photo"
            >
              <ChevronRight className="w-6 h-6 stroke-[2.5]" />
            </button>
          </>
        )}
      </div>

      {/* Bottom dots pagination when multiple photos */}
      {hasMultiple && (
        <div className="flex items-center justify-center space-x-2 pb-6 z-10">
          {photos.map((photo, i) => (
            <button
              key={photo.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIndex(i);
              }}
              className={`h-2 rounded-full transition-all ${
                i === wrapPhotoIndex(index, count)
                  ? 'w-6 bg-white'
                  : 'w-2 bg-white/40 hover:bg-white/70'
              }`}
              aria-label={`Go to photo ${i + 1}`}
              aria-current={i === wrapPhotoIndex(index, count)}
            />
          ))}
        </div>
      )}
    </div>
  );
};