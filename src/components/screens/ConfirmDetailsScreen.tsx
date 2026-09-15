'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { AlertTriangle, ArrowLeft, Calendar, CheckCircle2, Loader2 } from 'lucide-react';
import { AIStructuredExtraction, Cemetery, DeviceTelemetry, Grave } from '@/types';
import { dataStore } from '@/lib/data/store';
import { findCemeteryForLocation } from '@/lib/capture/cemeteryForLocation';
import { NewGraveForm, validateNewGraveForm } from '@/lib/capture/newGrave';
import { SaveGraveError, UNKNOWN_SAVE_MESSAGE } from '@/lib/supabase/saveGraveErrors';
import { createSaveAttempt, MatchMode } from '@/lib/capture/saveMappedGrave';
import { MatchCandidate, MatchCheckParams, matchCheckParams } from '@/lib/graves/matchCandidate';
import { DuplicateMatchCard } from '@/components/common/DuplicateMatchCard';

interface ConfirmDetailsScreenProps {
  initialData: AIStructuredExtraction;
  capturedImage: string;
  telemetry: DeviceTelemetry;
  cemeteries: Cemetery[];
  onSaved: (grave: Grave, outcome: 'created' | 'added-photo') => void;
  onRequireSignIn: () => void;
  onBack: () => void;
}

const labelClass = 'block text-[11px] font-semibold text-slate-500 mb-0.5';
const inputClass =
  'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-forest';

// Typing must pause this long before the duplicate check runs
const MATCH_CHECK_DELAY_MS = 500;

