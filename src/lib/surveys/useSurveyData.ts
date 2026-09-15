'use client';

import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import type { QueueActivity } from './queueRules';
import { surveyQueue } from './surveyQueue';

// Re-runs an IndexedDB query whenever the tables it read change, so counts and lists update as the queue works
export function useLiveValue<T>(query: () => Promise<T>, deps: unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: (next) => setValue(() => next),
      error: (err) => console.warn('Survey data could not be read:', err),
    });
    return () => subscription.unsubscribe();
    // The caller lists what the query depends on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

export function useQueueActivity(): QueueActivity {
  const [activity, setActivity] = useState<QueueActivity>(() => surveyQueue.activity());
  useEffect(() => {
    setActivity(surveyQueue.activity());
    return surveyQueue.subscribe(setActivity);
  }, []);
  return activity;
}
