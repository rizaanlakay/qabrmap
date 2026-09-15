import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readStonePhoto } from '@/lib/ai/readStone';
import { handleReadStone } from '@/lib/ai/readStoneRequest';

// Reads a grave marker photo with GPT-5.6 Luna. Signed-in users only, within the limits the database keeps,
// because every call is paid for.
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Acts as the signed-in user, so the database functions know whose reads to count
  let client: SupabaseClient | null = null;
  const clientFor = (token: string): SupabaseClient =>
    (client ??= createClient(supabaseUrl as string, supabaseAnonKey as string, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }));

  const result = await handleReadStone(request.headers.get('authorization'), {
    isConfigured: Boolean(supabaseUrl && supabaseAnonKey && process.env.OPENAI_API_KEY),
    readBody: () => request.json().catch(() => null),
    getUserId: async (token) => {
      const { data, error } = await clientFor(token).auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },
    beginRead: async (token, hash) => {
      const { data, error } = await clientFor(token).rpc('begin_photo_read', { p_photo_hash: hash });
      return { data, error };
    },
    finishRead: async (token, readId, reading) => {
      const { error } = await clientFor(token).rpc('finish_photo_read', { p_read_id: readId, p_reading: reading });
      if (error) throw error;
    },
    readPhoto: (dataUrl) => readStonePhoto(new OpenAI(), dataUrl),
    isRateLimitError: (err) => err instanceof OpenAI.RateLimitError,
    logError: (message, err) => console.error(message, err),
  });

  return NextResponse.json(result.body, { status: result.status });
}
