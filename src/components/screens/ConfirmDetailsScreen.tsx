'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { ArrowLeft, Calendar, CheckCircle2 } from 'lucide-react';
import { AIStructuredExtraction, DeviceTelemetry, Grave } from '@/types';

interface ConfirmDetailsScreenProps {
  initialData: AIStructuredExtraction;
  capturedImage: string;
  telemetry: DeviceTelemetry;
  cemeteryId?: string;
  onSaveGrave: (grave: Grave) => void;
  onBack: () => void;
}

export const ConfirmDetailsScreen: React.FC<ConfirmDetailsScreenProps> = ({
  initialData,
  capturedImage,
  telemetry,
  cemeteryId = 'cem_athlone',
  onSaveGrave,
  onBack,
}) => {
  // Blank when the stone couldn't be read, so nobody saves a grave under another person's details
  const [graveNumber, setGraveNumber] = useState(initialData.graveNumber || '');
  const [firstName, setFirstName] = useState(initialData.firstName || '');
  const [middleNames, setMiddleNames] = useState(initialData.middleNames?.join(' ') || '');
  const [surname, setSurname] = useState(initialData.surname || '');
  const [birthDate, setBirthDate] = useState(initialData.birthDate || '');
  const [deathDate, setDeathDate] = useState(initialData.deathDate || '');
  const [isEditing, setIsEditing] = useState(false);

  const confidencePercent = Math.round((initialData.confidence ?? 0) * 100);

  const handleConfirm = () => {
    const fullName = [firstName, middleNames, surname].filter(Boolean).join(' ');
    const newGrave: Grave = {
      id: `grave_${Date.now()}`,
      cemeteryId,
      cemeteryName: 'Athlone Muslim Cemetery',
      sectionId: 'sec_b',
      sectionName: 'Section B',
      graveNumber,
      latitude: telemetry.latitude,
      longitude: telemetry.longitude,
      positionAccuracyMeters: telemetry.gpsAccuracy,
      positionConfidence: telemetry.gpsAccuracy <= 3.5 ? 'HIGH' : 'MEDIUM',
      status: 'MAPPED',
      primaryPhotoUrl: capturedImage || '/sample-gravestone.svg',
      photoCount: 1,
      lastVerifiedAt: '12 September 2026',
      person: {
        id: `person_${Date.now()}`,
        firstName,
        middleNames,
        surname,
        fullName,
        birthDate,
        deathDate,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onSaveGrave(newGrave);
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden justify-between">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-slate-200/80 flex items-center shrink-0">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-colors mr-2"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">Confirm Details</h1>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <p className="text-xs text-slate-500">
          We found the following information. Please check and edit if needed.
        </p>

        {/* Thumbnail Preview and Form Layout matching Mockup Screen 10 */}
        <div className="flex space-x-3 items-start">
          {/* Gravestone Thumbnail on left */}
          <div className="w-20 h-28 rounded-xl overflow-hidden relative shrink-0 bg-slate-800 border border-slate-300 shadow-sm">
            <Image
              src={capturedImage || '/sample-gravestone.svg'}
              alt="Gravestone crop"
              fill
              className="object-cover"
            />
          </div>

          {/* Form Fields Stack */}
          <div className="flex-1 space-y-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">
                Grave Number
              </label>
              <input
                type="text"
                value={graveNumber}
                onChange={(e) => setGraveNumber(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-forest"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">
                First Name
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-forest"
              />
            </div>
          </div>
        </div>

        {/* Remaining Form Fields */}
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">
              Middle Names
            </label>
            <input
              type="text"
              value={middleNames}
              onChange={(e) => setMiddleNames(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-forest"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">
              Surname
            </label>
            <input
              type="text"
              value={surname}
              onChange={(e) => setSurname(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-forest"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">
              Date of Birth
            </label>
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-forest"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">
              Date of Death
            </label>
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={deathDate}
                onChange={(e) => setDeathDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-forest"
              />
            </div>
          </div>

          {/* AI Confidence Indicator matching Screen 10 */}
          <div className="flex items-center justify-between py-2 px-1">
            <span className="text-xs font-semibold text-slate-600">AI Extraction Confidence</span>
            <div className="flex items-center space-x-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span className="text-xs font-bold text-slate-800">{confidencePercent}%</span>
            </div>
          </div>

          {/* Raw OCR Text & Multi-lingual Provenance Preservation */}
          <div className="mt-2 p-3 bg-slate-100 rounded-xl border border-slate-200 text-xs">
            <div className="flex items-center justify-between font-bold text-slate-700 text-[11px] mb-1.5">
              <span>Original OCR Text (Preserved)</span>
              <span className="text-emerald-700 font-medium">Tesseract Multi-Lingual</span>
            </div>
            <pre className="bg-white p-2 rounded-lg text-[11px] font-mono text-slate-700 whitespace-pre-wrap border border-slate-200/70 max-h-24 overflow-y-auto">
              {initialData.rawOcrText || 'No text could be read from this photo.'}
            </pre>
            <div className="grid grid-cols-3 gap-1 mt-2 text-[10px] text-slate-500 text-center">
              <div className="bg-white p-1 rounded border">
                No: <b>{Math.round((initialData.fieldConfidences?.graveNumber ?? 0) * 100)}%</b>
              </div>
              <div className="bg-white p-1 rounded border">
                Name: <b>{Math.round((initialData.fieldConfidences?.fullName ?? 0) * 100)}%</b>
              </div>
              <div className="bg-white p-1 rounded border">
                Dates: <b>{Math.round((initialData.fieldConfidences?.dates ?? 0) * 100)}%</b>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons matching Screen 10 */}
      <div className="p-4 bg-white border-t border-slate-200/80 flex space-x-3 shrink-0">
        <button
          onClick={() => setIsEditing(!isEditing)}
          className="flex-1 py-3 px-4 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
        >
          Edit Manually
        </button>
        <button
          onClick={handleConfirm}
          className="flex-1 py-3 px-4 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold shadow-md transition-all active:scale-[0.99]"
        >
          Confirm & Save
        </button>
      </div>
    </div>
  );
};
