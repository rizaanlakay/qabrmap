'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';

// OAuth lands here with ?code=. The code must be exchanged in the browser, because the
// PKCE verifier and the resulting session both live in this browser's storage.
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.slice(1));

    const providerError = params.get('error_description') || hashParams.get('error_description');
    if (providerError) {
      setError(providerError);
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setError('Supabase is not configured');
      return;
    }

    // Only allow same-site relative paths as the post-login destination
    const next = params.get('next');
    const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

    // getSession waits for the client's startup, which exchanges the code in the URL
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError || !data.session) {
        setError(sessionError?.message || 'Could not complete sign in. Please try again.');
        return;
      }
      router.replace(destination);
    });
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-brand-dark px-6 text-white">
      {error ? (
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-bold">Sign in failed</h1>
          <p className="mt-2 text-sm text-emerald-100/80">{error}</p>
          <button
            onClick={() => router.replace('/')}
            className="mt-5 rounded-xl bg-emerald-400 px-5 py-2.5 text-sm font-bold text-brand-dark hover:bg-emerald-300"
          >
            Back to QabrMap
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
          <p className="mt-3 text-sm font-semibold">Signing you in...</p>
        </div>
      )}
    </main>
  );
}
