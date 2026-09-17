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
