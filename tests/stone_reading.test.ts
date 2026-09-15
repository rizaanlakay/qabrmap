import { describe, it, expect, vi } from 'vitest';
import {
  MAX_STONE_PHOTO_CHARS,
  STONE_READING_MODEL,
  STONE_READING_SCHEMA,
  StoneReading,
  bearerToken,
  isStoneReading,
  parseStonePhoto,
  stoneReadingToExtraction,
} from '../src/lib/ai/stoneReading';
import { readStonePhoto, ResponsesClient, StoneReadingError } from '../src/lib/ai/readStone';
import { scaledSize } from '../src/lib/capture/stonePhoto';
import { stoneReadingErrorMessage } from '../src/lib/capture/requestStoneReading';

// The handwritten test page: "786 / YUSUF KAMISH / 02-FEB-1952 / TO / 16-JUN-2018"
const yusuf: StoneReading = {
  hasGraveDetails: true,
  firstName: 'Yusuf',
  middleNames: [],
  surname: 'Kamish',
  nickname: null,
  graveNumber: null,
  birthDate: '1952-02-02',
  deathDate: '2018-06-16',
  datesAsWritten: '02-FEB-1952 TO 16-JUN-2018',
  transcript: '786\nYUSUF KAMISH\n02-FEB-1952\nTO\n16-JUN-2018',
  confidence: { name: 0.9, graveNumber: 0, dates: 0.95 },
  notes: ['786 at the top stands for Bismillah'],
};

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRg';

type Schema = { type?: unknown; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: unknown; items?: Schema };

function responseWithText(text: string, status = 'completed') {
  return {
    status,
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
    output_text: text,
  };
}

function fakeClient(response: unknown) {
  const create = vi.fn(async (..._args: unknown[]) => response);
  return { client: { responses: { create } } as unknown as ResponsesClient, create };
}

describe('Stone Reading Schema Tests', () => {
  it('uses GPT-5.6 Luna', () => {
    expect(STONE_READING_MODEL).toBe('gpt-5.6-luna');
  });

  it('is valid for strict structured outputs: every object closes and requires all of its properties', () => {
    const check = (node: Schema, path: string) => {
      if (node.properties) {
        expect(node.additionalProperties, `${path} additionalProperties`).toBe(false);
        expect([...(node.required ?? [])].sort(), `${path} required`).toEqual(Object.keys(node.properties).sort());
        for (const [key, child] of Object.entries(node.properties)) check(child, `${path}.${key}`);
      }
      if (node.items) check(node.items, `${path}[]`);
    };
    check(STONE_READING_SCHEMA as unknown as Schema, 'root');
  });
});

describe('Stone Reading To Form Tests', () => {
  it('fills the form from a clear reading', () => {
    const extraction = stoneReadingToExtraction(yusuf);
    expect(extraction).toMatchObject({
      firstName: 'Yusuf',
      middleNames: [],
      surname: 'Kamish',
      nickname: '',
      fullName: 'Yusuf Kamish',
      graveNumber: '',
      birthDate: '1952-02-02',
      deathDate: '2018-06-16',
      rawOcrText: yusuf.transcript,
      fieldConfidences: { graveNumber: 0, fullName: 0.9, dates: 0.95 },
      otherText: ['786 at the top stands for Bismillah'],
    });
    expect(extraction.confidence).toBeCloseTo((0 + 0.9 + 0.95) / 3, 5);
  });

  it('trims names, keeps a nickname and drops blank middle names', () => {
    const extraction = stoneReadingToExtraction({
      ...yusuf,
      firstName: '  Abdul ',
      middleNames: ['Wahab', '  ', ' Hassan '],
      surname: ' Narker',
      nickname: ' Boeta Dul ',
      graveNumber: ' 1402 ',
    });
    expect(extraction).toMatchObject({
      firstName: 'Abdul',
      middleNames: ['Wahab', 'Hassan'],
      surname: 'Narker',
      nickname: 'Boeta Dul',
      fullName: 'Abdul Wahab Hassan Narker',
      graveNumber: '1402',
    });
  });

  it('only keeps real calendar dates in the date fields', () => {
    const extraction = stoneReadingToExtraction({ ...yusuf, birthDate: '1952-02-30', deathDate: '2018' });
    expect(extraction.birthDate).toBeUndefined();
    expect(extraction.deathDate).toBeUndefined();
    expect(extraction.fieldConfidences.dates).toBe(0);
  });

  it('keeps dates it could not convert, such as Hijri dates, as a note', () => {
    const extraction = stoneReadingToExtraction({
      ...yusuf,
      birthDate: null,
      deathDate: null,
      datesAsWritten: '12 Rajab 1438',
      notes: [],
    });
    expect(extraction.otherText).toEqual(['Dates as written: 12 Rajab 1438']);
  });

  it('keeps confidence between 0 and 1 and zero for fields it did not fill', () => {
    const extraction = stoneReadingToExtraction({
      ...yusuf,
      graveNumber: '1402',
      confidence: { name: 1.4, graveNumber: -2, dates: 0.5 },
    });
    expect(extraction.fieldConfidences).toEqual({ graveNumber: 0, fullName: 1, dates: 0.5 });

    const blank = stoneReadingToExtraction({ ...yusuf, firstName: null, surname: null, confidence: { name: 0.8, graveNumber: 0, dates: 0.95 } });
    expect(blank.fieldConfidences.fullName).toBe(0);
  });

  it('recognises a well-formed reading and rejects anything else', () => {
    expect(isStoneReading(yusuf)).toBe(true);
    expect(isStoneReading({ ...yusuf, middleNames: 'Wahab' })).toBe(false);
    expect(isStoneReading({ ...yusuf, confidence: { name: 1 } })).toBe(false);
    const { transcript: _transcript, ...missingTranscript } = yusuf;
    expect(isStoneReading(missingTranscript)).toBe(false);
    expect(isStoneReading(null)).toBe(false);
  });
});

