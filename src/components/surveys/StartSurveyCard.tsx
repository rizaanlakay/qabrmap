'use client';

import React, { useEffect, useState } from 'react';
import { ClipboardList, Loader2, MapPin } from 'lucide-react';
import { Cemetery } from '@/types';
import { findCemeteryForLocation } from '@/lib/capture/cemeteryForLocation';

interface StartSurveyCardProps {
  cemeteries: Cemetery[];
  onStart: (cemetery: Cemetery, sectionNote: string) => Promise<void>;
}

const labelClass = 'block text-[11px] font-semibold text-slate-500 mb-0.5';
const inputClass =
  'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-forest';

export const StartSurveyCard: React.FC<StartSurveyCardProps> = ({ cemeteries, onStart }) => {
  const [cemeteryId, setCemeteryId] = useState('');
  const [sectionNote, setSectionNote] = useState('');
  const [detected, setDetected] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preselects the cemetery the surveyor is standing in, without replacing a choice they already made
  useEffect(() => {
    if (!navigator.geolocation || cemeteries.length === 0) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const here = findCemeteryForLocation(cemeteries, pos.coords.latitude, pos.coords.longitude);
        if (!here) return;
        setCemeteryId((current) => current || here.id);
        setDetected(true);
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 }
    );
    return () => {
      cancelled = true;
    };
  }, [cemeteries]);

  const cemetery = cemeteries.find((c) => c.id === cemeteryId);

  const start = async () => {
    if (!cemetery || starting) return;
    setStarting(true);
    setError(null);
    try {
      await onStart(cemetery, sectionNote);
    } catch {
      setError("The survey couldn't be started on this phone. Check that the browser allows storage.");
      setStarting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm space-y-3">
      <div className="flex items-center space-x-2">
        <div className="w-9 h-9 rounded-xl bg-emerald-50 text-brand-forest flex items-center justify-center">
          <ClipboardList className="w-4 h-4" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-900">Start a survey</h2>
          <p className="text-[11px] text-slate-500">Photograph graves one after another. They are read and saved as signal allows.</p>
        </div>
      </div>

      <div>
        <label htmlFor="surveyCemetery" className={labelClass}>
          Cemetery
        </label>
        <select id="surveyCemetery" value={cemeteryId} onChange={(e) => setCemeteryId(e.target.value)} className={inputClass}>
          <option value="">Choose a cemetery</option>
          {cemeteries.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {detected && cemetery && (
          <p className="mt-1 flex items-center text-[11px] text-emerald-700">
            <MapPin className="w-3 h-3 mr-1" />
            You&apos;re at {cemetery.name}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="surveySection" className={labelClass}>
          Section or row (optional)
        </label>
        <input
          id="surveySection"
          type="text"
          value={sectionNote}
          onChange={(e) => setSectionNote(e.target.value)}
          placeholder="For example Row 12"
          className={inputClass}
        />
      </div>

      {error && (
        <p role="alert" className="text-[11px] font-semibold text-rose-700">
          {error}
        </p>
      )}

      <button
        onClick={start}
        disabled={!cemetery || starting}
        className="w-full py-3 px-4 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold shadow-md transition-all active:scale-[0.99] flex items-center justify-center space-x-2 disabled:opacity-50"
      >
        {starting && <Loader2 className="w-4 h-4 animate-spin" />}
        <span>{cemetery ? 'Start survey' : 'Choose a cemetery'}</span>
      </button>
    </div>
  );
};
