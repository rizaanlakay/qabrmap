import type { AIStructuredExtraction } from '@/types';
import { supabase, isSupabaseConfigured } from '../supabase/client';
import { isStoneReading, stoneReadingToExtraction } from '../ai/stoneReading';
import { shrinkPhotoDataUrl } from './stonePhoto';

const DEFAULT_MESSAGE = "The photo couldn't be read. Try again or enter the details manually.";

// Status 0 means the request never reached the server
export function stoneReadingErrorMessage(status: number, serverMessage?: string): string {
  switch (status) {
    case 0:
      return "You're offline. Connect to the internet to read the photo, or enter the details manually.";
    case 401:
      return 'Your session has ended. Sign in again to read the photo.';
    case 429:
      // The server says whether the model is busy or this account has read too many photos
      return serverMessage || 'Too many photos are being read right now. Try again in a moment.';
    case 503:
      return "Reading photos isn't set up yet. Enter the details manually.";
    case 422:
      return serverMessage || DEFAULT_MESSAGE;
    default:
      return DEFAULT_MESSAGE;
  }
}

// Sends a captured photo to /api/graves/read-stone and returns the details for the Confirm screen
export async function requestStoneReading(photoDataUrl: string, signal?: AbortSignal): Promise<AIStructuredExtraction> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error(stoneReadingErrorMessage(0));

  const session = isSupabaseConfigured && supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session?.access_token) throw new Error(stoneReadingErrorMessage(401));

  const image = await shrinkPhotoDataUrl(photoDataUrl);

  let response: Response;
  try {
    response = await fetch('/api/graves/read-stone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ image }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error(stoneReadingErrorMessage(0));
  }

  const body = (await response.json().catch(() => null)) as { reading?: unknown; error?: unknown } | null;
  if (!response.ok) {
    throw new Error(stoneReadingErrorMessage(response.status, typeof body?.error === 'string' ? body.error : undefined));
  }
  if (!isStoneReading(body?.reading)) throw new Error(DEFAULT_MESSAGE);
  return stoneReadingToExtraction(body.reading);
}