describe('Read Stone Request Tests', () => {
  it('takes the sign-in token from a Bearer header', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('bearer abc.def')).toBe('abc.def');
    expect(bearerToken('Bearer ')).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it('accepts only a camera photo as a JPEG, PNG or WebP data URL within the size limit', () => {
    expect(parseStonePhoto({ image: PHOTO })).toEqual({ ok: true, dataUrl: PHOTO });
    expect(parseStonePhoto({ image: 'data:image/png;base64,iVBOR' }).ok).toBe(true);
    expect(parseStonePhoto(null)).toMatchObject({ ok: false });
    expect(parseStonePhoto({ image: 42 })).toMatchObject({ ok: false });
    expect(parseStonePhoto({ image: 'https://example.com/stone.jpg' })).toMatchObject({ ok: false });
    expect(parseStonePhoto({ image: 'data:image/gif;base64,R0lGOD' })).toMatchObject({ ok: false });
    expect(parseStonePhoto({ image: `data:image/jpeg;base64,${'A'.repeat(MAX_STONE_PHOTO_CHARS)}` })).toMatchObject({
      ok: false,
      error: 'The photo is too large.',
    });
  });
});

describe('Read Stone Photo Tests', () => {
  it('asks GPT-5.6 Luna for the strict reading schema with the photo', async () => {
    const { client, create } = fakeClient(responseWithText(JSON.stringify(yusuf)));
    await expect(readStonePhoto(client, PHOTO)).resolves.toEqual(yusuf);

    const params = create.mock.calls[0][0] as {
      model: string;
      reasoning: { effort: string };
      text: { format: { type: string; name: string; strict: boolean; schema: unknown } };
      input: Array<{ role: string; content: unknown }>;
    };
    expect(params.model).toBe('gpt-5.6-luna');
    expect(params.reasoning).toEqual({ effort: 'low' });
    expect(params.text.format).toMatchObject({ type: 'json_schema', name: 'stone_reading', strict: true, schema: STONE_READING_SCHEMA });
    expect(JSON.stringify(params.input)).toContain('"type":"input_image"');
    expect(JSON.stringify(params.input)).toContain(PHOTO);
  });

  it('reports a refusal', async () => {
    const { client } = fakeClient({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: "I can't help with that." }] }],
      output_text: '',
    });
    await expect(readStonePhoto(client, PHOTO)).rejects.toMatchObject({ code: 'refused' });
  });

  it('reports an answer that was cut off', async () => {
    const { client } = fakeClient(responseWithText('{"hasGraveDetails": true, "firstNa', 'incomplete'));
    await expect(readStonePhoto(client, PHOTO)).rejects.toMatchObject({ code: 'incomplete' });
  });

  it('reports output that is not a reading', async () => {
    const notJson = fakeClient(responseWithText('Yusuf Kamish'));
    await expect(readStonePhoto(notJson.client, PHOTO)).rejects.toBeInstanceOf(StoneReadingError);
    await expect(readStonePhoto(notJson.client, PHOTO)).rejects.toMatchObject({ code: 'invalid-output' });

    const wrongShape = fakeClient(responseWithText(JSON.stringify({ name: 'Yusuf Kamish' })));
    await expect(readStonePhoto(wrongShape.client, PHOTO)).rejects.toMatchObject({ code: 'invalid-output' });
  });
});

describe('Stone Photo Client Tests', () => {
  it('shrinks the long edge to 1600 px and keeps the shape', () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(scaledSize(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(scaledSize(1920, 1080)).toEqual({ width: 1600, height: 900 });
    expect(scaledSize(1200, 900)).toEqual({ width: 1200, height: 900 });
  });

  it('explains read failures in plain words', () => {
    expect(stoneReadingErrorMessage(0)).toBe("You're offline. Connect to the internet to read the photo, or enter the details manually.");
    expect(stoneReadingErrorMessage(401)).toBe('Your session has ended. Sign in again to read the photo.');
    expect(stoneReadingErrorMessage(429)).toBe('Too many photos are being read right now. Try again in a moment.');
    expect(stoneReadingErrorMessage(503)).toBe("Reading photos isn't set up yet. Enter the details manually.");
    expect(stoneReadingErrorMessage(422, 'No grave details were found in this photo.')).toBe(
      'No grave details were found in this photo.'
    );
    expect(stoneReadingErrorMessage(500)).toBe("The photo couldn't be read. Try again or enter the details manually.");
  });
});
