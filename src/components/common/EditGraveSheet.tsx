'use client';

import React, { useState } from 'react';
import { Calendar, Loader2, Pencil } from 'lucide-react';
import { Grave } from '@/types';
import { dataStore } from '@/lib/data/store';
import { GraveEditForm, graveEditFormFrom, hasGraveEditChanges, validateGraveEditForm } from '@/lib/graves/graveEditForm';
import { UPDATE_UNKNOWN_MESSAGE, UpdateGraveError } from '@/lib/graves/updateMappedGrave';

interface EditGraveSheetProps {
  grave: Grave;
  onClose: () => void;
  // Called with the grave as it reads after the edit
  onSaved: (updated: Grave) => void;
}

const labelClass = 'block text-[11px] font-semibold text-slate-500 mb-0.5';
const inputClass =
  'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-forest';
const errorClass = 'mt-0.5 text-[11px] text-rose-600';

// Lets the person who mapped a grave correct the details they typed on the Confirm screen. The position,
// photos and cemetery stay as they are.
export const EditGraveSheet: React.FC<EditGraveSheetProps> = ({ grave, onClose, onSaved }) => {
  const [form, setForm] = useState<GraveEditForm>(() => graveEditFormFrom(grave));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { valid, errors } = validateGraveEditForm(form);
  const changed = hasGraveEditChanges(form, grave);

  const update = (field: keyof GraveEditForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSaveError(null);
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || !changed || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      onSaved(await dataStore.updateGrave(grave, form));
    } catch (err) {
      setIsSaving(false);
      setSaveError(err instanceof UpdateGraveError ? err.message : UPDATE_UNKNOWN_MESSAGE);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
      <form
        onSubmit={handleSave}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-grave-title"
        className="bg-white rounded-3xl w-full max-w-sm p-5 space-y-3 shadow-2xl max-h-[90vh] overflow-y-auto animate-in fade-in slide-in-from-bottom duration-200"
      >
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-full bg-emerald-50 text-brand-forest flex items-center justify-center">
              <Pencil className="w-4 h-4" />
            </div>
            <div>
              <h3 id="edit-grave-title" className="font-bold text-sm text-slate-900">Edit details</h3>
              <p className="text-[11px] text-slate-500">Correct what is written on the stone</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving} aria-label="Close" className="text-xs font-semibold text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="editFirstName" className={labelClass}>First name</label>
            <input id="editFirstName" type="text" value={form.firstName} onChange={update('firstName')} className={inputClass} autoComplete="off" />
            {errors.firstName && <p className={errorClass}>{errors.firstName}</p>}
          </div>
          <div>
            <label htmlFor="editSurname" className={labelClass}>Surname</label>
            <input id="editSurname" type="text" value={form.surname} onChange={update('surname')} className={inputClass} autoComplete="off" />
            {errors.surname && <p className={errorClass}>{errors.surname}</p>}
          </div>
        </div>

        <div>
          <label htmlFor="editMiddleNames" className={labelClass}>Middle names</label>
          <input id="editMiddleNames" type="text" value={form.middleNames} onChange={update('middleNames')} className={inputClass} autoComplete="off" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="editNickname" className={labelClass}>Nickname</label>
            <input id="editNickname" type="text" value={form.nickname} onChange={update('nickname')} className={inputClass} autoComplete="off" />
          </div>
          <div>
            <label htmlFor="editGraveNumber" className={labelClass}>Grave number</label>
            <input id="editGraveNumber" type="text" value={form.graveNumber} onChange={update('graveNumber')} className={inputClass} autoComplete="off" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="editBirthDate" className={labelClass}>Date of birth</label>
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input id="editBirthDate" type="date" value={form.birthDate} onChange={update('birthDate')} className={`${inputClass} pl-9`} />
            </div>
          </div>
          <div>
            <label htmlFor="editDeathDate" className={labelClass}>Date of death</label>
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input id="editDeathDate" type="date" value={form.deathDate} onChange={update('deathDate')} className={`${inputClass} pl-9`} />
            </div>
          </div>
        </div>
        {errors.deathDate && <p className={errorClass}>{errors.deathDate}</p>}

        {saveError && (
          <div role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
            {saveError}
          </div>
        )}

        <div className="flex space-x-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!valid || !changed || isSaving}
            className="flex-1 py-2.5 rounded-xl bg-brand-forest text-white text-xs font-semibold flex items-center justify-center space-x-1.5 disabled:opacity-50"
          >
            {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{isSaving ? 'Saving…' : 'Save changes'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
