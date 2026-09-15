import { describe, it, expect } from 'vitest';
import { readCompassHeading } from '../src/lib/device/compass';

describe('Compass Heading Tests', () => {
  it('uses the iOS compass heading, including due north', () => {
    expect(readCompassHeading({ webkitCompassHeading: 90, alpha: 10 }, 'relative')).toBe(90);
    expect(readCompassHeading({ webkitCompassHeading: 0 }, 'relative')).toBe(0);
    expect(readCompassHeading({ webkitCompassHeading: 359.6 }, 'relative')).toBe(0);
  });

  it('converts alpha from an absolute orientation event to a clockwise heading', () => {
    expect(readCompassHeading({ alpha: 90 }, 'absolute')).toBe(270);
    expect(readCompassHeading({ alpha: 0 }, 'absolute')).toBe(0);
    expect(readCompassHeading({ alpha: 270.4 }, 'absolute')).toBe(90);
  });

  it('ignores alpha from a relative event, which is not measured from north', () => {
    expect(readCompassHeading({ alpha: 90 }, 'relative')).toBeNull();
  });

  it('returns null when there is no usable reading', () => {
    expect(readCompassHeading({ alpha: null }, 'absolute')).toBeNull();
    expect(readCompassHeading({}, 'absolute')).toBeNull();
    expect(readCompassHeading({ webkitCompassHeading: Number.NaN }, 'relative')).toBeNull();
  });
});
