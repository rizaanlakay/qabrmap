'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  PULL_REFRESHING_PX,
  PULL_SNAP_MS,
  PULL_START_THRESHOLD_PX,
  dampPull,
  pullProgress,
  shouldBeginPull,
  shouldRefresh,
} from '@/lib/ui/pullToRefresh';

interface PullToRefreshProps {
  // Runs when the list is released past the threshold; the indicator spins until it settles
  onRefresh: () => Promise<unknown> | void;
  className?: string;
  children: React.ReactNode;
}

// A scroll container whose content can be dragged down from the top to refresh it
export const PullToRefresh: React.FC<PullToRefreshProps> = ({ onRefresh, className = '', children }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);
  const pullingRef = useRef(false);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);

  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Only the release and settle animate; while the finger is down the indicator follows it directly
  const [animating, setAnimating] = useState(false);

  const setPullPx = useCallback((px: number) => {
    pullRef.current = px;
    setPull(px);
  }, []);

  const finishRefresh = useCallback(() => {
    refreshingRef.current = false;
    setRefreshing(false);
    setAnimating(true);
    setPullPx(0);
  }, [setPullPx]);

  const release = useCallback(() => {
    if (!pullingRef.current) return;
    pullingRef.current = false;
    startYRef.current = null;
    setAnimating(true);

    if (shouldRefresh(pullRef.current) && !refreshingRef.current) {
      refreshingRef.current = true;
      setRefreshing(true);
      setPullPx(PULL_REFRESHING_PX);
      Promise.resolve()
        .then(() => onRefresh())
        .catch(() => undefined)
        .then(finishRefresh);
    } else {
      setPullPx(0);
    }
  }, [onRefresh, finishRefresh, setPullPx]);

  // Native listeners so touchmove can be non-passive: preventing the default stops the browser's
  // own overscroll bounce and reload gesture from fighting the pull
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current || e.touches.length !== 1) return;
      startYRef.current = el.scrollTop <= 0 ? e.touches[0].clientY : null;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null || refreshingRef.current) return;
      const deltaY = e.touches[0].clientY - startYRef.current;

      if (!pullingRef.current) {
        if (!shouldBeginPull({ scrollTop: el.scrollTop, deltaY })) {
          // Scrolling up or sideways: this touch is a scroll, not a pull
          if (deltaY < 0 || el.scrollTop > 0) startYRef.current = null;
          return;
        }
        pullingRef.current = true;
        setAnimating(false);
      }

      if (e.cancelable) e.preventDefault();
      setPullPx(dampPull(deltaY - PULL_START_THRESHOLD_PX));
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', release);
    el.addEventListener('touchcancel', release);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', release);
      el.removeEventListener('touchcancel', release);
    };
  }, [release, setPullPx]);

  const progress = pullProgress(pull);
  const armed = shouldRefresh(pull);

  return (
    <div
      ref={containerRef}
      className={`overflow-y-auto ${className}`}
      style={{ overscrollBehaviorY: 'contain' }}
    >
      <div
        aria-live="polite"
        aria-busy={refreshing}
        className="flex items-end justify-center overflow-hidden"
        style={{
          height: pull,
          transition: animating ? `height ${PULL_SNAP_MS}ms cubic-bezier(0.32, 0.72, 0, 1)` : 'none',
        }}
      >
        <div
          className={`mb-3 w-9 h-9 rounded-full bg-white shadow-md border border-slate-200/80 flex items-center justify-center ${
            armed || refreshing ? 'text-brand-forest' : 'text-slate-400'
          }`}
          style={{
            opacity: refreshing ? 1 : Math.min(1, progress * 1.5),
            transform: refreshing ? undefined : `scale(${0.6 + progress * 0.4}) rotate(${progress * 270}deg)`,
          }}
        >
          <RefreshCw className={`w-[18px] h-[18px] stroke-[2.2] ${refreshing ? 'animate-spin' : ''}`} />
          <span className="sr-only">{refreshing ? 'Refreshing' : armed ? 'Release to refresh' : 'Pull to refresh'}</span>
        </div>
      </div>
      {children}
    </div>
  );
};
