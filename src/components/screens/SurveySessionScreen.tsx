'use client';

import React from 'react';
import { GravestonePlaceholder } from '@/components/common/GravestonePlaceholder';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Clock,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { SurveySession } from '@/types';

interface SurveySessionScreenProps {
  session: SurveySession;
  onCaptureNextGrave: () => void;
  onBack: () => void;
}

export const SurveySessionScreen: React.FC<SurveySessionScreenProps> = ({
  session,
  onCaptureNextGrave,
  onBack,
}) => {
  const recentCaptures = [
    {
      id: 'cap_8660',
      graveNumber: '8660',
      status: 'Processed',
      statusType: 'complete',
      time: '14:31',
    },
    {
      id: 'cap_8661',
      graveNumber: '8661',
      status: 'Processing...',
      statusType: 'processing',
      time: '14:29',
    },
    {
      id: 'cap_8662',
      graveNumber: '8662',
      status: 'Queued (offline)',
      statusType: 'queued',
      time: '14:27',
    },
  ];

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-y-auto">
      {/* Top Header */}
      <div className="px-4 py-3 bg-white border-b border-slate-200/80 flex items-center shrink-0">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-colors mr-2"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">Survey Session</h1>
      </div>

      <div className="p-4 space-y-4 flex-1">
        {/* Cemetery & Section Card matching Mockup Screen 11 */}
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">{session.cemeteryName}</h2>
            <span className="bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2.5 py-0.5 rounded-full">
              Active
            </span>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-1">
            {session.sectionCode} • Started {session.startedAt}
          </p>

          {/* 4 Counter Grid: Captured, Processed, Pending, Review */}
          <div className="grid grid-cols-4 gap-2 mt-4 pt-3 border-t border-slate-100 text-center">
            <div className="bg-slate-50 rounded-xl p-2">
              <div className="text-lg font-extrabold text-slate-900">{session.capturedCount}</div>
              <div className="text-[10px] text-slate-500 font-medium">Captured</div>
            </div>

            <div className="bg-slate-50 rounded-xl p-2">
              <div className="text-lg font-extrabold text-emerald-700">{session.processedCount}</div>
              <div className="text-[10px] text-slate-500 font-medium">Processed</div>
            </div>

            <div className="bg-slate-50 rounded-xl p-2">
              <div className="text-lg font-extrabold text-amber-600">{session.pendingCount}</div>
              <div className="text-[10px] text-slate-500 font-medium">Pending</div>
            </div>

            <div className="bg-slate-50 rounded-xl p-2">
              <div className="text-lg font-extrabold text-slate-600">{session.reviewCount}</div>
              <div className="text-[10px] text-slate-500 font-medium">Review</div>
            </div>
          </div>
        </div>

        {/* Primary CTA: Capture Next Grave */}
        <button
          onClick={onCaptureNextGrave}
          className="w-full bg-brand-forest hover:bg-brand-dark text-white rounded-xl py-3.5 px-4 font-semibold text-sm flex items-center justify-center space-x-2 shadow-md transition-all active:scale-[0.99]"
        >
          <Camera className="w-5 h-5 stroke-[2.2]" />
          <span>Capture Next Grave</span>
        </button>

        {/* Recent Captures Section matching Screen 11 */}
        <div>
          <div className="flex items-center justify-between mb-2.5 px-1">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Recent Captures
            </h3>
            <button className="text-xs font-medium text-emerald-700 hover:text-emerald-800">
              View all
            </button>
          </div>

          <div className="space-y-2">
            {recentCaptures.map((cap) => (
              <div
                key={cap.id}
                className="bg-white rounded-xl p-3 border border-slate-200/80 flex items-center justify-between shadow-sm"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-11 h-11 rounded-lg overflow-hidden relative bg-slate-100 shrink-0 border border-slate-200">
                    <GravestonePlaceholder graveNumber={cap.graveNumber} className="absolute inset-0 w-full h-full" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      Grave {cap.graveNumber}
                    </div>
                    <div className="flex items-center space-x-1.5 mt-0.5">
                      {cap.statusType === 'complete' ? (
                        <span className="flex items-center text-[10px] font-semibold text-emerald-700">
                          Processed <CheckCircle2 className="w-3 h-3 ml-1 text-emerald-600" />
                        </span>
                      ) : cap.statusType === 'processing' ? (
                        <span className="flex items-center text-[10px] font-semibold text-blue-600">
                          Processing... <Loader2 className="w-3 h-3 ml-1 animate-spin" />
                        </span>
                      ) : (
                        <span className="flex items-center text-[10px] font-semibold text-slate-500">
                          Queued (offline) <Clock className="w-3 h-3 ml-1" />
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-slate-400 font-mono font-medium">
                  {cap.time}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
