import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { bearerToken, parseStonePhoto } from '@/lib/ai/stoneReading';
import { readStonePhoto, StoneReadingError } from '@/lib/ai/readStone';

// Reads a grave marker photo with GPT-5.6 Luna. Signed-in users only, because every call is paid for.
export const runtime = 'nodejs';
export const maxDuration = 60;

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  const token = bearerToken(request.headers.get('authorization'));
  if (!token) return jsonError(401, 'Sign in to read a photo.');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey || !process.env.OPENAI_API_KEY) {
    return jsonError(503, "Reading photos isn't set up yet.");
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return jsonError(401, 'Sign in to read a photo.');

  const photo = parseStonePhoto(await request.json().catch(() => null));
  if (!photo.ok) return jsonError(400, photo.error);

  try {
    const reading = await readStonePhoto(new OpenAI(), photo.dataUrl);
    if (!reading.hasGraveDetails) return jsonError(422, 'No grave details were found in this photo.');
    return NextResponse.json({ reading });
  } catch (err) {
    if (err instanceof StoneReadingError) return jsonError(422, err.message);
    if (err instanceof OpenAI.RateLimitError) return jsonError(429, 'Too many photos are being read right now.');
    console.error('Reading a grave photo failed:', err);
    return jsonError(502, "The photo couldn't be read.");
  }
}
