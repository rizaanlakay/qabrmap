import { describe, it, expect } from 'vitest';
import { DefaultExtractionProvider } from '../src/lib/ai/providers';

describe('AI Gravestone Extraction Unit Tests', () => {
  const extractor = new DefaultExtractionProvider();

  it('extracts structured information from standard gravestone tokens', async () => {
    const rawOcr = `
      8660
      ABDUL
      WAHAB
      HASSAN
      NARKER
      B. 28-01-1947
      D. 23-09-2016
    `;

    const lines = [
      { text: '8660', confidence: 0.99, language: 'en' },
      { text: 'ABDUL', confidence: 0.98, language: 'en' },
      { text: 'WAHAB', confidence: 0.97, language: 'en' },
      { text: 'HASSAN', confidence: 0.98, language: 'en' },
      { text: 'NARKER', confidence: 0.99, language: 'en' },
      { text: 'B. 28-01-1947', confidence: 0.96, language: 'en' },
      { text: 'D. 23-09-2016', confidence: 0.97, language: 'en' },
    ];

    const result = await extractor.extractStructuredData(rawOcr, lines);

    expect(result.graveNumber).toBe('8660');
    expect(result.firstName).toBe('Abdul');
    expect(result.middleNames).toContain('Wahab');
    expect(result.surname).toContain('Narker');
    expect(result.birthDate).toBe('1947-01-28');
    expect(result.deathDate).toBe('2016-09-23');
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.rawOcrText).toContain('8660');
  });

  it('handles alternative date formats and prefixes (e.g. BORN, DIED)', async () => {
    const rawOcr = `
      GRAVE 1203
      FATIMA PARKER
      BORN 15/06/1955
      DIED 20/11/2021
    `;
    const lines = [
      { text: 'GRAVE 1203', confidence: 0.95, language: 'en' },
      { text: 'FATIMA PARKER', confidence: 0.95, language: 'en' },
      { text: 'BORN 15/06/1955', confidence: 0.95, language: 'en' },
      { text: 'DIED 20/11/2021', confidence: 0.95, language: 'en' },
    ];

    const result = await extractor.extractStructuredData(rawOcr, lines);
    expect(result.graveNumber).toBe('1203');
    expect(result.firstName).toBe('Fatima');
    expect(result.surname).toBe('Parker');
    expect(result.birthDate).toBe('1955-06-15');
    expect(result.deathDate).toBe('2021-11-20');
  });

  it('leaves every field blank when nothing could be read, instead of inventing a person', async () => {
    const result = await extractor.extractStructuredData('', []);
    expect(result.graveNumber).toBe('');
    expect(result.firstName).toBe('');
    expect(result.middleNames).toEqual([]);
    expect(result.surname).toBe('');
    expect(result.fullName).toBe('');
    expect(result.birthDate).toBeUndefined();
    expect(result.deathDate).toBeUndefined();
    expect(result.gender).toBeUndefined();
    expect(result.confidence).toBe(0);
    expect(result.fieldConfidences).toEqual({ graveNumber: 0, fullName: 0, dates: 0 });
  });

  it('scores only the fields it found', async () => {
    const lines = [{ text: 'GRAVE 1203', confidence: 0.9, language: 'en' }];
    const result = await extractor.extractStructuredData('GRAVE 1203', lines);
    expect(result.graveNumber).toBe('1203');
    expect(result.fieldConfidences.graveNumber).toBeCloseTo(0.9);
    expect(result.fieldConfidences.fullName).toBe(0);
    expect(result.fieldConfidences.dates).toBe(0);
    expect(result.confidence).toBeCloseTo(0.3);
  });
});
