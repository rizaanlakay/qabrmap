'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import {
  ArrowLeft,
  Heart,
  Navigation,
  Search,
  ChevronRight,
  Plus,
  MapPin,
  Calendar,
} from 'lucide-react';
import { Grave } from '@/types';
import { dataStore, MyCemeteryGraveEntry } from '@/lib/data/store';

interface MyCemeteriesScreenProps {
  onSelectGrave: (grave: Grave) => void;
  onNavigateToGrave: (grave: Grave) => void;
  onFindGrave: () => void;
  onBack: () => void;
}

export const MyCemeteriesScreen: React.FC<MyCemeteriesScreenProps> = ({
  onSelectGrave,
  onNavigateToGrave,
  onFindGrave,
  onBack,
}) => {
  const [entries, setEntries] = useState<MyCemeteryGraveEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const loadData = async () => {
    setIsLoading(true);
    const data = await dataStore.getMyCemeteriesGraves();
    setEntries(data);
    setIsLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleToggleHeart = (e: React.MouseEvent, graveId: string) => {
    e.stopPropagation();
    dataStore.toggleSavedGrave(graveId);
    loadData();
  };

  // Format date readable (e.g. 14 May 2018 or 14-05-2018)
  const formatDOD = (dateStr?: string) => {
    if (!dateStr) return 'Not recorded';
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const [y, m, d] = parts;
        const months = [
          'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ];
        const monthName = months[parseInt(m, 10) - 1] || m;
        return `${parseInt(d, 10)} ${monthName} ${y}`;
      }
      return dateStr;
    } catch {
      return dateStr;
    }
  };

  const filteredEntries = entries.filter((entry) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    const nameMatch = entry.grave.person?.fullName?.toLowerCase().includes(q) ?? false;
    const surnameMatch = entry.grave.person?.surname?.toLowerCase().includes(q) ?? false;
    const relMatch = entry.relationship?.specificRelation?.toLowerCase().includes(q) ?? false;
    const cemMatch = entry.cemetery?.name?.toLowerCase().includes(q) ?? false;
    const numMatch = entry.grave.graveNumber?.toLowerCase().includes(q) ?? false;
    return nameMatch || surnameMatch || relMatch || cemMatch || numMatch;
  });

  // Group filtered entries by cemetery
  const groupedByCemetery = filteredEntries.reduce<Record<string, { cemeteryName: string; city: string; items: MyCemeteryGraveEntry[] }>>(
    (acc, entry) => {
      const cemId = entry.cemetery?.id || 'other';
      const cemName = entry.cemetery?.name || entry.grave.cemeteryName || 'Cemetery';
      const city = entry.cemetery?.city || 'Cape Town';

      if (!acc[cemId]) {
        acc[cemId] = {
          cemeteryName: cemName,
          city,
          items: [],
        };
      }
      acc[cemId].items.push(entry);
      return acc;
    },
    {}
  );

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden">
      {/* Top Bar Header */}
      <div className="px-4 py-3 bg-white border-b border-slate-200/80 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-colors"
            aria-label="Go Back"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">My cemeteries</h1>
            <p className="text-[11px] text-slate-500">Resting places of your loved ones</p>
          </div>
        </div>

        <button
          onClick={onFindGrave}
          className="flex items-center space-x-1 px-3 py-1.5 rounded-full bg-emerald-50 text-brand-forest hover:bg-emerald-100 text-xs font-semibold transition-colors"
          title="Find more loved ones"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add</span>
        </button>
      </div>

      {/* Search Filter if has entries */}
      {entries.length > 0 && (
        <div className="p-3 bg-white border-b border-slate-100 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, relation, or cemetery"
              className="w-full pl-10 pr-4 py-2 bg-slate-100/90 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-forest/20 focus:bg-white transition-all"
            />
          </div>
        </div>
      )}

      {/* Main List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {isLoading ? (
          <div className="text-center py-16 text-xs text-slate-400">Loading your saved graves...</div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 px-6">
            <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center mx-auto mb-3.5 shadow-sm">
              <Heart className="w-7 h-7 fill-rose-400 text-rose-500" />
            </div>
            <h2 className="text-base font-bold text-slate-900">No loved ones saved yet</h2>
            <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto leading-relaxed">
              Find graves of your family members or friends and mark them with a heart to keep their resting places organized here.
            </p>
            <button
              onClick={onFindGrave}
              className="mt-5 px-5 py-2.5 rounded-xl bg-brand-forest text-white text-xs font-semibold shadow-md hover:bg-brand-dark transition-all inline-flex items-center space-x-1.5"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Find a Loved One</span>
            </button>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="text-center py-12 text-xs text-slate-400">
            No saved graves matching &ldquo;{searchQuery}&rdquo;.
          </div>
        ) : (
          Object.entries(groupedByCemetery).map(([cemId, group]) => (
            <div key={cemId} className="space-y-2.5">
              {/* Cemetery Section Header */}
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center space-x-1.5">
                  <MapPin className="w-3.5 h-3.5 text-brand-forest" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-brand-dark">
                    {group.cemeteryName}
                  </h2>
                </div>
                <span className="text-[11px] text-slate-500 font-medium">
                  {group.items.length} {group.items.length === 1 ? 'grave' : 'graves'}
                </span>
              </div>

              {/* Graves List under this Cemetery */}
              <div className="space-y-3">
                {group.items.map((entry) => {
                  const grave = entry.grave;
                  const person = grave.person;
                  const fullName = person?.fullName || `${person?.firstName || ''} ${person?.surname || ''}`.trim() || `Grave ${grave.graveNumber}`;
                  const dod = formatDOD(person?.deathDate);
                  const relation = entry.relationship?.specificRelation || 'Family Member';
                  const category = entry.relationship?.category || 'family';

                  return (
                    <div
                      key={grave.id}
                      onClick={() => onSelectGrave(grave)}
                      className="w-full bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                    >
                      {/* Top Row: Photo + Name & Surname + Heart */}
                      <div className="flex items-start justify-between">
                        <div className="flex items-start space-x-3 min-w-0 flex-1">
                          {/* Photo Thumbnail */}
                          <div className="w-14 h-16 rounded-xl overflow-hidden relative shrink-0 bg-slate-100 border border-slate-200/60">
                            <Image
                              src={grave.primaryPhotoUrl || '/sample-gravestone.svg'}
                              alt={fullName}
                              fill
                              className="object-cover"
                            />
                          </div>

                          {/* Deceased Name and Surname & Details */}
                          <div className="min-w-0 flex-1 pr-2">
                            {/* Name and Surname */}
                            <h3 className="text-base font-bold text-slate-900 leading-tight group-hover:text-brand-forest transition-colors truncate">
                              {fullName}
                            </h3>

                            {/* DOD (Date of Death) */}
                            <div className="flex items-center space-x-1 text-xs text-slate-500 font-medium mt-1">
                              <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                              <span>DOD: <strong className="font-semibold text-slate-700">{dod}</strong></span>
                            </div>

                            {/* Relation below it */}
                            <div className="mt-1.5 flex items-center space-x-1.5">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200/60 text-[11px] font-bold">
                                <Heart className="w-3 h-3 fill-rose-500 text-rose-500 mr-1" />
                                {relation}
                              </span>
                              <span className="text-[11px] text-slate-400 capitalize">
                                ({category})
                              </span>
                            </div>

                            {/* Personal Note if present */}
                            {entry.relationship?.notes && (
                              <p className="text-[11px] text-slate-600 italic mt-1 line-clamp-1">
                                &ldquo;{entry.relationship.notes}&rdquo;
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Heart Button */}
                        <button
                          onClick={(e) => handleToggleHeart(e, grave.id)}
                          className="p-1.5 rounded-full hover:bg-rose-50 transition-colors shrink-0 text-rose-500"
                          title="Remove from My cemeteries"
                          aria-label="Remove from My cemeteries"
                        >
                          <Heart className="w-5 h-5 fill-rose-500 text-rose-500" />
                        </button>
                      </div>

                      {/* Bottom Action Footer: Grave Number + Navigate CTA */}
                      <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-slate-500">
                          Grave {grave.graveNumber} {grave.sectionName ? `• ${grave.sectionName}` : ''}
                        </span>

                        <div className="flex items-center space-x-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onNavigateToGrave(grave);
                            }}
                            className="inline-flex items-center space-x-1 px-3 py-1 rounded-lg bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold shadow-xs transition-colors"
                          >
                            <Navigation className="w-3 h-3 stroke-[2.2]" />
                            <span>Navigate</span>
                          </button>
                          <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
