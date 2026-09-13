'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import {
  ArrowLeft,
  Share2,
  MoreVertical,
  Navigation,
  Camera,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ShieldCheck,
  Heart,
  Users,
} from 'lucide-react';
import { Grave, GraveRelationship, RelationshipCategory } from '@/types';
import { dataStore } from '@/lib/data/store';

interface GraveDetailsScreenProps {
  grave: Grave;
  onNavigateToGrave: (grave: Grave) => void;
  onAddPhoto: (grave: Grave) => void;
  onBack: () => void;
}

export const GraveDetailsScreen: React.FC<GraveDetailsScreenProps> = ({
  grave,
  onNavigateToGrave,
  onAddPhoto,
  onBack,
}) => {
  const [showProvenance, setShowProvenance] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportText, setReportText] = useState('');
  const [reportSubmitted, setReportSubmitted] = useState(false);

  // Relationship state
  const [currentRel, setCurrentRel] = useState<GraveRelationship | undefined>(
    grave.relationship || dataStore.getGraveRelationship(grave.id)
  );
  const [isSaved, setIsSaved] = useState(dataStore.isGraveSaved(grave.id));
  const [showRelModal, setShowRelModal] = useState(false);
  const [relCategory, setRelCategory] = useState<RelationshipCategory>(currentRel?.category || 'family');
  const [relSpecific, setRelSpecific] = useState(currentRel?.specificRelation || 'Father');
  const [relNotes, setRelNotes] = useState(currentRel?.notes || '');

  const provenanceLogs = dataStore.getProvenanceLogs(grave.id);

  // Format readable dates
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      const [y, m, d] = dateStr.split('-');
      const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
    } catch {
      return dateStr;
    }
  };

  const birthFormatted = formatDate(grave.person?.birthDate);
  const deathFormatted = formatDate(grave.person?.deathDate);

  const handleReportSubmit = () => {
    if (!reportText.trim()) return;
    dataStore.reportCorrection({
      graveId: grave.id,
      issueType: 'OTHER',
      description: reportText,
    });
    setReportSubmitted(true);
    setTimeout(() => {
      setShowReportModal(false);
      setReportSubmitted(false);
      setReportText('');
    }, 1500);
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-y-auto">
      {/* Top Floating Action Bar */}
      <div className="px-4 py-3 bg-white border-b border-slate-200/80 flex items-center justify-between sticky top-0 z-30">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>

        <div className="flex items-center space-x-1">
          {/* Heart button for My cemeteries */}
          <button
            onClick={() => {
              const newState = dataStore.toggleSavedGrave(grave.id);
              setIsSaved(newState);
              if (newState && !currentRel) {
                setShowRelModal(true);
              }
            }}
            className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors"
            aria-label="Save to My cemeteries"
            title={isSaved ? 'In My cemeteries' : 'Save to My cemeteries'}
          >
            <Heart className={`w-5 h-5 transition-transform active:scale-125 ${isSaved ? 'fill-rose-500 text-rose-500' : 'text-slate-600 hover:text-rose-500'}`} />
          </button>

          <button
            onClick={() => {
              if (navigator.share) {
                navigator.share({
                  title: `${grave.person?.fullName} - QabrMap`,
                  text: `Grave ${grave.graveNumber} at ${grave.cemeteryName}`,
                  url: window.location.href,
                });
              }
            }}
            className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-colors"
            aria-label="Share"
          >
            <Share2 className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowProvenance(!showProvenance)}
            className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-colors"
            aria-label="History"
            title="View Provenance"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Gravestone Photograph Hero */}
      <div className="w-full bg-slate-900 relative aspect-[4/3] max-h-72 overflow-hidden shadow-inner">
        <Image
          src={grave.primaryPhotoUrl || '/sample-gravestone.svg'}
          alt={grave.person?.fullName || 'Grave photo'}
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <div className="absolute bottom-3 left-4 text-white/90 text-[11px] font-medium bg-black/40 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/20">
          Photo 1 of {grave.photoCount}
        </div>
      </div>

      {/* Main Grave Details Card matching Mockup Screen 5 */}
      <div className="p-5 flex-1 flex flex-col justify-between">
        <div>
          {/* Deceased Name & Dates */}
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            {grave.person?.fullName || `Grave ${grave.graveNumber}`}
          </h1>
          {birthFormatted && deathFormatted && (
            <p className="text-xs text-slate-500 font-medium mt-1">
              {birthFormatted} — {deathFormatted}
            </p>
          )}

          {/* Relationship Connection Badge or Add Button */}
          <div className="mt-4">
            {currentRel ? (
              <div className="bg-rose-50/90 border border-rose-200/80 rounded-2xl p-3 flex items-center justify-between shadow-sm">
                <div className="flex items-center space-x-2.5">
                  <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                    <Heart className="w-5 h-5 fill-rose-500 text-rose-500" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-1.5">
                      <span className="text-xs font-bold text-rose-900 capitalize">{currentRel.category}:</span>
                      <span className="text-xs font-extrabold text-rose-700">{currentRel.specificRelation}</span>
                    </div>
                    {currentRel.notes && (
                      <p className="text-[11px] text-rose-800/80 italic mt-0.5 line-clamp-1">
                        &ldquo;{currentRel.notes}&rdquo;
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setShowRelModal(true)}
                  className="px-2.5 py-1 text-xs font-semibold text-rose-700 bg-white rounded-lg border border-rose-200 hover:bg-rose-100 transition-colors shrink-0"
                >
                  Edit
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowRelModal(true)}
                className="w-full bg-white hover:bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-3 flex items-center justify-between text-left group transition-all"
              >
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <Heart className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-800">Mark Relationship</span>
                    <p className="text-[11px] text-slate-500">Save as Family, Friend, Coworker...</p>
                  </div>
                </div>
                <span className="text-xs font-semibold text-brand-forest mr-1">+ Add</span>
              </button>
            )}
          </div>

          {/* Metadata Grid */}
          <div className="mt-4 bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm space-y-3.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Grave Number</span>
              <span className="font-bold text-slate-900 text-sm">{grave.graveNumber}</span>
            </div>

            <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
              <span className="text-slate-500 font-medium">Cemetery</span>
              <span className="font-semibold text-slate-800 text-right">
                {grave.cemeteryName || 'Athlone Muslim Cemetery'}
              </span>
            </div>

            <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
              <span className="text-slate-500 font-medium">Location Accuracy</span>
              <span className="flex items-center font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-[11px]">
                <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" />
                ± {grave.positionAccuracyMeters}m ({grave.positionConfidence === 'HIGH' ? 'High Confidence' : 'Medium'})
              </span>
            </div>

            <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
              <span className="text-slate-500 font-medium">Last Verified</span>
              <span className="font-medium text-slate-700">
                {grave.lastVerifiedAt || '12 September 2026'}
              </span>
            </div>

            <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
              <span className="text-slate-500 font-medium">Photos</span>
              <span className="font-semibold text-slate-800">{grave.photoCount}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 space-y-3 pb-2">
          {/* Primary Navigate Button */}
          <button
            onClick={() => onNavigateToGrave(grave)}
            className="w-full bg-brand-forest hover:bg-brand-dark text-white rounded-xl py-3.5 px-4 font-semibold text-sm flex items-center justify-center space-x-2 shadow-md transition-all active:scale-[0.99]"
          >
            <Navigation className="w-4 h-4 stroke-[2.5]" />
            <span>Navigate to Grave</span>
          </button>

          {/* Secondary Add Photo Button */}
          <button
            onClick={() => onAddPhoto(grave)}
            className="w-full bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl py-3 px-4 font-semibold text-sm flex items-center justify-center space-x-2 transition-all active:scale-[0.99]"
          >
            <Camera className="w-4 h-4 text-slate-500" />
            <span>Add a Photo</span>
          </button>

          {/* Provenance & Dispute Links */}
          <div className="pt-2 flex items-center justify-around text-xs text-slate-500">
            <button
              onClick={() => setShowReportModal(true)}
              className="hover:text-amber-700 flex items-center space-x-1 underline underline-offset-4"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Report incorrect info</span>
            </button>
            <span>•</span>
            <button
              onClick={() => setShowProvenance(!showProvenance)}
              className="hover:text-brand-forest flex items-center space-x-1 underline underline-offset-4"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Provenance audit log</span>
            </button>
          </div>
        </div>
      </div>

      {/* Provenance Drawer / Modal */}
      {showProvenance && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 max-h-[80vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-brand-forest" />
                <h3 className="font-bold text-sm text-slate-900">Provenance & Verification Log</h3>
              </div>
              <button
                onClick={() => setShowProvenance(false)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800"
              >
                Close
              </button>
            </div>
            <p className="text-xs text-slate-500">
              QabrMap retains a permanent historical audit trail for every spatial estimate and inscription field.
            </p>
            <div className="space-y-3">
              {provenanceLogs.map((log) => (
                <div key={log.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 text-xs">
                  <div className="flex items-center justify-between font-semibold text-slate-800">
                    <span>{log.action}</span>
                    <span className="text-emerald-700">{(log.confidence * 100).toFixed(0)}% Conf</span>
                  </div>
                  <div className="text-slate-500 text-[11px] mt-0.5">{log.contributor} • {log.timestamp}</div>
                  <div className="text-slate-600 mt-1 text-[11px] bg-white p-2 rounded border border-slate-100">
                    {log.details}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-3">
            <h3 className="font-bold text-sm text-slate-900">Report Correction for Grave {grave.graveNumber}</h3>
            <p className="text-xs text-slate-500">
              Describe any discrepancies in GPS position, deceased name, or gravestone condition.
            </p>
            <textarea
              value={reportText}
              onChange={(e) => setReportText(e.target.value)}
              placeholder="e.g. The surname has an alternate spelling, or the stone was restored..."
              rows={3}
              className="w-full p-2.5 text-xs bg-slate-100 rounded-xl border border-slate-200 focus:outline-none focus:bg-white"
            />
            {reportSubmitted && (
              <div className="text-xs text-emerald-700 font-semibold flex items-center">
                <CheckCircle2 className="w-4 h-4 mr-1 text-emerald-600" /> Report submitted for community review.
              </div>
            )}
            <div className="flex space-x-2 pt-2">
              <button
                onClick={() => setShowReportModal(false)}
                className="flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleReportSubmit}
                className="flex-1 py-2 text-xs font-semibold text-white bg-brand-forest rounded-xl"
              >
                Submit Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Relationship Picker Modal */}
      {showRelModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm p-5 space-y-4 shadow-2xl animate-in fade-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center">
                  <Heart className="w-4 h-4 fill-rose-500" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Mark Relationship</h3>
                  <p className="text-[11px] text-slate-500 truncate max-w-[200px]">
                    {grave.person?.fullName || `Grave ${grave.graveNumber}`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowRelModal(false)}
                className="text-xs font-semibold text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            {/* 1. Category Selection */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Category
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'family', label: 'Family', emoji: '👨‍👩‍👧' },
                  { id: 'friend', label: 'Friend', emoji: '🤝' },
                  { id: 'coworker', label: 'Coworker', emoji: '💼' },
                  { id: 'mentor', label: 'Mentor', emoji: '🎓' },
                  { id: 'other', label: 'Other', emoji: '🏷️' },
                ].map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      const newCat = cat.id as RelationshipCategory;
                      setRelCategory(newCat);
                      const options = RELATION_OPTIONS[newCat] || ['Other'];
                      setRelSpecific(options[0]);
                    }}
                    className={`py-2 px-2 rounded-xl text-xs font-semibold border transition-all flex items-center justify-center space-x-1 ${
                      relCategory === cat.id
                        ? 'border-brand-forest bg-emerald-50 text-brand-forest shadow-sm'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span>{cat.emoji}</span>
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Specific Relation Dropdown */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Specific Relation
              </label>
              <select
                value={relSpecific}
                onChange={(e) => setRelSpecific(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-forest/20 focus:bg-white"
              >
                {(RELATION_OPTIONS[relCategory] || []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            {/* 3. Personal Note */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Personal Memory / Note <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                type="text"
                value={relNotes}
                onChange={(e) => setRelNotes(e.target.value)}
                placeholder="e.g. Visited on Eid, Beloved uncle..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-forest/20 focus:bg-white"
              />
            </div>

            {/* Action Buttons */}
            <div className="pt-2 flex items-center space-x-2">
              {currentRel && (
                <button
                  type="button"
                  onClick={() => {
                    dataStore.removeGraveRelationship(grave.id);
                    setCurrentRel(undefined);
                    setIsSaved(dataStore.isGraveSaved(grave.id));
                    setShowRelModal(false);
                  }}
                  className="px-3 py-2.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold transition-colors"
                >
                  Remove
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const newRel: GraveRelationship = {
                    graveId: grave.id,
                    category: relCategory,
                    specificRelation: relSpecific,
                    notes: relNotes.trim() || undefined,
                    savedAt: new Date().toISOString(),
                  };
                  dataStore.saveGraveRelationship(newRel);
                  setCurrentRel(newRel);
                  setIsSaved(true);
                  setShowRelModal(false);
                }}
                className="flex-1 py-2.5 px-4 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold shadow-md transition-all active:scale-[0.99]"
              >
                Save Relationship
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const RELATION_OPTIONS: Record<RelationshipCategory, string[]> = {
  family: [
    'Father',
    'Mother',
    'Grandfather',
    'Grandmother',
    'Son',
    'Daughter',
    'Brother',
    'Sister',
    'Spouse (Husband)',
    'Spouse (Wife)',
    'Uncle',
    'Aunt',
    'Cousin',
    'Nephew / Niece',
    'Relative',
  ],
  friend: [
    'Close Friend',
    'Childhood Friend',
    'Family Friend',
    'Neighbor',
    'School Friend',
  ],
  coworker: [
    'Colleague',
    'Business Partner',
    'Coworker',
    'Team Member',
    'Manager',
  ],
  mentor: [
    'Teacher / Ustadh',
    'Sheikh / Imam',
    'Community Elder',
    'Mentor',
  ],
  other: ['Other Connection'],
};
