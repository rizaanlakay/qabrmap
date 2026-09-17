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
