'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Quote, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';

export interface RemembranceQuote {
  id: string;
  text: string;
  arabic?: string;
  source: string;
  category: 'Qur’an' | 'Hadith' | 'Prophetic Du’a';
}

export const REMEMBRANCE_QUOTES: RemembranceQuote[] = [
  {
    id: 'taste-of-death',
    text: 'Every soul shall taste death. And only on the Day of Resurrection shall you be paid your full recompense.',
    arabic: 'كُلُّ نَفْسٍ ذَائِقَةُ الْمَوْتِ',
    source: 'Qur’an 3:185',
    category: 'Qur’an',
  },
  {
    id: 'three-ongoing-deeds',
    text: 'When a person dies, all their deeds come to an end except three: ongoing charity (Sadaqah Jariyah), beneficial knowledge, or a righteous child who prays for them.',
    arabic: 'إِذَا مَاتَ الْإِنْسَانُ انْقَطَعَ عَنْهُ عَمَلُهُ إِلَّا مِنْ ثَلَاثَةٍ',
    source: 'Prophet Muhammad ﷺ (Sahih Muslim 1631)',
    category: 'Hadith',
  },
  {
    id: 'visit-graves-reminder',
    text: 'I used to forbid you from visiting graves, but now visit them, for they remind you of the Hereafter and soften the heart.',
    arabic: 'زُورُوا الْقُبُورَ فَإِنَّهَا تُذَكِّرُكُمُ الْآخِرَةَ',
    source: 'Prophet Muhammad ﷺ (Sahih Muslim 977)',
    category: 'Hadith',
  },
  {
    id: 'belong-to-allah',
    text: 'Who, when disaster strikes them, say: "Indeed we belong to Allah, and indeed to Him we shall return."',
    arabic: 'إِنَّا لِلَّهِ وَإِنَّا إِلَيْهِ رَاجِعُونَ',
    source: 'Qur’an 2:156',
    category: 'Qur’an',
  },
  {
    id: 'remember-destroyer-of-pleasures',
    text: 'Remember often the destroyer of pleasures: death.',
    arabic: 'أَكْثِرُوا مِنْ ذِكْرِ هَاذِمِ اللَّذَّاتِ',
    source: 'Prophet Muhammad ﷺ (Jami` at-Tirmidhi 2307)',
    category: 'Hadith',
  },
  {
    id: 'alive-with-their-lord',
    text: 'And do not say of those who are killed in the way of Allah that they are dead. Rather, they are alive, but you perceive it not.',
    arabic: 'بَلْ أَحْيَاءٌ وَلَٰكِن لَّا تَشْعُرُونَ',
    source: 'Qur’an 2:154',
    category: 'Qur’an',
  },
  {
    id: 'cemetery-greeting',
    text: 'Peace be upon you, O dwellers of these resting places among believers. We will, if Allah wills, join you. We ask Allah for ourselves and for you well-being.',
    arabic: 'السَّلَامُ عَلَيْكُمْ دَارَ قَوْمٍ مُؤْمِنِينَ',
    source: 'Prophet Muhammad ﷺ (Sahih Muslim 975)',
    category: 'Prophetic Du’a',
  },
];

interface RemembranceQuoteCarouselProps {
  quotes?: RemembranceQuote[];
  autoCycleIntervalMs?: number;
  className?: string;
}

export const RemembranceQuoteCarousel: React.FC<RemembranceQuoteCarouselProps> = ({
  quotes = REMEMBRANCE_QUOTES,
  autoCycleIntervalMs = 7000,
  className = '',
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isFading, setIsFading] = useState(false);
  const touchStartXRef = useRef<number | null>(null);

  const total = quotes.length;

  const goToNext = useCallback(() => {
    setIsFading(true);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % total);
      setIsFading(false);
    }, 250);
  }, [total]);

  const goToPrev = useCallback(() => {
    setIsFading(true);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev - 1 + total) % total);
      setIsFading(false);
    }, 250);
  }, [total]);

  const goToIndex = (index: number) => {
    if (index === currentIndex) return;
    setIsFading(true);
    setTimeout(() => {
      setCurrentIndex(index);
      setIsFading(false);
    }, 250);
  };

  // Auto-cycle timer
  useEffect(() => {
    if (isPaused || total <= 1) return;

    const timer = setInterval(() => {
      goToNext();
    }, autoCycleIntervalMs);

    return () => clearInterval(timer);
  }, [isPaused, total, autoCycleIntervalMs, goToNext]);

  const current = quotes[currentIndex] || quotes[0];

  // Touch swipe support for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;
    const diff = touchStartXRef.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
      if (diff > 0) goToNext();
      else goToPrev();
    }
    touchStartXRef.current = null;
  };

  return (
    <section
      className={`relative px-4 py-3 my-2 ${className}`}
      aria-roledescription="carousel"
      aria-label="Reflections and Remembrance Quotes"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-white/95 to-slate-50/90 border border-slate-200/80 p-4 shadow-sm backdrop-blur-sm transition-all duration-300 hover:border-slate-300">
        {/* Subtle decorative background watermarks */}
        <Quote className="absolute -top-1 -right-1 w-12 h-12 text-slate-100 -rotate-12 pointer-events-none select-none" />

        {/* Top meta pill with category and counter */}
        <div className="flex items-center justify-between mb-2">
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-100">
            <Sparkles className="w-2.5 h-2.5 text-emerald-600" />
            <span>{current.category}</span>
          </span>

          <div className="flex items-center space-x-1 text-[10px] font-medium text-slate-400">
            <span>
              {currentIndex + 1} of {total}
            </span>
            {isPaused && (
              <span className="text-[9px] bg-slate-100 text-slate-500 px-1 rounded">
                paused
              </span>
            )}
          </div>
        </div>

        {/* Quote Content Container with Fade Transition */}
        <div
          className={`transition-opacity duration-300 ease-in-out min-h-[88px] flex flex-col justify-center text-center px-1 ${
            isFading ? 'opacity-0 scale-[0.99]' : 'opacity-100 scale-100'
          }`}
          aria-live="polite"
        >
          {/* Optional Arabic calligraphy text */}
          {current.arabic && (
            <p
              lang="ar"
              dir="rtl"
              className="font-serif text-sm md:text-base text-emerald-900/80 mb-1 leading-relaxed select-none"
            >
              {current.arabic}
            </p>
          )}

          {/* English Quote Text */}
          <blockquote className="text-[12px] md:text-[13px] italic text-slate-700 leading-relaxed font-serif">
            &ldquo;{current.text}&rdquo;
          </blockquote>

          {/* Citation Source */}
          <cite className="block text-[11px] font-semibold text-slate-500 font-sans mt-2 not-italic tracking-wide">
            — {current.source}
          </cite>
        </div>

        {/* Navigation Controls and Indicator Dots */}
        <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-100">
          <button
            onClick={goToPrev}
            aria-label="Previous Quote"
            className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          {/* Carousel Indicator Dots */}
          <div className="flex items-center space-x-1.5" role="tablist">
            {quotes.map((q, idx) => {
              const isActive = idx === currentIndex;
              return (
                <button
                  key={q.id}
                  onClick={() => goToIndex(idx)}
                  role="tab"
                  aria-selected={isActive}
                  aria-label={`Go to quote ${idx + 1}: ${q.source}`}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    isActive
                      ? 'w-4 bg-emerald-700 shadow-sm'
                      : 'w-1.5 bg-slate-200 hover:bg-slate-300'
                  }`}
                />
              );
            })}
          </div>

          <button
            onClick={goToNext}
            aria-label="Next Quote"
            className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </section>
  );
};
