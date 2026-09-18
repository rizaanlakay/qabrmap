# Spoken driving guidance implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The driving screen speaks turn-by-turn directions in a female voice, on a toggle, deciding when to speak and what to say the way Google Maps does.

**Architecture:** A pure function holds every decision about when and what to say. It takes the live route progress plus a memory of what has already been spoken, and returns a sentence or nothing. A small injectable class does the talking through `speechSynthesis`. A thin hook joins the two and is the only thing the navigation screen touches.

**Tech Stack:** TypeScript, React 18, Next.js 14, Vitest (node environment, no jsdom), Web Speech API, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-09-17-voice-guidance-design.md`

## Global Constraints

- No em dashes anywhere, including comments and UI copy. Use a comma, colon, period or parentheses.
- Metric only. South African English spelling: "metres", "kilometre".
- Tests run in node. There is no jsdom, no testing-library, no `vitest.config`. Never import React into a test or render a component. Logic goes in a plain function or class that takes its dependencies as arguments, the way `src/lib/device/wakeLockService.ts` sits under `useWakeLock`.
- Test files live at `tests/<name>.test.ts` and import from `../src/...`.
- Run a single test file with `npx vitest run tests/<name>.test.ts`. Run everything with `npm test`. Type-check with `npx tsc --noEmit -p .`.
- Comments explain why, not what. Match the surrounding density, which is light.
- `src/components/screens/NavigationScreen.tsx` is 1632 lines already. Add as little to it as possible.
- The repository owner keeps work uncommitted and deploys from the checkout. Commit steps are included below, but confirm with them before the first commit.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/navigation/voiceGuidance.ts` (create) | Every decision about when to speak and what to say. Pure, no audio, no GPS, no React. |
| `src/lib/navigation/voiceSpeaker.ts` (create) | Picks a voice and talks through an injected `speechSynthesis`. |
| `src/lib/navigation/useVoiceGuidance.ts` (create) | Holds the memory, the on/off flag, its `localStorage` line and the speed estimate. Thin, untested. |
| `src/components/screens/NavigationScreen.tsx` (modify) | The speaker toggle and one call to the hook. |
| `tests/voice_guidance.test.ts` (create) | The engine, including a full simulated drive. |
| `tests/voice_speaker.test.ts` (create) | Voice picking and cancel-before-speak. |

---

### Task 1: Distances, names and thresholds

The small pure helpers everything else is built on.

**Files:**
- Create: `src/lib/navigation/voiceGuidance.ts`
- Test: `tests/voice_guidance.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `HEADS_UP_MIN_STEP_M`, `WARNING_SECONDS`, `WARNING_MIN_M`, `WARNING_MAX_M`, `TURN_SECONDS`, `TURN_MIN_M`, `TURN_MAX_M`, `ARRIVAL_M`, `DEFAULT_SPEED_MPS` (all `number`); `warningDistanceMeters(speedMps: number | null): number`; `turnDistanceMeters(speedMps: number | null): number`; `speakDistance(meters: number): string`; `expandStreetName(text: string): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/voice_guidance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SPEED_MPS,
  expandStreetName,
  speakDistance,
  turnDistanceMeters,
  warningDistanceMeters,
} from '../src/lib/navigation/voiceGuidance';

describe('Spoken distances', () => {
  it('rounds kilometres to the nearest half', () => {
    expect(speakDistance(1000)).toBe('1 kilometre');
    expect(speakDistance(1250)).toBe('1.5 kilometres');
    expect(speakDistance(1600)).toBe('1.5 kilometres');
    expect(speakDistance(2000)).toBe('2 kilometres');
  });

  it('rounds hundreds of metres the way a driver hears them', () => {
    expect(speakDistance(417)).toBe('400 metres');
    expect(speakDistance(460)).toBe('500 metres');
    expect(speakDistance(120)).toBe('100 metres');
  });

  it('never announces a distance under fifty metres', () => {
    expect(speakDistance(55)).toBe('50 metres');
    expect(speakDistance(10)).toBe('50 metres');
    expect(speakDistance(0)).toBe('50 metres');
  });
});

describe('Trigger distances', () => {
  it('scales with speed', () => {
    expect(warningDistanceMeters(13.9)).toBeCloseTo(417, 0);
    expect(turnDistanceMeters(13.9)).toBeCloseTo(55.6, 0);
  });

  it('holds a floor when crawling and a ceiling at speed', () => {
    expect(warningDistanceMeters(2)).toBe(200);
    expect(warningDistanceMeters(40)).toBe(800);
    expect(turnDistanceMeters(2)).toBe(30);
    expect(turnDistanceMeters(40)).toBe(120);
  });

  it('assumes an urban speed when the device reports none', () => {
    expect(warningDistanceMeters(null)).toBe(warningDistanceMeters(DEFAULT_SPEED_MPS));
  });
});

