'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { ArrowLeft, Camera, CheckCircle2, Loader2 } from 'lucide-react';
import { DeviceTelemetry, Grave, GravePhoto } from '@/types';
import { dataStore } from '@/lib/data/store';
import { graveNumberLabel } from '@/lib/ui/graveLabels';

interface AddPhotoConfirmScreenProps {
  grave: Grave;
  capturedImage: string;
  // The whole-grave shot taken after a low-accuracy capture, saved alongside the stone photo
  gravePhoto?: string;
  telemetry: DeviceTelemetry;
  onSaved: (photo: GravePhoto) => void;
  onRetake: () => void;
  onCancel: () => void;
}

// Confirms a new photo for a grave that is already mapped, instead of the new-grave details form
export const AddPhotoConfirmScreen: React.FC<AddPhotoConfirmScreenProps> = ({
  grave,
  capturedImage,
  gravePhoto,
  telemetry,
  onSaved,
  onRetake,
  onCancel,
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = grave.person?.fullName || `Grave ${grave.graveNumber}`;

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const photo = await dataStore.addGravePhoto(grave, capturedImage, telemetry);
      if (gravePhoto) {
        try {
          await dataStore.addGravePhoto(grave, gravePhoto, telemetry, 'grave');
        } catch (err) {
          // The stone photo is saved, so a failed whole-grave shot must not fail the save
          console.warn('The whole-grave photo could not be saved:', err);
        }
      }
      onSaved(photo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The photo could not be saved. Please try again.');
      setIsSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-slate-200/80 flex items-center shrink-0">
        <button
          onClick={onCancel}
          disabled={isSaving}
          className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-colors mr-2 disabled:opacity-40"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Add Photo</h1>
          <p className="text-xs text-slate-500 truncate">
            {[name, graveNumberLabel(grave)].filter(Boolean).join(' • ')}
          </p>
        </div>
      </div>

      {/* Preview */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-slate-900 border border-slate-200 shadow-sm">
          <Image src={capturedImage} alt={`New photo of ${name}`} fill className="object-cover" />
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          This photo will be added to {name}&apos;s grave and shown publicly with its details, so family and
          visitors can find it.
        </p>
        {error && (
          <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
            {error}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-4 bg-white border-t border-slate-200/80 flex space-x-3 shrink-0">
        <button
          onClick={onRetake}
          disabled={isSaving}
          className="flex-1 py-3 px-4 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors flex items-center justify-center space-x-2 disabled:opacity-40"
        >
          <Camera className="w-4 h-4" />
          <span>Retake</span>
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex-1 py-3 px-4 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold shadow-md transition-all active:scale-[0.99] flex items-center justify-center space-x-2 disabled:opacity-70"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          <span>{isSaving ? 'Saving…' : 'Save Photo'}</span>
        </button>
      </div>
    </div>
  );
};
