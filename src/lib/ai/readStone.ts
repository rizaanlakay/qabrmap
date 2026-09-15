import type OpenAI from 'openai';
import {
  STONE_READING_INSTRUCTIONS,
  STONE_READING_MODEL,
  STONE_READING_SCHEMA,
  StoneReading,
  isStoneReading,
} from './stoneReading';

// Server only: sends a grave photo to GPT-5.6 Luna and returns the reading

export type ResponsesClient = Pick<OpenAI, 'responses'>;

export type StoneReadingErrorCode = 'refused' | 'incomplete' | 'invalid-output';

export class StoneReadingError extends Error {
  readonly code: StoneReadingErrorCode;

  constructor(code: StoneReadingErrorCode, message: string) {
    super(message);
    this.name = 'StoneReadingError';
    this.code = code;
  }
}

export async function readStonePhoto(client: ResponsesClient, imageDataUrl: string): Promise<StoneReading> {
  const response = await client.responses.create({
    model: STONE_READING_MODEL,
    // Reading a marker needs little reasoning; low keeps each photo quick and cheap
    reasoning: { effort: 'low' },
    max_output_tokens: 4000,
    input: [
      { role: 'system', content: STONE_READING_INSTRUCTIONS },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Read the grave details in this photo.' },
          { type: 'input_image', image_url: imageDataUrl, detail: 'auto' },
        ],
      },
    ],
    text: {
      format: { type: 'json_schema', name: 'stone_reading', schema: STONE_READING_SCHEMA, strict: true },
    },
  });

  const refused = response.output.some(
    (item) => item.type === 'message' && item.content.some((part) => part.type === 'refusal')
  );
  if (refused) throw new StoneReadingError('refused', "This photo couldn't be read.");
  if (response.status === 'incomplete') {
    throw new StoneReadingError('incomplete', 'Reading the photo was cut short. Try again.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.output_text);
  } catch {
    throw new StoneReadingError('invalid-output', "The photo couldn't be read.");
  }
  if (!isStoneReading(parsed)) throw new StoneReadingError('invalid-output', "The photo couldn't be read.");
  return parsed;
}
