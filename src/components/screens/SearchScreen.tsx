'use client';

import React, { useState, useEffect } from 'react';
import { ArrowLeft, Search as SearchIcon, X, ChevronRight, Heart } from 'lucide-react';
import { Grave } from '@/types';
import { GraveImage } from '@/components/common/GraveImage';
import { dataStore } from '@/lib/data/store';

interface SearchScreenProps {
  initialQuery?: string;
  onSelectGrave: (grave: Grave) => void;
  onBack: () => void;
}

export const SearchScreen: React.FC<SearchScreenProps> = ({
  initialQuery = '',
  onSelectGrave,
  onBack,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [filterType, setFilterType] = useState<'all' | 'saved' | 'names' | 'numbers'>('all');
  const [results, setResults] = useState<Grave[]>([]);

  useEffect(() => {
    let isMounted = true;
    dataStore.searchGraves(query, filterType).then((res) => {
      if (isMounted) setResults(res);
    });
    return () => {
      isMounted = false;
    };
  }, [query, filterType]);

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden">
      {/* Top Header */}
      <div className="px-4 py-3 bg-white border-b border-slate-200/80 flex items-center shrink-0">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-colors mr-2"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">Search Graves</h1>
      </div>

      {/* Search Input Bar */}
      <div className="p-4 bg-white border-b border-slate-100 shrink-0">
        <div className="relative">
          <SearchIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search deceased name or grave number"
            className="w-full pl-10 pr-10 py-2.5 bg-slate-100 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-forest/20 focus:bg-white transition-all"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filter Chips matching Mockup Screen 4 */}
        <div className="flex items-center space-x-2 mt-3 overflow-x-auto pb-0.5">
          {[
            { id: 'all', label: 'All' },
            { id: 'saved', label: 'Loved Ones' },
            { id: 'names', label: 'Names' },
            { id: 'numbers', label: 'Grave Numbers' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id as 'all' | 'saved' | 'names' | 'numbers')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex items-center space-x-1 ${
                filterType === tab.id
                  ? 'bg-brand-forest text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
              }`}
            >
              {tab.id === 'saved' && (
                <Heart className={`w-3.5 h-3.5 mr-1 ${filterType === tab.id ? 'fill-white text-white' : 'text-rose-500 fill-rose-500'}`} />
              )}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Results List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {results.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">
            {filterType === 'saved'
              ? 'No marked loved ones yet. Open any grave and tap "Mark Relationship".'
              : 'No matching graves found.'}
          </div>
        ) : (
          results.map((grave) => {
            const rel = grave.relationship || dataStore.getGraveRelationship(grave.id);

            return (
              <div
                key={grave.id}
                onClick={() => onSelectGrave(grave)}
                className="w-full bg-white rounded-2xl p-3 border border-slate-200/80 shadow-sm hover:shadow transition-all cursor-pointer flex items-center active:scale-[0.99]"
              >
                {/* Gravestone Thumbnail */}
                <div className="w-14 h-16 rounded-xl overflow-hidden relative shrink-0 bg-slate-100 mr-3.5 border border-slate-200/60">
                  <GraveImage grave={grave} alt={grave.person?.fullName || 'Gravestone'} />
                </div>

                {/* Deceased Info */}
                <div className="flex-1 min-w-0 pr-2">
                  <div className="flex items-center space-x-2">
                    <h2 className="text-sm font-bold text-slate-900 truncate">
                      {grave.person?.fullName || `Grave ${grave.graveNumber}`}
                    </h2>
                  </div>

                  {grave.person?.birthDate && grave.person?.deathDate && (
                    <p className="text-xs text-slate-500 font-medium mt-0.5">
                      {grave.person.birthDate.split('-')[0]} - {grave.person.deathDate.split('-')[0]}
                    </p>
                  )}

                  <div className="flex items-center text-[11px] text-slate-600 mt-1">
                    <span className="font-semibold text-brand-dark">Grave {grave.graveNumber}</span>
                    <span className="mx-1.5 text-slate-300">•</span>
                    <span className="truncate">{grave.cemeteryName || 'Athlone Muslim Cemetery'}</span>
                  </div>

                  {rel && (
                    <div className="mt-1.5 flex items-center space-x-1 text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full w-fit border border-rose-200/60">
                      <Heart className="w-3 h-3 fill-rose-500 text-rose-500" />
                      <span className="capitalize">{rel.category}: {rel.specificRelation}</span>
                    </div>
                  )}
                </div>

                {/* Chevron */}
                <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
