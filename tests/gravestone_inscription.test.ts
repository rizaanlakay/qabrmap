import { describe, it, expect } from 'vitest';
import {
  buildGravestoneInscription,
  formatStoneDate,
  hasRealGravePhoto,
  layoutInscription,
  nameFontSize,
  wrapNameLines,
} from '../src/lib/ui/gravestoneInscription';

const baselines = (layout: ReturnType<typeof layoutInscription>) =>
  [layout.bismillahY, layout.graveNumberY, ...layout.nameYs, ...layout.dateYs].filter((y): y is number => y !== null);

describe('Gravestone Inscription Tests', () => {
  it('treats missing photos and the shared placeholder as no photo', () => {
    expect(hasRealGravePhoto(undefined)).toBe(false);
    expect(hasRealGravePhoto('')).toBe(false);
    expect(hasRealGravePhoto('/sample-gravestone.svg')).toBe(false);
    expect(hasRealGravePhoto('https://qabrmap.vercel.app/sample-gravestone.svg?v=2')).toBe(false);
    expect(
      hasRealGravePhoto('https://abc.supabase.co/storage/v1/object/public/grave-photos/cem_athlone/grave_1402_1.jpg')
    ).toBe(true);
  });

  it('writes dates the way they are carved', () => {
    expect(formatStoneDate('2018-05-14')).toBe('14-05-2018');
    expect(formatStoneDate('1938-04-12T00:00:00Z')).toBe('12-04-1938');
    expect(formatStoneDate('circa 1950')).toBe('circa 1950');
    expect(formatStoneDate(undefined)).toBeNull();
  });

  it('stacks names onto the stone, keeping short words together', () => {
    expect(wrapNameLines('Fatima Hendricks')).toEqual(['FATIMA', 'HENDRICKS']);
    expect(wrapNameLines('Ali bin Omar')).toEqual(['ALI BIN OMAR']);
    expect(wrapNameLines('Abdul Wahab Hassan Narker')).toEqual(['ABDUL WAHAB', 'HASSAN', 'NARKER']);
    expect(wrapNameLines('Muhammad Abdurrahman Ismail Abrahams Petersen')).toEqual([
      'MUHAMMAD',
      'ABDURRAHMAN',
      'ISMAIL',
      'ABRAHAMS PETERSEN',
    ]);
  });

  it('shrinks the lettering for long names but keeps it readable', () => {
    expect(nameFontSize(['FATIMA', 'HENDRICKS'])).toBe(38);
    expect(nameFontSize(['ABRAHAMS PETERSEN'])).toBeLessThan(38);
    expect(nameFontSize(['A'.repeat(60)])).toBe(18);
  });

  it('centres a typical inscription on the stone so cropped frames still show every line', () => {
    const layout = layoutInscription(
      buildGravestoneInscription({ graveNumber: '1402', fullName: 'Fatima Hendricks', birthDate: '1938-03-15', deathDate: '2018-05-14' })
    );
    const ys = baselines(layout);
    expect(ys).toHaveLength(6);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect((ys[0] + ys[ys.length - 1]) / 2).toBeCloseTo(412, -1);
    // A wide 448x288 frame shows roughly y 207 to 593 of the drawing
    expect(ys[0] - 28).toBeGreaterThanOrEqual(207);
    expect(ys[ys.length - 1]).toBeLessThanOrEqual(593);
  });

  it('keeps a long inscription inside the stone face', () => {
    const ys = baselines(
      layoutInscription(
        buildGravestoneInscription({
          graveNumber: '12345',
          fullName: 'Muhammad Abdurrahman Ismail Abrahams Petersen',
          birthDate: '1930-01-01',
          deathDate: '2020-12-31',
        })
      )
    );
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(225);
    expect(Math.max(...ys)).toBeLessThanOrEqual(705);
  });

  it('lays out a grave that only has a number', () => {
    const layout = layoutInscription(buildGravestoneInscription({ graveNumber: '5225' }));
    expect(layout.nameYs).toEqual([]);
    expect(layout.dateYs).toEqual([]);
    expect(layout.graveNumberY! - layout.bismillahY).toBe(55);
  });

  it('builds the full inscription from the details already captured', () => {
    expect(
      buildGravestoneInscription({ graveNumber: '1402', fullName: 'Fatima Hendricks', deathDate: '2018-05-14' })
    ).toEqual({
      graveNumber: '1402',
      nameLines: ['FATIMA', 'HENDRICKS'],
      nameFontSize: 38,
      bornLine: null,
      diedLine: 'D. 14-05-2018',
    });
    expect(buildGravestoneInscription({ graveNumber: ' 5225 ' })).toMatchObject({
      graveNumber: '5225',
      nameLines: [],
      bornLine: null,
      diedLine: null,
    });
  });
});