describe('Street names for speech', () => {
  it('expands the abbreviations OpenStreetMap uses', () => {
    expect(expandStreetName('Turn right onto Aden Ave')).toBe('Turn right onto Aden Avenue');
    expect(expandStreetName('Head out onto Lawrence Rd')).toBe('Head out onto Lawrence Road');
    expect(expandStreetName('Turn left onto Sunset Cres')).toBe('Turn left onto Sunset Crescent');
  });

  it('reads a trailing St as Street but leaves a saint alone', () => {
    expect(expandStreetName('Turn left onto Pluny St')).toBe('Turn left onto Pluny Street');
    expect(expandStreetName('Turn left onto St James Road')).toBe('Turn left onto St James Road');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/voice_guidance.test.ts`
Expected: FAIL, cannot resolve `../src/lib/navigation/voiceGuidance`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/navigation/voiceGuidance.ts`:

```ts
// Deciding when the driving screen speaks and what it says. Pure: no audio, no GPS, no React, so a whole
// drive is a list of numbers in and sentences out.

// A leg longer than this earns a "continue on X for Y" when the driver joins it
export const HEADS_UP_MIN_STEP_M = 1500;
// The warning lands this long before the turn, held between a floor and a ceiling
export const WARNING_SECONDS = 30;
export const WARNING_MIN_M = 200;
export const WARNING_MAX_M = 800;
// The turn itself is called this long before the driver reaches it
export const TURN_SECONDS = 4;
export const TURN_MIN_M = 30;
export const TURN_MAX_M = 120;
export const ARRIVAL_M = 40;
// 50 km/h, used when the device reports no speed
export const DEFAULT_SPEED_MPS = 13.9;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const speedOr = (speedMps: number | null) =>
  speedMps !== null && Number.isFinite(speedMps) && speedMps > 0 ? speedMps : DEFAULT_SPEED_MPS;

export function warningDistanceMeters(speedMps: number | null): number {
  return clamp(speedOr(speedMps) * WARNING_SECONDS, WARNING_MIN_M, WARNING_MAX_M);
}

export function turnDistanceMeters(speedMps: number | null): number {
  return clamp(speedOr(speedMps) * TURN_SECONDS, TURN_MIN_M, TURN_MAX_M);
}

// Spoken distances round to numbers a driver can hear, not the 10 m steps the screen shows
export function speakDistance(meters: number): string {
  const safe = Math.max(0, meters);
  if (safe >= 1000) {
    const km = (Math.round(safe / 500) * 500) / 1000;
    return km === 1 ? '1 kilometre' : `${km} kilometres`;
  }
  if (safe >= 100) return `${Math.round(safe / 100) * 100} metres`;
  return `${Math.max(50, Math.round(safe / 50) * 50)} metres`;
}

const ABBREVIATIONS: Record<string, string> = {
  rd: 'Road',
  ave: 'Avenue',
  av: 'Avenue',
  dr: 'Drive',
  ln: 'Lane',
  cres: 'Crescent',
  blvd: 'Boulevard',
  hwy: 'Highway',
  pl: 'Place',
  sq: 'Square',
};

export function expandStreetName(text: string): string {
  const expanded = text.replace(/\b(Rd|Ave|Av|Dr|Ln|Cres|Blvd|Hwy|Pl|Sq)\b\.?/gi, (_match, word: string) =>
    ABBREVIATIONS[word.toLowerCase()]
  );
  // "St" is Street only at the end of a name; "St James Road" is a saint
  return expanded.replace(/\bSt\b\.?\s*$/i, 'Street');
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/voice_guidance.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit -p .
git add src/lib/navigation/voiceGuidance.ts tests/voice_guidance.test.ts
git commit -m "feat(navigation): spoken distances, trigger distances and street name expansion"
```

---

### Task 2: Depart, warning and turn, spoken once each

The ladder's three ordinary tiers, with the latching that stops GPS jitter repeating them.

**Files:**
- Modify: `src/lib/navigation/voiceGuidance.ts`
- Test: `tests/voice_guidance.test.ts`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  - `type VoiceTier = 'depart' | 'headsUp' | 'warning' | 'turn' | 'arrive'`
  - `interface VoiceInput { steps: RouteStep[]; stepIndex: number; distanceToNextManeuverMeters: number; remainingMeters: number; speedMps: number | null; entranceName: string; isPreviewing: boolean; hasArrived: boolean; rerouteCount: number }`
  - `interface VoiceMemory { said: string[]; rerouteCount: number }`
  - `emptyVoiceMemory(): VoiceMemory`
  - `nextAnnouncement(input: VoiceInput, memory: VoiceMemory): { phrase: string | null; memory: VoiceMemory }`

`RouteStep` is imported from `@/lib/geospatial` and has `instruction: string`, `streetName: string`, `distanceMeters: number`, `durationSeconds: number`, `type: string`, `location: [number, number]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/voice_guidance.test.ts`:

```ts
import type { RouteStep } from '../src/lib/geospatial';
import { emptyVoiceMemory, nextAnnouncement, type VoiceInput, type VoiceMemory } from '../src/lib/navigation/voiceGuidance';

const leg = (instruction: string, streetName: string, distanceMeters: number, type = 'turn'): RouteStep => ({
  instruction,
  streetName,
  distanceMeters,
  durationSeconds: 0,
  type,
  location: [18.5, -33.96],
});

const DRIVE: RouteStep[] = [
  leg('Head out onto Lawrence Road', 'Lawrence Road', 600, 'depart'),
  leg('Turn right onto Aden Avenue', 'Aden Avenue', 450),
  leg('Arrive at Johnstone Road Gate', '', 0, 'arrive'),
];

// Feeds fixes through the engine and collects only what was actually spoken
function drive(fixes: Partial<VoiceInput>[], steps: RouteStep[] = DRIVE): string[] {
  let memory: VoiceMemory = emptyVoiceMemory();
  const spoken: string[] = [];
  for (const fix of fixes) {
    const result = nextAnnouncement(
      {
        steps,
        stepIndex: 0,
        distanceToNextManeuverMeters: 1000,
        remainingMeters: 3000,
        speedMps: 13.9,
        entranceName: 'Johnstone Road Gate',
        isPreviewing: false,
        hasArrived: false,
        rerouteCount: 0,
        ...fix,
      },
      memory
    );
    memory = result.memory;
    if (result.phrase) spoken.push(result.phrase);
  }
  return spoken;
}

describe('The three ordinary tiers', () => {
  it('says where to set off, once', () => {
    expect(drive([{ distanceToNextManeuverMeters: 600 }, { distanceToNextManeuverMeters: 590 }])).toEqual([
      'Head out onto Lawrence Road.',
    ]);
  });

  it('warns before the turn and then calls the turn', () => {
    expect(
      drive([
        { distanceToNextManeuverMeters: 600 },
        { distanceToNextManeuverMeters: 410 },
        { distanceToNextManeuverMeters: 200 },
        { distanceToNextManeuverMeters: 50 },
      ])
    ).toEqual([
      'Head out onto Lawrence Road.',
      'In 400 metres, turn right onto Aden Avenue.',
      'Turn right onto Aden Avenue.',
    ]);
  });

  it('says nothing twice when the distance jitters back over a threshold', () => {
    expect(
      drive([
        { distanceToNextManeuverMeters: 600 },
        { distanceToNextManeuverMeters: 410 },
        { distanceToNextManeuverMeters: 425 },
        { distanceToNextManeuverMeters: 405 },
      ])
    ).toEqual(['Head out onto Lawrence Road.', 'In 400 metres, turn right onto Aden Avenue.']);
  });

  it('drops a warning that is already stale rather than speaking it late', () => {
    expect(drive([{ distanceToNextManeuverMeters: 600 }, { distanceToNextManeuverMeters: 40 }])).toEqual([
      'Head out onto Lawrence Road.',
      'Turn right onto Aden Avenue.',
    ]);
  });

  it('speaks a depart and a warning in one breath on a short first leg', () => {
    expect(drive([{ distanceToNextManeuverMeters: 100 }])).toEqual([
      'Head out onto Lawrence Road. In 100 metres, turn right onto Aden Avenue.',
    ]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/voice_guidance.test.ts`
Expected: FAIL, `nextAnnouncement` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/navigation/voiceGuidance.ts`:

```ts
import type { RouteStep } from '@/lib/geospatial';

export type VoiceTier = 'depart' | 'headsUp' | 'warning' | 'turn' | 'arrive';

export interface VoiceInput {
  steps: RouteStep[];
  // The leg being driven now. The maneuver being announced is the one after it.
  stepIndex: number;
  distanceToNextManeuverMeters: number;
  remainingMeters: number;
  speedMps: number | null;
  entranceName: string;
  // True while the driver is scrubbing turns with the pager, which must stay silent
  isPreviewing: boolean;
  hasArrived: boolean;
  // Bumped by the screen each time a new route replaces one the driver left. 0 for a drive's first route.
  rerouteCount: number;
}

export interface VoiceMemory {
  // Keys of what has already been spoken, as `${index}:${tier}`
  said: string[];
  rerouteCount: number;
}

export interface VoiceResult {
  phrase: string | null;
  memory: VoiceMemory;
}

export const emptyVoiceMemory = (): VoiceMemory => ({ said: [], rerouteCount: 0 });

const sentence = (text: string) => {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

// "Turn right onto X" reads as "..., then turn right onto X" when chained, but "N2" must keep its capitals
const lowerFirst = (text: string) => {
  const trimmed = text.trim();
  const firstWord = trimmed.split(' ')[0] ?? '';
  if (firstWord.length > 1 && firstWord === firstWord.toUpperCase()) return trimmed;
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
};

export function nextAnnouncement(input: VoiceInput, memory: VoiceMemory): VoiceResult {
  const { steps, stepIndex, distanceToNextManeuverMeters: toTurn, speedMps, isPreviewing, rerouteCount } = input;

  if (isPreviewing || steps.length === 0) return { phrase: null, memory };

  const said = new Set(memory.said);
  const finish = (phrase: string | null): VoiceResult => ({
    phrase,
    memory: { said: Array.from(said), rerouteCount },
  });

  const parts: string[] = [];
  if (!said.has('depart')) {
    said.add('depart');
    parts.push(sentence(expandStreetName(steps[0].instruction)));
  }

  const turnIndex = stepIndex + 1;
  const upcoming = steps[turnIndex];
  if (!upcoming) return finish(parts.length > 0 ? parts.join(' ') : null);

  const warnAt = warningDistanceMeters(speedMps);
  const turnAt = turnDistanceMeters(speedMps);
  const warnKey = `${turnIndex}:warning`;
  const turnKey = `${turnIndex}:turn`;

  if (toTurn <= turnAt && !said.has(turnKey)) {
    // A tier that is already behind us is marked said rather than spoken late
    said.add(turnKey);
    said.add(warnKey);
    parts.push(sentence(expandStreetName(upcoming.instruction)));
  } else if (toTurn <= warnAt && !said.has(warnKey)) {
    said.add(warnKey);
    parts.push(sentence(`In ${speakDistance(toTurn)}, ${lowerFirst(expandStreetName(upcoming.instruction))}`));
  }

  return finish(parts.length > 0 ? parts.join(' ') : null);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/voice_guidance.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit -p .
git add src/lib/navigation/voiceGuidance.ts tests/voice_guidance.test.ts
git commit -m "feat(navigation): announce departure, the warning and the turn, once each"
```

---

### Task 3: The long-leg heads-up and chained turns

**Files:**
- Modify: `src/lib/navigation/voiceGuidance.ts`
- Test: `tests/voice_guidance.test.ts`

**Interfaces:**
- Consumes: `nextAnnouncement`, `VoiceInput`, `VoiceMemory` from Task 2.
- Produces: no new exports. `nextAnnouncement` gains the `headsUp` tier and chaining.

- [ ] **Step 1: Write the failing test**

Append to `tests/voice_guidance.test.ts`:

```ts
const LONG_DRIVE: RouteStep[] = [
  leg('Head out onto Lawrence Road', 'Lawrence Road', 600, 'depart'),
  leg('Turn left onto Klipfontein Road', 'Klipfontein Road', 1600),
  leg('Turn right onto Johnston Road', 'Johnston Road', 250),
  leg('Turn left onto Rylands Road', 'Rylands Road', 60),
  leg('Arrive at Johnstone Road Gate', '', 0, 'arrive'),
];

describe('Long legs and close turns', () => {
  it('gives a heads-up once on a leg over 1.5 km', () => {
    const spoken = drive(
      [
        { stepIndex: 1, distanceToNextManeuverMeters: 1600 },
        { stepIndex: 1, distanceToNextManeuverMeters: 1200 },
      ],
      LONG_DRIVE
    );
    expect(spoken).toEqual([
      'Head out onto Lawrence Road. Continue on Klipfontein Road for 1.5 kilometres.',
    ]);
  });

  it('gives no heads-up on a short leg, only the ordinary warning', () => {
    // 250 m is inside the warning distance, so the warning is due. What must not appear is a
    // "Continue on Johnston Road for..." line, because the leg is well under HEADS_UP_MIN_STEP_M.
    const spoken = drive([{ stepIndex: 2, distanceToNextManeuverMeters: 250 }], LONG_DRIVE);
    expect(spoken).toEqual(['Head out onto Lawrence Road. In 300 metres, turn left onto Rylands Road.']);
  });

  it('chains a turn that is followed closely by another', () => {
    const spoken = drive(
      [
        { stepIndex: 1, distanceToNextManeuverMeters: 1600 },
        { stepIndex: 1, distanceToNextManeuverMeters: 40 },
      ],
      LONG_DRIVE
    );
    expect(spoken[1]).toBe('Turn right onto Johnston Road, then turn left onto Rylands Road.');
  });

  it('does not warn again for a turn that was already chained', () => {
    let memory = emptyVoiceMemory();
    const base: VoiceInput = {
      steps: LONG_DRIVE,
      stepIndex: 1,
      distanceToNextManeuverMeters: 40,
      remainingMeters: 400,
      speedMps: 13.9,
      entranceName: 'Johnstone Road Gate',
      isPreviewing: false,
      hasArrived: false,
      rerouteCount: 0,
    };
    memory = nextAnnouncement(base, memory).memory;
    // Now on Johnston Road, 200 m from the Rylands turn, which is inside the warning distance
    const next = nextAnnouncement({ ...base, stepIndex: 2, distanceToNextManeuverMeters: 200 }, memory);
    expect(next.phrase).toBeNull();
  });

  it('never chains into arrival, which announces itself', () => {
    // Turning onto Rylands is followed 60 m later by arrival, which is close enough to chain but must not
    const spoken = drive([{ stepIndex: 2, distanceToNextManeuverMeters: 40 }], LONG_DRIVE);
    expect(spoken[0]).toBe('Head out onto Lawrence Road. Turn left onto Rylands Road.');
  });

  it('stays silent while the driver scrubs through turns', () => {
    const spoken = drive([{ distanceToNextManeuverMeters: 40, isPreviewing: true }]);
    expect(spoken).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/voice_guidance.test.ts`
Expected: FAIL. The heads-up tests get only the depart line, and the chaining test gets an unchained turn.

- [ ] **Step 3: Write the implementation**

In `src/lib/navigation/voiceGuidance.ts`, replace the `if (toTurn <= turnAt ...)` block and what follows it with:

```ts
  const headsUpKey = `${stepIndex}:headsUp`;

  if (toTurn <= turnAt && !said.has(turnKey)) {
    // A tier that is already behind us is marked said rather than spoken late
    said.add(turnKey);
    said.add(warnKey);
    said.add(headsUpKey);
    parts.push(sentence(chainedTurn(steps, turnIndex, warnAt, said)));
  } else if (toTurn <= warnAt && !said.has(warnKey)) {
    said.add(warnKey);
    said.add(headsUpKey);
    parts.push(sentence(`In ${speakDistance(toTurn)}, ${lowerFirst(expandStreetName(upcoming.instruction))}`));
  } else if (
    !said.has(headsUpKey) &&
    toTurn > warnAt &&
    (steps[stepIndex]?.distanceMeters ?? 0) > HEADS_UP_MIN_STEP_M
  ) {
    said.add(headsUpKey);
    const road = expandStreetName(steps[stepIndex].streetName || '');
    parts.push(sentence(road ? `Continue on ${road} for ${speakDistance(toTurn)}` : `Continue for ${speakDistance(toTurn)}`));
  }

  return finish(parts.length > 0 ? parts.join(' ') : null);
}

// Two turns closer together than the warning distance are spoken as one sentence, and the second one's
// warning is marked said so it is not announced again from a standing start. Arrival is never chained onto,
// because the arrival line follows seconds later.
function chainedTurn(steps: RouteStep[], turnIndex: number, warnAt: number, said: Set<string>): string {
  const instruction = expandStreetName(steps[turnIndex].instruction);
  const following = steps[turnIndex + 1];
  const legAfter = steps[turnIndex].distanceMeters;
  if (!following || following.type === 'arrive' || legAfter >= warnAt) return instruction;
  said.add(`${turnIndex + 1}:warning`);
  return `${instruction}, then ${lowerFirst(expandStreetName(following.instruction))}`;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/voice_guidance.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit -p .
git add src/lib/navigation/voiceGuidance.ts tests/voice_guidance.test.ts
git commit -m "feat(navigation): heads-up on long legs, and chain turns that arrive together"
```

---

### Task 4: Arrival and rerouting

**Files:**
- Modify: `src/lib/navigation/voiceGuidance.ts`
- Test: `tests/voice_guidance.test.ts`

**Interfaces:**
- Consumes: `nextAnnouncement`, `VoiceMemory` from Tasks 2 and 3.
- Produces: no new exports. `nextAnnouncement` gains the `arrive` tier and reroute handling.

- [ ] **Step 1: Write the failing test**

Append to `tests/voice_guidance.test.ts`:

```ts
describe('Arrival and rerouting', () => {
  it('announces arrival once, by the gate name', () => {
    const spoken = drive([
      { stepIndex: 1, remainingMeters: 30 },
      { stepIndex: 1, remainingMeters: 12 },
    ]);
    expect(spoken).toEqual([
      'Head out onto Lawrence Road. You have arrived at Johnstone Road Gate.',
    ]);
  });

  it('announces arrival when the screen latches it, even further out', () => {
    const spoken = drive([{ stepIndex: 1, remainingMeters: 300, hasArrived: true }]);
    expect(spoken[0]).toContain('You have arrived at Johnstone Road Gate.');
  });

  it('says nothing about rerouting on the first route of a drive', () => {
    expect(drive([{ distanceToNextManeuverMeters: 600, rerouteCount: 0 }])).toEqual([
      'Head out onto Lawrence Road.',
    ]);
  });

  it('leaves the final maneuver to the arrival line rather than calling it as a turn', () => {
    // 50 m out the arrive maneuver is inside the turn distance, but the arrival line follows at 40 m
    const spoken = drive([
      { stepIndex: 1, distanceToNextManeuverMeters: 50, remainingMeters: 50 },
      { stepIndex: 1, distanceToNextManeuverMeters: 40, remainingMeters: 40 },
    ]);
    expect(spoken).toEqual([
      'Head out onto Lawrence Road.',
      'You have arrived at Johnstone Road Gate.',
    ]);
  });

  it('says rerouting and forgets what it said when a new route arrives', () => {
    let memory = emptyVoiceMemory();
    const base: VoiceInput = {
      steps: DRIVE,
      stepIndex: 0,
      distanceToNextManeuverMeters: 300,
      remainingMeters: 3000,
      speedMps: 13.9,
      entranceName: 'Johnstone Road Gate',
      isPreviewing: false,
      hasArrived: false,
      rerouteCount: 0,
    };
    memory = nextAnnouncement(base, memory).memory;

    const rerouted = nextAnnouncement({ ...base, rerouteCount: 1 }, memory);
    expect(rerouted.phrase).toBe('Rerouting.');
    expect(rerouted.memory.said).toEqual([]);

    // The new route's own departure is spoken again, because it is a different route
    const afterwards = nextAnnouncement({ ...base, rerouteCount: 1 }, rerouted.memory);
    expect(afterwards.phrase).toContain('Head out onto Lawrence Road.');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/voice_guidance.test.ts`
Expected: FAIL. Arrival is never announced and a reroute says nothing.

- [ ] **Step 3: Write the implementation**

In `src/lib/navigation/voiceGuidance.ts`, widen the destructure and insert two blocks at the top of `nextAnnouncement`. The function's opening becomes:

```ts
export function nextAnnouncement(input: VoiceInput, memory: VoiceMemory): VoiceResult {
  const {
    steps,
    stepIndex,
    distanceToNextManeuverMeters: toTurn,
    remainingMeters,
    speedMps,
    entranceName,
    isPreviewing,
    hasArrived,
    rerouteCount,
  } = input;

  // A new route means the old route's step numbers mean nothing, so the memory goes with it
  if (rerouteCount !== memory.rerouteCount) {
    return { phrase: 'Rerouting.', memory: { said: [], rerouteCount } };
  }

  if (isPreviewing || steps.length === 0) return { phrase: null, memory };

  const said = new Set(memory.said);
  const finish = (phrase: string | null): VoiceResult => ({
    phrase,
    memory: { said: Array.from(said), rerouteCount },
  });

  const parts: string[] = [];
  if (!said.has('depart')) {
    said.add('depart');
    parts.push(sentence(expandStreetName(steps[0].instruction)));
  }

  // Arrival ends the drive and outranks any turn still pending
  if ((hasArrived || remainingMeters <= ARRIVAL_M) && !said.has('arrive')) {
    said.add('arrive');
    parts.push(sentence(`You have arrived at ${expandStreetName(entranceName)}`));
    return finish(parts.join(' '));
  }
```

Then guard the turn and warning tiers so they never call the final maneuver. Change the two conditions in the tier chain to:

```ts
  // The last maneuver is the destination. Calling it as a turn would say the same thing twice, seconds apart.
  const isArrival = upcoming.type === 'arrive';

  if (!isArrival && toTurn <= turnAt && !said.has(turnKey)) {
```

and

```ts
  } else if (!isArrival && toTurn <= warnAt && !said.has(warnKey)) {
```

The heads-up tier is left alone, so a long final leg still gets its "continue on" line. The rest of the function is unchanged from Task 3.

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/voice_guidance.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit -p .
git add src/lib/navigation/voiceGuidance.ts tests/voice_guidance.test.ts
git commit -m "feat(navigation): announce arrival at the gate and a reroute"
```

---

### Task 5: The whole drive, end to end

One test that proves the tiers, the chaining and the latching work together over the 3 km drive to Johnson Road. This is the regression net for every later change.

**Files:**
- Test: `tests/voice_guidance.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 to 4. No new exports.

- [ ] **Step 1: Write the test**

Append to `tests/voice_guidance.test.ts`:

```ts
// The drive in the screenshot: 3 km from Lawrence Road to the Johnstone Road gate
const JOHNSON_ROAD: RouteStep[] = [
  leg('Head out onto Lawrence Road', 'Lawrence Road', 600, 'depart'),
  leg('Turn right onto Aden Avenue', 'Aden Avenue', 450),
  leg('Turn left onto Klipfontein Road', 'Klipfontein Road', 1600),
  leg('Turn right onto Johnston Road', 'Johnston Road', 250),
  leg('Turn left onto Rylands Road', 'Rylands Road', 60),
  leg('Turn right onto Carnie Road', 'Carnie Road', 40),
  leg('Arrive at Johnstone Road Gate', '', 0, 'arrive'),
];

describe('A whole drive to the cemetery', () => {
  it('speaks the drive the way a Garmin would, and never repeats itself', () => {
    const legLengths = JOHNSON_ROAD.map((step) => step.distanceMeters);
    const total = legLengths.reduce((sum, metres) => sum + metres, 0);
    let memory = emptyVoiceMemory();
    const spoken: string[] = [];
    let travelled = 0;

    // A fix every 10 m, which is about one a second at 50 km/h
    while (travelled <= total) {
      // Walk the legs in order and stop on the one the driver is inside. Testing every leg against a
      // legStart left over from an earlier one jumps stepIndex onto the short legs near the gate.
      let stepIndex = 0;
      let legStart = 0;
      while (stepIndex + 1 < legLengths.length && travelled >= legStart + legLengths[stepIndex]) {
        legStart += legLengths[stepIndex];
        stepIndex += 1;
      }
      const result = nextAnnouncement(
        {
          steps: JOHNSON_ROAD,
          stepIndex,
          distanceToNextManeuverMeters: legStart + legLengths[stepIndex] - travelled,
          remainingMeters: total - travelled,
          speedMps: 13.9,
          entranceName: 'Johnstone Road Gate',
          isPreviewing: false,
          hasArrived: false,
          rerouteCount: 0,
        },
        memory
      );
      memory = result.memory;
      if (result.phrase) spoken.push(result.phrase);
      travelled += 10;
    }

    expect(spoken).toEqual([
      'Head out onto Lawrence Road.',
      'In 400 metres, turn right onto Aden Avenue.',
      'Turn right onto Aden Avenue.',
      'In 400 metres, turn left onto Klipfontein Road.',
      'Turn left onto Klipfontein Road.',
      'Continue on Klipfontein Road for 1.5 kilometres.',
      'In 400 metres, turn right onto Johnston Road.',
      'Turn right onto Johnston Road, then turn left onto Rylands Road.',
      'Turn left onto Rylands Road, then turn right onto Carnie Road.',
      'Turn right onto Carnie Road.',
      'You have arrived at Johnstone Road Gate.',
    ]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/voice_guidance.test.ts`
Expected: PASS, 25 tests.

If the order or wording differs, do not edit the expectation to match the output. Work out which rule misfired and fix the engine. The one case where the expectation is legitimately wrong is if the heads-up on Klipfontein lands before the turn onto it, which would mean `stepIndex` advanced a fix early.

- [ ] **Step 3: Commit**

```bash
git add tests/voice_guidance.test.ts
git commit -m "test(navigation): the whole drive to Johnson Road, spoken"
```

---

### Task 6: Picking a voice and talking

**Files:**
- Create: `src/lib/navigation/voiceSpeaker.ts`
- Test: `tests/voice_speaker.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface VoiceLike { name: string; lang: string }`
  - `interface UtteranceLike { text: string; voice: VoiceLike | null; lang: string; rate: number; pitch: number; volume: number }`
  - `interface SynthLike { getVoices(): VoiceLike[]; speak(utterance: UtteranceLike): void; cancel(): void; addEventListener?(type: string, listener: () => void): void }`
  - `pickVoice(voices: VoiceLike[]): VoiceLike | null`
  - `class VoiceSpeaker` with `constructor(deps: { synth: SynthLike; createUtterance: (text: string) => UtteranceLike })`, `say(text: string): void`, `stop(): void`, `get voiceName(): string | null`
  - `createBrowserSpeaker(): VoiceSpeaker | null`

- [ ] **Step 1: Write the failing test**

Create `tests/voice_speaker.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { VoiceSpeaker, pickVoice, type SynthLike, type UtteranceLike, type VoiceLike } from '../src/lib/navigation/voiceSpeaker';

const voice = (name: string, lang: string): VoiceLike => ({ name, lang });

describe('Picking a voice', () => {
  it('prefers a South African English voice', () => {
    const picked = pickVoice([voice('Daniel', 'en-GB'), voice('Tessa', 'en-ZA'), voice('Samantha', 'en-US')]);
    expect(picked?.name).toBe('Tessa');
  });

  it('prefers a female voice within a language', () => {
    const picked = pickVoice([voice('Daniel', 'en-GB'), voice('Google UK English Female', 'en-GB')]);
    expect(picked?.name).toBe('Google UK English Female');
  });

  it('takes a male English voice rather than staying silent', () => {
    expect(pickVoice([voice('Daniel', 'en-GB')])?.name).toBe('Daniel');
  });

  it('leaves the choice to the browser when nothing English is installed', () => {
    expect(pickVoice([voice('Xander', 'nl-NL')])).toBeNull();
    expect(pickVoice([])).toBeNull();
  });
});

function fakeSynth(voices: VoiceLike[] = [voice('Tessa', 'en-ZA')]) {
  const spoken: UtteranceLike[] = [];
  const synth: SynthLike = {
    getVoices: () => voices,
    speak: (utterance) => void spoken.push(utterance),
    cancel: vi.fn(),
  };
  const speaker = new VoiceSpeaker({
    synth,
    createUtterance: (text) => ({ text, voice: null, lang: '', rate: 1, pitch: 1, volume: 1 }),
  });
  return { speaker, spoken, synth };
}

describe('Speaking', () => {
  it('speaks with the chosen voice', () => {
    const { speaker, spoken } = fakeSynth();
    speaker.say('Turn right onto Aden Avenue.');
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe('Turn right onto Aden Avenue.');
    expect(spoken[0].voice?.name).toBe('Tessa');
    expect(speaker.voiceName).toBe('Tessa');
  });

  it('cancels whatever is still talking, so a stale turn never lands late', () => {
    const { speaker, spoken, synth } = fakeSynth();
    speaker.say('In 400 metres, turn right onto Aden Avenue.');
    speaker.say('Turn right onto Aden Avenue.');
    expect(synth.cancel).toHaveBeenCalledTimes(2);
    expect(spoken[1].text).toBe('Turn right onto Aden Avenue.');
  });

  it('says nothing when asked to speak an empty phrase', () => {
    const { speaker, spoken } = fakeSynth();
    speaker.say('   ');
    expect(spoken).toEqual([]);
  });

  it('picks a voice later when the device reports none at first', () => {
    let voices: VoiceLike[] = [];
    let onChanged: (() => void) | null = null;
    const spoken: UtteranceLike[] = [];
    const speaker = new VoiceSpeaker({
      synth: {
        getVoices: () => voices,
        speak: (utterance) => void spoken.push(utterance),
        cancel: () => {},
        addEventListener: (_type, listener) => void (onChanged = listener),
      },
      createUtterance: (text) => ({ text, voice: null, lang: '', rate: 1, pitch: 1, volume: 1 }),
    });

    expect(speaker.voiceName).toBeNull();
    voices = [voice('Tessa', 'en-ZA')];
    onChanged?.();
    speaker.say('Rerouting.');
    expect(spoken[0].voice?.name).toBe('Tessa');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/voice_speaker.test.ts`
Expected: FAIL, cannot resolve `../src/lib/navigation/voiceSpeaker`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/navigation/voiceSpeaker.ts`:

```ts
// Talking through the phone's own speech synthesis. The synth and the utterance factory are injected so this
// tests without a DOM, the same way wakeLockService.ts sits under useWakeLock.

export interface VoiceLike {
  name: string;
  lang: string;
}

export interface UtteranceLike {
  text: string;
  voice: VoiceLike | null;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
}

export interface SynthLike {
  getVoices(): VoiceLike[];
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  addEventListener?(type: string, listener: () => void): void;
}

// Names the common female voices go by on Android, iOS and Windows
const FEMALE_HINTS = [
  'female', 'tessa', 'samantha', 'karen', 'moira', 'fiona', 'serena', 'zira', 'hazel',
  'susan', 'joanna', 'aria', 'sonia', 'libby', 'michelle', 'catherine', 'amelie',
];

const isFemaleName = (name: string) => {
  const lower = name.toLowerCase();
  return FEMALE_HINTS.some((hint) => lower.includes(hint));
};

// South African English first, then British, then any English. Anything else is left to the browser.
const langRank = (lang: string): number => {
  const lower = (lang || '').toLowerCase();
  if (lower.startsWith('en-za')) return 0;
  if (lower.startsWith('en-gb')) return 1;
  if (lower.startsWith('en')) return 2;
  return 99;
};

export function pickVoice(voices: VoiceLike[]): VoiceLike | null {
  const english = voices.filter((candidate) => langRank(candidate.lang) < 99);
  if (english.length === 0) return null;
  const score = (candidate: VoiceLike) => langRank(candidate.lang) * 2 + (isFemaleName(candidate.name) ? 0 : 1);
  return english.reduce((best, candidate) => (score(candidate) < score(best) ? candidate : best));
}

export class VoiceSpeaker {
  private voice: VoiceLike | null = null;

  constructor(private readonly deps: { synth: SynthLike; createUtterance: (text: string) => UtteranceLike }) {
    this.refreshVoice();
    // getVoices() is often empty on the first call and fills in a moment later
    this.deps.synth.addEventListener?.('voiceschanged', () => this.refreshVoice());
  }

  private refreshVoice(): void {
    this.voice = pickVoice(this.deps.synth.getVoices() ?? []);
  }

  get voiceName(): string | null {
    return this.voice?.name ?? null;
  }

  say(text: string): void {
    const phrase = text.trim();
    if (!phrase) return;
    if (!this.voice) this.refreshVoice();
    // Nothing queues: a stale "in 400 metres" arriving at 80 m is worse than silence
    this.deps.synth.cancel();
    const utterance = this.deps.createUtterance(phrase);
    if (this.voice) {
      utterance.voice = this.voice;
      utterance.lang = this.voice.lang;
    }
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    this.deps.synth.speak(utterance);
  }

  stop(): void {
    this.deps.synth.cancel();
  }
}

export function createBrowserSpeaker(): VoiceSpeaker | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  return new VoiceSpeaker({
    synth: window.speechSynthesis as unknown as SynthLike,
    createUtterance: (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
  });
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/voice_speaker.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit -p .
git add src/lib/navigation/voiceSpeaker.ts tests/voice_speaker.test.ts
git commit -m "feat(navigation): pick a female English voice and speak through it"
```

---

### Task 7: The hook that joins them

**Files:**
- Create: `src/lib/navigation/useVoiceGuidance.ts`

**Interfaces:**
- Consumes: `nextAnnouncement`, `emptyVoiceMemory`, `VoiceMemory` (Tasks 2 to 4); `VoiceSpeaker`, `createBrowserSpeaker` (Task 6); `RouteStep` from `@/lib/geospatial`.
- Produces:
  - `VOICE_STORAGE_KEY = 'qabrmap_voice_guidance'`
  - `useVoiceGuidance(input: UseVoiceGuidanceInput): { enabled: boolean; available: boolean; toggle: () => void }`
  - `interface UseVoiceGuidanceInput { active: boolean; steps: RouteStep[]; stepIndex: number; distanceToNextManeuverMeters: number; remainingMeters: number; deviceSpeedMps: number | null; entranceName: string; isPreviewing: boolean; hasArrived: boolean }`

There is no test for this task. It is a wrapper with no branching logic of its own, and the project has no way to render a hook. Everything it decides lives in Tasks 1 to 6, which are tested.

- [ ] **Step 1: Write the hook**

Create `src/lib/navigation/useVoiceGuidance.ts`:

```ts
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

  // The speaker is only built in the browser, and only once
  const available = useMemo(() => {
    if (typeof window === 'undefined') return false;
    if (!speakerRef.current) speakerRef.current = createBrowserSpeaker();
    return speakerRef.current !== null;
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/navigation/useVoiceGuidance.ts
git commit -m "feat(navigation): hook joining the guidance engine to the phone's voice"
```

---

### Task 8: The toggle on the driving screen

**Files:**
- Modify: `src/components/screens/NavigationScreen.tsx`

**Interfaces:**
- Consumes: `useVoiceGuidance` from Task 7.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the imports**

In the lucide import block at lines 4 to 21, add `Volume2` and `VolumeX` after `RotateCcw`:

```tsx
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
```

After the `navigationMode` import on line 58, add:

```tsx
import { useVoiceGuidance } from '@/lib/navigation/useVoiceGuidance';
```

- [ ] **Step 2: Capture the device's speed**

Inside the geolocation success callback, immediately after `setGpsAccuracy(pos.coords.accuracy);`, add:

```tsx
          // Android usually reports speed; iOS often does not, and the hook falls back to its own estimate
          const reported = pos.coords.speed;
          setDeviceSpeedMps(reported !== null && Number.isFinite(reported) && reported >= 0 ? reported : null);
```

Declare the state beside the other GPS state, next to `const [gpsAccuracy, setGpsAccuracy] = ...`:

```tsx
  const [deviceSpeedMps, setDeviceSpeedMps] = useState<number | null>(null);
```

- [ ] **Step 3: Call the hook**

After the `routeProgress` memo (which ends around line 342) and after `liveStepIndex` and `isPreviewingStep` are defined near line 473, add:

```tsx
  // Spoken turn-by-turn guidance. Off until the driver taps the speaker, then remembered on this device.
  const voice = useVoiceGuidance({
    active: activeMode === 'driving',
    steps: drivingSteps,
    stepIndex: liveStepIndex,
    distanceToNextManeuverMeters: routeProgress?.distanceToNextManeuverMeters ?? Infinity,
    remainingMeters: routeProgress?.remainingMeters ?? Infinity,
    deviceSpeedMps,
    entranceName,
    isPreviewing: isPreviewingStep,
    hasArrived,
  });
```

Place it after the line `const isPreviewingStep = previewStepIndex !== null;` so every value it reads is already defined.

- [ ] **Step 4: Add the button**

In the turn card, replace the opening of the step badge block at line 1282 so the speaker sits beside the pager:

```tsx
            {/* Top-Right Voice Toggle and Maneuver Step Badge (e.g. 2/13) */}
            <div className="absolute top-2.5 right-3 flex items-center space-x-1.5 z-10">
              {voice.available && (
                <button
                  onClick={voice.toggle}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-black/40 backdrop-blur-xs border border-emerald-400/25 text-white/80 hover:text-white active:scale-95 transition-transform"
                  title={voice.enabled ? 'Turn off spoken directions' : 'Turn on spoken directions'}
                  aria-label={voice.enabled ? 'Turn off spoken directions' : 'Turn on spoken directions'}
                  aria-pressed={voice.enabled}
                >
                  {voice.enabled ? (
                    <Volume2 className="w-4 h-4 text-emerald-300" />
                  ) : (
                    <VolumeX className="w-4 h-4" />
                  )}
                </button>
              )}
              {drivingSteps.length > 1 && (
                <div className="flex items-center bg-black/40 backdrop-blur-xs rounded-lg p-0.5 border border-emerald-400/25">
```

The two pager buttons and the `{currentStepIndex + 1}/{drivingSteps.length}` span stay exactly as they are. Close the block with `</div>)}</div>` in place of the old `</div>)}`, so the pager's conditional closes inside the new wrapper.

- [ ] **Step 5: Give the text room**

On the row below (line 1306 before this change), widen the padding so a long instruction does not run under the two badges:

```tsx
            <div className="flex items-center space-x-3.5 pr-24 w-full">
```

- [ ] **Step 6: Type-check and run everything**

```bash
npx tsc --noEmit -p .
npm test
```
Expected: no type errors, all tests pass.

- [ ] **Step 7: Check it in a browser**

```bash
npx next dev -p 3000
```

Port 3000 is required. The Google Maps key rejects every other referer and the map stays blank on 403.

Open a grave, start navigation, and confirm: the speaker icon sits left of the step pager, tapping it says "Voice guidance on", the icon fills in green, a reload keeps it on, and tapping again goes silent. Desktop Chrome has voices, so this works without a phone. Turn-by-turn announcements need movement, which Task 5's test already covers.

- [ ] **Step 8: Commit**

```bash
git add src/components/screens/NavigationScreen.tsx
git commit -m "feat(navigation): speaker toggle for spoken driving directions"
```

---

## Verification

After Task 8, the whole feature is in. Confirm all of the following before calling it done:

- `npm test` passes, with 33 new tests across `tests/voice_guidance.test.ts` and `tests/voice_speaker.test.ts`.
- `npx tsc --noEmit -p .` is silent.
- The toggle survives a reload and the voice says nothing when it is off.
- Nothing speaks on the walking screen or in AR.

A real drive is the only way to check the trigger distances feel right, and it has not been done. Say so rather than implying it has.
