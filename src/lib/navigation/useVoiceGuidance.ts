'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RouteStep } from '@/lib/geospatial';
import { emptyVoiceMemory, nextAnnouncement, type VoiceMemory } from './voiceGuidance';
import { createBrowserSpeaker, type VoiceSpeaker } from './voiceSpeaker';

export const VOICE_STORAGE_KEY = 'qabrmap_voice_guidance';

export interface UseVoiceGuidanceInput {
  // False outside driving mode, which stops the voice without forgetting the toggle
  active: boolean;
  steps: RouteStep[];
  stepIndex: number;
  distanceToNextManeuverMeters: number;
  remainingMeters: number;
  deviceSpeedMps: number | null;
  entranceName: string;
  isPreviewing: boolean;
  hasArrived: boolean;
  // False for a route planned from the default start position that the driver is nowhere near, which would
  // otherwise open the drive by naming a road they cannot see
  routeWorthAnnouncing: boolean;
}

export function useVoiceGuidance(input: UseVoiceGuidanceInput) {
  const [enabled, setEnabled] = useState(false);
  const speakerRef = useRef<VoiceSpeaker | null>(null);
  const memoryRef = useRef<VoiceMemory>(emptyVoiceMemory());
  // Counts routes so the engine can tell a reroute from the first route of a drive
  const routeGenerationRef = useRef(0);
  const knownStepsRef = useRef<RouteStep[] | null>(null);
  // Distance and time of the last fix, for a speed estimate when the device reports none
  const lastFixRef = useRef<{ remaining: number; at: number } | null>(null);
  const derivedSpeedRef = useRef<number | null>(null);
  // Set by the toggle so its own confirmation is not cancelled by an announcement on the same render
  const suppressNextAnnouncementRef = useRef(false);

  // Built in an effect, not during render: a side effect in render runs twice under StrictMode and would
  // leave two speakers talking over each other
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    speakerRef.current = createBrowserSpeaker();
    setAvailable(speakerRef.current !== null);
  }, []);

  useEffect(() => {
    try {
      setEnabled(window.localStorage.getItem(VOICE_STORAGE_KEY) === 'on');
    } catch {
      // Storage blocked: the toggle still works for this drive
    }
  }, []);

  // The side effects sit outside the updater: StrictMode double-invokes updaters, which would speak twice
  const toggle = useCallback(() => {
    const now = !enabled;
    setEnabled(now);
    try {
      window.localStorage.setItem(VOICE_STORAGE_KEY, now ? 'on' : 'off');
    } catch {}
    if (!now) {
      speakerRef.current?.stop();
      return;
    }
    // Turning on re-runs the announcement effect on this render, and any phrase it produces would cancel
    // the confirmation below, which on iOS is the utterance that unlocks audio
    suppressNextAnnouncementRef.current = true;
    // Mid-drive the departure line is stale. Before setting off it is still worth hearing.
    if (input.stepIndex > 0 && !memoryRef.current.said.includes('depart')) {
      memoryRef.current = { ...memoryRef.current, said: [...memoryRef.current.said, 'depart'] };
    }
    // iOS only speaks after something was spoken inside a real tap, so this both unlocks the audio
    // and tells the driver it works
    speakerRef.current?.say('Voice guidance on.');
  }, [enabled, input.stepIndex]);

  // A new set of steps means a new route. The first one of a drive is not a reroute.
  useEffect(() => {
    // A route planned from the default start is replaced the moment a real fix lands, so it is not a route
    // the voice ever knew about and its replacement is not a reroute
    if (!input.routeWorthAnnouncing) return;
    if (input.steps.length === 0 || input.steps === knownStepsRef.current) return;
    const hadRoute = knownStepsRef.current !== null;
    knownStepsRef.current = input.steps;
    // A new route's distances jump, which would otherwise pass for speed on the next fix
    lastFixRef.current = null;
    derivedSpeedRef.current = null;
    if (hadRoute) routeGenerationRef.current += 1;
  }, [input.steps, input.routeWorthAnnouncing]);

  // Speed from successive fixes, used when the device reports none of its own
  useEffect(() => {
    if (!Number.isFinite(input.remainingMeters)) return;
    const now = Date.now();
    const last = lastFixRef.current;
    if (last && now > last.at) {
      const covered = last.remaining - input.remainingMeters;
      const seconds = (now - last.at) / 1000;
      if (covered > 0 && seconds >= 1) derivedSpeedRef.current = covered / seconds;
    }
    lastFixRef.current = { remaining: input.remainingMeters, at: now };
  }, [input.remainingMeters]);

  // Leaving driving mode silences a maneuver that is still playing. This sits before the announcement
  // effect so that on the render where driving ends at arrival, the stale phrase is cancelled first and
  // the arrival line spoken after.
  useEffect(() => {
    if (!input.active) speakerRef.current?.stop();
  }, [input.active]);

  useEffect(() => {
    if (!enabled || !speakerRef.current) return;
    if (!input.routeWorthAnnouncing) return;
    // Arrival is the one thing still worth saying once driving mode has ended, because reaching the
    // cemetery boundary is what ends it
    if (!input.active && !input.hasArrived) return;
    // The drive is over. The screen keeps feeding fixes for the walk, with sentinel distances the engine
    // would otherwise be asked to make sense of.
    if (memoryRef.current.said.includes('arrive')) return;
    if (suppressNextAnnouncementRef.current) {
      suppressNextAnnouncementRef.current = false;
      return;
    }
    const { phrase, memory } = nextAnnouncement(
      {
        steps: input.steps,
        stepIndex: input.stepIndex,
        distanceToNextManeuverMeters: input.distanceToNextManeuverMeters,
        remainingMeters: input.remainingMeters,
        speedMps: input.deviceSpeedMps ?? derivedSpeedRef.current,
        entranceName: input.entranceName,
        isPreviewing: input.isPreviewing,
        hasArrived: input.hasArrived,
        rerouteCount: routeGenerationRef.current,
      },
      memoryRef.current
    );
    memoryRef.current = memory;
    if (phrase) speakerRef.current.say(phrase);
  }, [
    enabled,
    input.active,
    input.steps,
    input.stepIndex,
    input.distanceToNextManeuverMeters,
    input.remainingMeters,
    input.deviceSpeedMps,
    input.entranceName,
    input.isPreviewing,
    input.hasArrived,
    input.routeWorthAnnouncing,
  ]);

  // Leaving the screen must not leave a sentence talking over whatever comes next, nor a speaker still
  // listening to the global synth
  useEffect(
    () => () => {
      speakerRef.current?.stop();
      speakerRef.current?.dispose();
    },
    []
  );

  return { enabled, available, toggle };
}
