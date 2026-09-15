'use client';

import { useEffect, useState } from 'react';
import {
  CompassPermission,
  CompassStatus,
  OrientationReading,
  compassPermission,
  readCompassHeading,
} from './compass';

// Laptops expose the orientation API but never send readings, so give up after this long
const NO_READING_TIMEOUT_MS = 3000;

// The compass is always on and can't be switched off. On iOS it starts once motion access is allowed, which is
// asked for from the tap that opens the camera, or failing that from the first tap on the screen.
export function useCompassHeading(): { heading: number | null; status: CompassStatus } {
  const [supported] = useState(() => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window);
  const [permission, setPermission] = useState<CompassPermission>(() => compassPermission.get());
  const [heading, setHeading] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    setPermission(compassPermission.get());
    return compassPermission.subscribe(setPermission);
  }, []);

  // No tap on the way in (home screen shortcut or a reload), so the next tap anywhere asks
  useEffect(() => {
    if (!supported || permission !== 'unknown') return;
    const ask = () => {
      void compassPermission.request();
    };
    window.addEventListener('touchend', ask);
    window.addEventListener('click', ask);
    return () => {
      window.removeEventListener('touchend', ask);
      window.removeEventListener('click', ask);
    };
  }, [supported, permission]);

  const canListen = supported && (permission === 'granted' || permission === 'not-required');

  useEffect(() => {
    if (!canListen) return;

    const handle = (source: 'absolute' | 'relative') => (event: Event) => {
      const next = readCompassHeading(event as unknown as OrientationReading, source);
      if (next !== null) setHeading(next);
    };
    const onAbsolute = handle('absolute');
    const onRelative = handle('relative');

    window.addEventListener('deviceorientationabsolute', onAbsolute);
    window.addEventListener('deviceorientation', onRelative);
    const timer = window.setTimeout(() => setTimedOut(true), NO_READING_TIMEOUT_MS);

    return () => {
      window.removeEventListener('deviceorientationabsolute', onAbsolute);
      window.removeEventListener('deviceorientation', onRelative);
      window.clearTimeout(timer);
    };
  }, [canListen]);

  let status: CompassStatus;
  if (!supported) status = 'unsupported';
  else if (heading !== null) status = 'active';
  else if (permission === 'denied') status = 'denied';
  else if (permission === 'unknown') status = 'needs-permission';
  else status = timedOut ? 'unsupported' : 'waiting';

  return { heading, status };
}
