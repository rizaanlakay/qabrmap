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

  const toggle = useCallback(() => {
    setEnabled((was) => {
      const now = !was;
      try {
        window.localStorage.setItem(VOICE_STORAGE_KEY, now ? 'on' : 'off');
      } catch {}
      if (now) {
        // iOS only speaks after something was spoken inside a real tap, so this both unlocks the audio
        // and tells the driver it works
        speakerRef.current?.say('Voice guidance on.');
      } else {
        speakerRef.current?.stop();
      }
      return now;
    });
  }, []);

  // A new set of steps means a new route. The first one of a drive is not a reroute.
  useEffect(() => {
    if (input.steps.length === 0 || input.steps === knownStepsRef.current) return;
    const hadRoute = knownStepsRef.current !== null;
    knownStepsRef.current = input.steps;
    if (hadRoute) routeGenerationRef.current += 1;
  }, [input.steps]);

  // Speed from successive fixes, used when the device reports none of its own
  useEffect(() => {
    const now = Date.now();
    const last = lastFixRef.current;
    if (last && now > last.at) {
      const covered = last.remaining - input.remainingMeters;
      const seconds = (now - last.at) / 1000;
      if (covered > 0 && seconds >= 1) derivedSpeedRef.current = covered / seconds;
    }
    lastFixRef.current = { remaining: input.remainingMeters, at: now };
  }, [input.remainingMeters]);

  useEffect(() => {
    if (!enabled || !input.active || !speakerRef.current) return;
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
  ]);

  // Leaving the screen must not leave a sentence talking over whatever comes next
  useEffect(() => () => speakerRef.current?.stop(), []);

  return { enabled, available, toggle };
}