export const ConfirmDetailsScreen: React.FC<ConfirmDetailsScreenProps> = ({
  initialData,
  capturedImage,
  telemetry,
  cemeteries,
  onSaved,
  onRequireSignIn,
  onBack,
}) => {
  const detectedCemetery = useMemo(
    () => findCemeteryForLocation(cemeteries, telemetry.latitude, telemetry.longitude),
    [cemeteries, telemetry.latitude, telemetry.longitude]
  );

  // Blank when the stone couldn't be read, so nobody saves a grave under another person's details
  const [form, setForm] = useState<NewGraveForm>(() => ({
    firstName: initialData.firstName || '',
    middleNames: initialData.middleNames?.join(' ') || '',
    surname: initialData.surname || '',
    nickname: initialData.nickname || '',
    graveNumber: initialData.graveNumber || '',
    birthDate: initialData.birthDate || '',
    deathDate: initialData.deathDate || '',
    cemeteryId: detectedCemetery?.id || '',
  }));
  // Kept across Save retries, so a retry after a lost response reuses the same photo and grave id
  const [attempt] = useState(createSaveAttempt);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A grave already mapped that may be this person
  const [candidate, setCandidate] = useState<MatchCandidate | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Cemeteries can finish loading after the screen opens
  useEffect(() => {
    if (detectedCemetery) {
      setForm((prev) => (prev.cemeteryId ? prev : { ...prev, cemeteryId: detectedCemetery.id }));
    }
  }, [detectedCemetery]);

  // Checks for the same person nearby when the screen opens and whenever the identifying details change
  const checkParams = matchCheckParams(form, telemetry);
  const checkKey = checkParams ? JSON.stringify(checkParams) : '';
  useEffect(() => {
    if (!checkKey) {
      setCandidate(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      dataStore.findMatchingGraves(JSON.parse(checkKey) as MatchCheckParams).then((matches) => {
        if (!cancelled) setCandidate(matches[0] ?? null);
      });
    }, MATCH_CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [checkKey]);

  const { valid, errors } = validateNewGraveForm(form);
  const selectedCemetery = cemeteries.find((cemetery) => cemetery.id === form.cemeteryId);
  const outsideSelectedBoundary = Boolean(selectedCemetery) && detectedCemetery?.id !== selectedCemetery?.id;
  const confidencePercent = Math.round((initialData.confidence ?? 0) * 100);

  const update =
    (field: keyof NewGraveForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const save = async (matchMode: MatchMode, addToGraveId?: string) => {
    if (!valid || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = await dataStore.saveNewGrave({
        form,
        cemeteryName: selectedCemetery?.name,
        photoDataUrl: capturedImage,
        telemetry,
        attempt,
        matchMode,
        addToGraveId,
      });
      if (result.outcome === 'match-found') {
        // For example someone saved this person moments ago. Nothing was created, so the user chooses.
        setCandidate(result.candidate);
        setIsSaving(false);
        window.setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
        return;
      }
      onSaved(result.grave, result.outcome);
    } catch (err) {
      setIsSaving(false);
      setError(err instanceof SaveGraveError ? err.message : UNKNOWN_SAVE_MESSAGE);
      if (err instanceof SaveGraveError && err.code === 'grave-missing') setCandidate(null);
      if (err instanceof SaveGraveError && err.code === 'signed-out') onRequireSignIn();
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden justify-between">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-slate-200/80 flex items-center shrink-0">
        <button
          onClick={onBack}
          disabled={isSaving}
          className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-colors mr-2 disabled:opacity-40"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">Confirm Details</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Same person already mapped nearby */}
        {candidate && (
          <DuplicateMatchCard
            ref={cardRef}
            candidate={candidate}
            busy={isSaving || !valid}
            onAddPhoto={() => save('ask', candidate.graveId)}
            onDifferentPerson={() => save('new')}
          />
        )}

        {/* Photo and what it is for */}
        <div className="flex space-x-3 items-start">
          <div className="w-20 h-28 rounded-xl overflow-hidden relative shrink-0 bg-slate-800 border border-slate-300 shadow-sm">
            <Image src={capturedImage} alt="Captured gravestone" fill className="object-cover" />
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Check the details below. If the stone has no readable details, the photo still records the grave&apos;s
            location and direction, so type the details in.
          </p>
        </div>

        {/* Cemetery */}
        <div>
          <label htmlFor="cemetery" className={labelClass}>
            Cemetery *
          </label>
          <select id="cemetery" value={form.cemeteryId} onChange={update('cemeteryId')} className={inputClass}>
            <option value="">Choose a cemetery</option>
            {cemeteries.map((cemetery) => (
              <option key={cemetery.id} value={cemetery.id}>
                {cemetery.name}
              </option>
            ))}
          </select>
          {!detectedCemetery && (
            <p className="mt-1 flex items-start text-[11px] text-amber-700">
              <AlertTriangle className="w-3.5 h-3.5 mr-1 shrink-0" />
              Your location isn&apos;t inside a cemetery we know. Choose the cemetery this grave is in.
            </p>
          )}
          {detectedCemetery && outsideSelectedBoundary && selectedCemetery && (
            <p className="mt-1 flex items-start text-[11px] text-amber-700">
              <AlertTriangle className="w-3.5 h-3.5 mr-1 shrink-0" />
              This location is outside {selectedCemetery.name}&apos;s boundary.
            </p>
          )}
        </div>

        {/* Person */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="firstName" className={labelClass}>
              First name *
            </label>
            <input id="firstName" type="text" value={form.firstName} onChange={update('firstName')} className={inputClass} />
          </div>
          <div>
            <label htmlFor="surname" className={labelClass}>
              Surname *
            </label>
            <input id="surname" type="text" value={form.surname} onChange={update('surname')} className={inputClass} />
          </div>
        </div>

        <div>
          <label htmlFor="middleNames" className={labelClass}>
            Middle names
          </label>
          <input id="middleNames" type="text" value={form.middleNames} onChange={update('middleNames')} className={inputClass} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="nickname" className={labelClass}>
              Nickname
            </label>
            <input id="nickname" type="text" value={form.nickname} onChange={update('nickname')} className={inputClass} />
          </div>
          <div>
            <label htmlFor="graveNumber" className={labelClass}>
              Grave number
            </label>
            <input id="graveNumber" type="text" value={form.graveNumber} onChange={update('graveNumber')} className={inputClass} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="birthDate" className={labelClass}>
              Date of birth
            </label>
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input id="birthDate" type="date" value={form.birthDate} onChange={update('birthDate')} className={`${inputClass} pl-9`} />
            </div>
          </div>
          <div>
            <label htmlFor="deathDate" className={labelClass}>
              Date of death
            </label>
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input id="deathDate" type="date" value={form.deathDate} onChange={update('deathDate')} className={`${inputClass} pl-9`} />
            </div>
          </div>
        </div>

        {/* AI Confidence Indicator matching Screen 10 */}
        <div className="flex items-center justify-between py-2 px-1">
          <span className="text-xs font-semibold text-slate-600">AI Extraction Confidence</span>
          <span className="text-xs font-bold text-slate-800">{confidencePercent}%</span>
        </div>

        {/* Raw OCR text, kept so the original reading can be checked */}
        <div className="p-3 bg-slate-100 rounded-xl border border-slate-200 text-xs">
          <div className="font-bold text-slate-700 text-[11px] mb-1.5">Text read from the photo</div>
          <pre className="bg-white p-2 rounded-lg text-[11px] font-mono text-slate-700 whitespace-pre-wrap border border-slate-200/70 max-h-24 overflow-y-auto">
            {initialData.rawOcrText || 'No text could be read from this photo.'}
          </pre>
          {initialData.otherText.length > 0 && (
            <ul className="mt-2 space-y-0.5 pl-4 list-disc text-[11px] text-slate-600">
              {initialData.otherText.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Save */}
      <div className="p-4 bg-white border-t border-slate-200/80 space-y-3 shrink-0">
        {error && (
          <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
            {error}
          </div>
        )}
        <button
          onClick={() => save('ask')}
          disabled={!valid || isSaving}
          className="w-full py-3 px-4 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold shadow-md transition-all active:scale-[0.99] flex items-center justify-center space-x-2 disabled:opacity-50 disabled:active:scale-100"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {/* The label names what's still missing, so there's no need for separate field errors */}
          <span>
            {isSaving
              ? 'Saving…'
              : errors.firstName || errors.surname
                ? 'Enter a first name and surname'
                : errors.cemeteryId
                  ? 'Choose a cemetery'
                  : 'Confirm & Save'}
          </span>
        </button>
      </div>
    </div>
  );
};
