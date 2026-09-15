'use client';

import React from 'react';
import { Users } from 'lucide-react';
import { MatchCandidate, describeMatchCandidate, matchHeading } from '@/lib/graves/matchCandidate';

interface DuplicateMatchCardProps {
  candidate: MatchCandidate;
  busy: boolean;
  onAddPhoto: () => void;
  onDifferentPerson: () => void;
}

// Shown when the person being saved may already be mapped, so one grave isn't mapped twice
export const DuplicateMatchCard = React.forwardRef<HTMLDivElement, DuplicateMatchCardProps>(
  ({ candidate, busy, onAddPhoto, onDifferentPerson }, ref) => (
    <div ref={ref} role="status" className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2.5">
      <div className="flex items-start">
        <Users className="w-4 h-4 mr-2 mt-0.5 shrink-0 text-amber-700" />
        <p className="text-xs text-amber-900 leading-relaxed">
          <span className="font-bold">{matchHeading(candidate)}:</span> {describeMatchCandidate(candidate)}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2">
        <button
          onClick={onAddPhoto}
          disabled={busy}
          className="w-full py-2.5 px-3 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold transition-colors disabled:opacity-50"
        >
          Add my photo to this grave
        </button>
        <button
          onClick={onDifferentPerson}
          disabled={busy}
          className="w-full py-2.5 px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          It&apos;s a different person
        </button>
      </div>
    </div>
  )
);

DuplicateMatchCard.displayName = 'DuplicateMatchCard';
