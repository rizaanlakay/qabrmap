'use client';

import React, { useState } from 'react';
import { CheckCircle2, Loader2, MapPin } from 'lucide-react';
import type { Grave } from '@/types';
import { canConfirmVisit, describeVisit, VISIT_FAILED_MESSAGE, VisitFix } from '@/lib/graves/visits';
import { SaveGraveError } from '@/lib/supabase/saveGraveErrors';

interface VisitConfirmButtonProps {
  grave: Grave;
  fix: VisitFix | null;
  onConfirm: (grave: Grave, fix: VisitFix) => Promise<Grave>;
  // light: on a white sheet. dark: over the camera.
  tone?: 'light' | 'dark';
}

type VisitState =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'saving' }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

// "I found it": records the visitor's fix as an observation so the grave's position improves with every visit.
// The fix is wherever the phone is, so the person is asked to stand at the stone itself before it is recorded.
export const VisitConfirmButton: React.FC<VisitConfirmButtonProps> = ({ grave, fix, onConfirm, tone = 'light' }) => {
  const [state, setState] = useState<VisitState>({ kind: 'idle' });
  const dark = tone === 'dark';
  const usable = canConfirmVisit(fix);

  const record = async () => {
    if (!fix || state.kind === 'saving') return;
    setState({ kind: 'saving' });
    try {
      const updated = await onConfirm(grave, fix);
      setState({ kind: 'done', message: describeVisit(updated) });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof SaveGraveError ? err.message : VISIT_FAILED_MESSAGE });
    }
  };

  if (state.kind === 'done') {
    return (
      <div className={`mt-2 flex items-start text-[11px] font-semibold ${dark ? 'text-emerald-200' : 'text-emerald-800'}`} role="status">
        <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 mt-px shrink-0" />
        <span>{state.message}</span>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <button
        onClick={() => setState({ kind: 'asking' })}
        disabled={state.kind === 'saving'}
        className={`w-full rounded-xl py-2.5 px-4 text-xs font-bold flex items-center justify-center space-x-2 active:scale-[0.99] transition-all disabled:opacity-50 ${
          dark ? 'bg-emerald-500 text-white' : 'bg-emerald-600 text-white'
        }`}
      >
        {state.kind === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        <span>{state.kind === 'saving' ? 'Saving…' : 'I found it'}</span>
      </button>
      {state.kind === 'error' && (
        <p className={`mt-1.5 text-[11px] font-semibold ${dark ? 'text-rose-200' : 'text-rose-700'}`} role="alert">
          {state.message}
        </p>
      )}

      {state.kind === 'asking' && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="visit-confirm-title"
        >
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto">
              <MapPin className="w-6 h-6 text-emerald-600" />
            </div>
            <h2 id="visit-confirm-title" className="mt-3 text-base font-bold text-slate-900 text-center">
              Stand at the gravestone
            </h2>
            <p className="mt-2 text-xs text-slate-600 text-center leading-relaxed">
              Your phone&apos;s position is saved as the grave&apos;s position. Walk right up to the stone, hold the phone
              still for a moment, then tap Here.
            </p>
            <p className="mt-2 text-[11px] font-semibold text-center text-slate-500" aria-live="polite">
              {fix ? `GPS ± ${Math.round(fix.accuracy)} m` : 'Waiting for a GPS fix…'}
              {fix && !usable ? ', needs 25 m or better' : ''}
            </p>
            <div className="mt-4 flex space-x-2">
              <button
                onClick={() => setState({ kind: 'idle' })}
                className="flex-1 rounded-xl py-2.5 px-4 text-xs font-bold bg-slate-100 text-slate-700 active:scale-[0.99] transition-all"
              >
                Not yet
              </button>
              <button
                onClick={record}
                disabled={!usable}
                className="flex-1 rounded-xl py-2.5 px-4 text-xs font-bold bg-emerald-600 text-white flex items-center justify-center space-x-1.5 active:scale-[0.99] transition-all disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Here</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
