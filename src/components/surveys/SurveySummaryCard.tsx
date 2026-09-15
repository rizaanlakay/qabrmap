'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Camera, RotateCw } from 'lucide-react';
import { Survey, SurveyCounts } from '@/types';

interface SurveySummaryCardProps {
  survey: Survey;
  counts: SurveyCounts;
  statusLine: string | null;
  paused: boolean;
  storageWarning: boolean;
  onResume: () => void;
  // Only for the active survey
  onContinue?: () => void;
  onFinish?: () => void;
}

const formatStarted = (iso: string) =>
  new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const SurveySummaryCard: React.FC<SurveySummaryCardProps> = ({
  survey,
  counts,
  statusLine,
  paused,
  storageWarning,
  onResume,
  onContinue,
  onFinish,
}) => {
  // Finishing takes two taps, so a stray tap in the field doesn't end the survey
  const [confirmFinish, setConfirmFinish] = useState(false);
  useEffect(() => {
    if (!confirmFinish) return;
    const timer = window.setTimeout(() => setConfirmFinish(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmFinish]);

  const counters = [
    { label: 'Captured', value: counts.captured, className: 'text-slate-900' },
    { label: 'Saved', value: counts.saved, className: 'text-emerald-700' },
    { label: 'Pending', value: counts.pending, className: 'text-amber-600' },
    { label: 'Review', value: counts.review, className: 'text-rose-600' },
  ];

  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900 min-w-0 truncate">{survey.cemeteryName}</h2>
        <span
          className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full shrink-0 ${
            survey.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {survey.status === 'ACTIVE' ? 'Active' : 'Finished'}
        </span>
      </div>
      <p className="text-xs text-slate-500 font-medium mt-1">
        {survey.sectionNote ? `${survey.sectionNote} • ` : ''}Started {formatStarted(survey.startedAt)}
      </p>

      <div className="grid grid-cols-4 gap-2 mt-4 pt-3 border-t border-slate-100 text-center">
        {counters.map((counter) => (
          <div key={counter.label} className="bg-slate-50 rounded-xl p-2">
            <div className={`text-lg font-extrabold ${counter.className}`}>{counter.value}</div>
            <div className="text-[10px] text-slate-500 font-medium">{counter.label}</div>
          </div>
        ))}
      </div>

      {statusLine && (
        <div className="mt-3 flex items-center justify-between gap-2 text-xs font-medium text-slate-600" role="status">
          <span>{statusLine}</span>
          {paused && (
            <button onClick={onResume} className="shrink-0 flex items-center text-xs font-semibold text-brand-forest">
              <RotateCw className="w-3.5 h-3.5 mr-1" />
              Resume
            </button>
          )}
        </div>
      )}

      {storageWarning && survey.status === 'ACTIVE' && (
        <p className="mt-3 flex items-start text-[11px] text-amber-700">
          <AlertTriangle className="w-3.5 h-3.5 mr-1 shrink-0" />
          This phone may clear stored photos if it runs low on space. Stay online when you can.
        </p>
      )}

      {(onContinue || onFinish) && (
        <div className="mt-4 space-y-2">
          {onContinue && (
            <button
              onClick={onContinue}
              className="w-full bg-brand-forest hover:bg-brand-dark text-white rounded-xl py-3.5 px-4 font-semibold text-sm flex items-center justify-center space-x-2 shadow-md transition-all active:scale-[0.99]"
            >
              <Camera className="w-5 h-5 stroke-[2.2]" />
              <span>Continue surveying</span>
            </button>
          )}
          {onFinish && (
            <button
              onClick={() => (confirmFinish ? onFinish() : setConfirmFinish(true))}
              className="w-full py-2.5 px-4 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {confirmFinish ? 'Tap again to finish the survey' : 'Finish survey'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
