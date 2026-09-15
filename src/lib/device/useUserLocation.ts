'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserLocationStatus, UserPosition, locateUser } from './userLocation';

export interface UseUserLocationResult {
  status: UserLocationStatus;
  position?: UserPosition;
  message?: string;
  retry: () => void;
}

// One fix each time the screen that asks is opened (a fix under a minute old is reused by the browser).
// Retry asks again, for example after the person turned location on. Status is deliberately not a
// dependency: the effect must not re-run and cancel its own request when it moves to "locating".
export function useUserLocation(enabled: boolean): UseUserLocationResult {
  const [status, setStatus] = useState<UserLocationStatus>('idle');
  const [position, setPosition] = useState<UserPosition | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setStatus('locating');
    setMessage(undefined);
    locateUser(typeof navigator !== 'undefined' ? navigator.geolocation : undefined).then((result) => {
      if (cancelled) return;
      if (result.status === 'ready') {
        setPosition(result.position);
        setStatus('ready');
      } else {
        setMessage(result.message);
        setStatus(result.status);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return { status, position, message, retry };
}
