'use client';

import { useEffect, useState, useCallback } from 'react';
import { wakeLockService } from './wakeLockService';

export interface UseWakeLockReturn {
  isSupported: boolean;
  isActive: boolean;
  request: () => Promise<boolean>;
  release: () => Promise<void>;
}

/**
 * Screen Wake Lock hook to keep the mobile display awake during cemetery navigation and AR guidance.
 * Automatically handles page visibility changes, cleanup on unmount, and multi-screen retention.
 */
export function useWakeLock(enabled: boolean = true): UseWakeLockReturn {
  const [isActive, setIsActive] = useState<boolean>(() => wakeLockService.isActive());
  const [isSupported, setIsSupported] = useState<boolean>(false);

  useEffect(() => {
    setIsSupported(wakeLockService.isSupported());
  }, []);

  useEffect(() => {
    const unsubscribe = wakeLockService.subscribe((active) => {
      setIsActive(active);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (enabled) {
      wakeLockService.acquire();
      return () => {
        wakeLockService.drop();
      };
    }
  }, [enabled]);

  const request = useCallback(async () => {
    return wakeLockService.acquire();
  }, []);

  const release = useCallback(async () => {
    return wakeLockService.drop();
  }, []);

  return {
    isSupported,
    isActive,
    request,
    release,
  };
}
