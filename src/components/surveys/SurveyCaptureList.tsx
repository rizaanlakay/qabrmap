'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { ChevronRight } from 'lucide-react';
import { SurveyCapture } from '@/types';
import { CaptureFilter, canRetry, captureStatusLabel, matchesFilter } from '@/lib/surveys/queueRules';

export type OpenGraveResult = 'opened' | 'removed' | 'offline';

interface SurveyCaptureListProps {
  captures: SurveyCapture[];
  onReview: (capture: SurveyCapture) => void;
  onOpenGrave: (graveId: string) => Promise<OpenGraveResult>;
  onRetry: (capture: SurveyCapture) => void;
  onDiscard: (capture: SurveyCapture) => void;
}

const FILTERS: Array<{ id: CaptureFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'review', label: 'Needs review' },
  { id: 'pending', label: 'Pending' },
  { id: 'saved', label: 'Saved' },
];

const STATUS_COLOURS: Record<SurveyCapture['status'], string> = {
  queued: 'text-slate-500',
  reading: 'text-blue-600',
  saving: 'text-blue-600',
  review: 'text-amber-700',
  saved: 'text-emerald-700',
  failed: 'text-rose-700',
};

const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const SurveyCaptureList: React.FC<SurveyCaptureListProps> = ({ captures, onReview, onOpenGrave, onRetry, onDiscard }) => {
  const [filter, setFilter] = useState<CaptureFilter>('all');
  // Saved graves that were deleted since, or couldn't be opened without signal
  const [notices, setNotices] = useState<Record<string, string>>({});

  const shown = captures.filter((capture) => matchesFilter(capture, filter));

  const open = async (capture: SurveyCapture) => {
    if (capture.status === 'review' || capture.status === 'failed') {
      onReview(capture);
      return;
    }
    if (capture.status !== 'saved' || !capture.graveId) return;
    const result = await onOpenGrave(capture.graveId);
    if (result === 'opened') return;
    setNotices((prev) => ({ ...prev, [capture.id]: result === 'removed' ? 'Grave removed' : 'Connect to open this grave' }));
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-center gap-2 mt-1 mb-3">
        {FILTERS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
              filter === tab.id ? 'bg-brand-forest text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-center text-xs text-slate-500 py-6">
          {captures.length === 0 ? 'No photos yet. Tap Continue surveying to start.' : 'Nothing here right now.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((capture) => {
            const tappable = capture.status === 'review' || capture.status === 'failed' || capture.status === 'saved';
            const name = capture.reading?.fullName || captureStatusLabel(capture);
            return (
              <li key={capture.id} className="bg-white rounded-xl border border-slate-200/80 shadow-sm">
                <button
                  onClick={() => open(capture)}
                  disabled={!tappable}
                  className="w-full p-3 flex items-center justify-between text-left disabled:cursor-default"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="w-11 h-11 rounded-lg overflow-hidden relative bg-slate-100 shrink-0 border border-slate-200">
                      <Image src={capture.thumbnail} alt="" fill className="object-cover" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">{name}</div>
                      <div className={`text-[10px] font-semibold mt-0.5 ${STATUS_COLOURS[capture.status]}`}>
                        {notices[capture.id] ?? captureStatusLabel(capture)}
                      </div>
                      {capture.status === 'failed' && capture.lastError && (
                        <div className="text-[10px] text-slate-500 truncate">{capture.lastError}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center shrink-0 pl-2">
                    <span className="text-xs text-slate-400 font-mono font-medium">{formatTime(capture.createdAt)}</span>
                    {tappable && <ChevronRight className="w-4 h-4 text-slate-400 ml-1" />}
                  </div>
                </button>
                {capture.status === 'failed' && (
                  <div className="flex border-t border-slate-100 divide-x divide-slate-100">
                    {canRetry(capture) && (
                      <button onClick={() => onRetry(capture)} className="flex-1 py-2 text-xs font-semibold text-brand-forest">
                        Retry
                      </button>
                    )}
                    <button onClick={() => onDiscard(capture)} className="flex-1 py-2 text-xs font-semibold text-rose-700">
                      Discard
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
