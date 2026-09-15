'use client';

import React, { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
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

type VisitState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'done'; message: string } | { kind: 'error'; message: string };

// "I found it": records the visitor's fix as an observation so the grave's position improves with every visit
export const VisitConfirmButton: React.FC<VisitConfirmButtonProps> = ({ grave, fix, onConfirm, tone = 'light' }) => {
  const [state, setState] = useState<VisitState>({ kind: 'idle' });
  const dark = tone === 'dark';

  const confirm = async () => {
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

  const usable = canConfirmVisit(fix);
  return (
    <div className="mt-2">
      <button
        onClick={confirm}
        disabled={!usable || state.kind === 'saving'}
        title={usable ? undefined : 'Waiting for a GPS fix within 25 m'}
        className={`w-full rounded-xl py-2.5 px-4 text-xs font-bold flex items-center justify-center space-x-2 active:scale-[0.99] transition-all disabled:opacity-50 ${
          dark ? 'bg-emerald-500 text-white' : 'bg-emerald-600 text-white'
        }`}
      >
        {state.kind === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        <span>{state.kind === 'saving' ? 'Saving…' : 'I found it'}</span>
      </button>
      {!usable && (
        <p className={`mt-1.5 text-[11px] font-semibold ${dark ? 'text-white/70' : 'text-slate-500'}`}>Waiting for a GPS fix within 25 m</p>
      )}
      {state.kind === 'error' && (
        <p className={`mt-1.5 text-[11px] font-semibold ${dark ? 'text-rose-200' : 'text-rose-700'}`} role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
};
