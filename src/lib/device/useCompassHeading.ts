'use client';

import { useCallback, useEffect, useState } from 'react';
import { CompassStatus, OrientationReading, readCompassHeading } from './compass';

type OrientationEventConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

// Laptops expose the orientation API but never send readings, so give up after this long
const NO_READING_TIMEOUT_MS = 3000;

export function useCompassHeading() {
  const [heading, setHeading] = useState<number | null>(null);
  const [status, setStatus] = useState<CompassStatus>('waiting');
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!('DeviceOrientationEvent' in window)) {
      setStatus('unsupported');
      return;
    }
    const ctor = window.DeviceOrientationEvent as OrientationEventConstructor;
    if (typeof ctor.requestPermission === 'function') {
      setStatus('needs-permission');
    } else {
      setListening(true);
    }
  }, []);

  useEffect(() => {
    if (!listening) return;
    setStatus((current) => (current === 'active' ? current : 'waiting'));

    const handle = (source: 'absolute' | 'relative') => (event: Event) => {
      const next = readCompassHeading(event as unknown as OrientationReading, source);
      if (next === null) return;
      setHeading(next);
      setStatus('active');
    };
    const onAbsolute = handle('absolute');
    const onRelative = handle('relative');

    window.addEventListener('deviceorientationabsolute', onAbsolute);
    window.addEventListener('deviceorientation', onRelative);
    const timer = window.setTimeout(() => {
      setStatus((current) => (current === 'waiting' ? 'unsupported' : current));
    }, NO_READING_TIMEOUT_MS);

    return () => {
      window.removeEventListener('deviceorientationabsolute', onAbsolute);
      window.removeEventListener('deviceorientation', onRelative);
      window.clearTimeout(timer);
    };
  }, [listening]);

  // iOS only allows this from a tap
  const requestPermission = useCallback(async () => {
    const ctor = window.DeviceOrientationEvent as OrientationEventConstructor;
    if (typeof ctor.requestPermission !== 'function') return;
    try {
      const result = await ctor.requestPermission();
      if (result === 'granted') {
        setListening(true);
      } else {
        setStatus('denied');
      }
    } catch {
      setStatus('denied');
    }
  }, []);

  return { heading, status, requestPermission };
}
