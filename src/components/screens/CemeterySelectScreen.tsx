'use client';

import React, { useState } from 'react';
import { CemeteryThumbnail } from '@/components/common/CemeteryThumbnail';
import { ArrowLeft, Search, ChevronRight, Heart, LocateFixed } from 'lucide-react';
import { Cemetery } from '@/types';
import { formatGravesMapped } from '@/lib/data/cemeteryStats';
import { formatDistance, matchesCemeterySearch, nearestCemeteries, sortCemeteries } from '@/lib/cemeteries/nearby';
import { cemeteryTags } from '@/lib/cemeteries/tags';
import type { UserLocationStatus, UserPosition } from '@/lib/device/userLocation';

interface CemeterySelectScreenProps {
  cemeteries: Cemetery[];
  selectedCemetery: Cemetery | null;
  initialFilter?: 'nearby' | 'my-cemeteries' | 'recent' | 'all';
  locationStatus: UserLocationStatus;
  userPosition?: UserPosition;
  locationMessage?: string;
  onRetryLocation: () => void;
  isMyCemetery?: (id: string) => boolean;
  onToggleMyCemetery?: (id: string) => void;
  onSelectCemetery: (cemetery: Cemetery) => void;
  onBack: () => void;
}

export const CemeterySelectScreen: React.FC<CemeterySelectScreenProps> = ({
  cemeteries,
  selectedCemetery,
  initialFilter = 'nearby',
  locationStatus,
  userPosition,
  locationMessage,
  onRetryLocation,
  isMyCemetery = () => false,
  onToggleMyCemetery = () => {},
  onSelectCemetery,
  onBack,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'nearby' | 'my-cemeteries' | 'recent' | 'all'>(initialFilter);

  React.useEffect(() => {
    setActiveFilter(initialFilter);
  }, [initialFilter]);

  const searched = cemeteries.filter((c) => matchesCemeterySearch(c, searchQuery));

  // Nearby is the five closest and needs a position; the other chips list everything they cover,
  // closest first when the position is known and by name when it is not
  const filteredCemeteries: Cemetery[] = (() => {
    if (activeFilter === 'nearby') {
      return userPosition ? nearestCemeteries(searched, userPosition) : [];
    }
    const scoped = activeFilter === 'my-cemeteries' ? searched.filter((c) => isMyCemetery(c.id)) : searched;
    return sortCemeteries(scoped, userPosition);
  })();

  const nearbyNeedsLocation = activeFilter === 'nearby' && !userPosition;

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden">
      {/* Top Bar Header */}
      <div className="px-4 py-3 bg-white border-b border-slate-200/80 flex items-center shrink-0">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-colors mr-2"
          aria-label="Go Back"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">Select a Cemetery</h1>
      </div>

      {/* Search Input Bar */}
      <div className="p-4 bg-white border-b border-slate-100 shrink-0">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or location"
            className="w-full pl-10 pr-4 py-2.5 bg-slate-100/90 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-forest/20 focus:bg-white transition-all"
          />
        </div>

        {/* Filter Chips: Nearby, My cemeteries, Recent, All; centred, and wrapped onto a second line on narrow phones instead of scrolling */}
        <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
          {[
            { id: 'nearby', label: 'Nearby' },
            { id: 'my-cemeteries', label: 'My cemeteries' },
            { id: 'recent', label: 'Recent' },
            { id: 'all', label: 'All' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id as typeof activeFilter)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex items-center space-x-1 ${
                activeFilter === tab.id
                  ? 'bg-brand-forest text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
              }`}
            >
              {tab.id === 'my-cemeteries' && (
                <Heart className={`w-3.5 h-3.5 mr-1 ${activeFilter === tab.id ? 'fill-white text-white' : 'text-rose-500 fill-rose-500'}`} />
              )}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Cemetery List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {nearbyNeedsLocation ? (
          <div className="text-center py-12 px-6">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-brand-forest flex items-center justify-center mx-auto mb-3">
              <LocateFixed className={`w-6 h-6 ${locationStatus === 'locating' ? 'animate-pulse' : ''}`} />
            </div>
            {locationStatus === 'locating' || locationStatus === 'idle' ? (
              <h3 className="text-sm font-bold text-slate-800">Finding your location...</h3>
            ) : (
              <>
                <h3 className="text-sm font-bold text-slate-800">Location needed for nearby cemeteries</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto leading-relaxed">{locationMessage}</p>
                <div className="flex items-center justify-center gap-2 mt-4">
                  <button
                    onClick={onRetryLocation}
                    className="px-4 py-2 rounded-full bg-brand-forest text-white text-xs font-semibold"
                  >
                    Try again
                  </button>
                  <button
                    onClick={() => setActiveFilter('all')}
                    className="px-4 py-2 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold"
                  >
                    Show all
                  </button>
                </div>
              </>
            )}
          </div>
        ) : filteredCemeteries.length === 0 ? (
          <div className="text-center py-12 px-6">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center mx-auto mb-3">
              <Heart className="w-6 h-6 fill-rose-400" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">
              {activeFilter === 'my-cemeteries' ? 'No saved cemeteries yet' : 'No cemeteries found'}
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto leading-relaxed">
              {activeFilter === 'my-cemeteries'
                ? 'Tap the heart icon on any cemetery card to add it to My cemeteries for quick access.'
                : 'Try adjusting your search query or filter.'}
            </p>
          </div>
        ) : (
          filteredCemeteries.map((cem) => {
            const isSelected = selectedCemetery?.id === cem.id;
            const isSaved = isMyCemetery(cem.id);

            return (
              <div
                key={cem.id}
                onClick={() => onSelectCemetery(cem)}
                className={`w-full bg-white rounded-2xl p-3.5 border transition-all cursor-pointer flex items-center shadow-sm hover:shadow active:scale-[0.99] ${
                  isSelected
                    ? 'border-brand-forest ring-2 ring-brand-forest/10'
                    : 'border-slate-200/80 hover:border-slate-300'
                }`}
              >
                {/* Cemetery Thumbnail */}
                <div className="w-14 h-14 rounded-xl overflow-hidden relative shrink-0 bg-slate-100 mr-3.5 border border-slate-200/60">
                  <CemeteryThumbnail cemetery={cem} />
                </div>

                {/* Cemetery Details */}
                <div className="flex-1 min-w-0 pr-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-900 truncate">{cem.name}</h2>
                    {cem.distanceMeters !== undefined && (
                      <span className="text-xs font-semibold text-slate-500 shrink-0 ml-2">
                        {formatDistance(cem.distanceMeters)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate mt-0.5">
                    {cem.city}, {cem.province}
                  </p>
                  {/* Google requires the photographer to be credited wherever their photo is shown */}
                  {cem.photoUrl && cem.photoAttribution && (
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      Photo by {cem.photoAttribution}
                    </p>
                  )}
                  {cemeteryTags(cem).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {cemeteryTags(cem).map((tag) => (
                        <span
                          key={tag}
                          className={`px-1.5 py-px rounded text-[10px] font-semibold ${
                            tag === 'Closed' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center text-[11px] text-slate-600 mt-1">
                    <span>{formatGravesMapped(cem.mappedGravesCount)}</span>
                    {/* Coverage needs a real total for the cemetery, so it stays hidden until one is recorded */}
                    {cem.totalGravesEstimate > 0 && (
                      <>
                        <span className="mx-1.5 text-slate-300">•</span>
                        <span className="font-semibold text-emerald-700">{cem.coveragePercentage}% coverage</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Heart Button to toggle My Cemetery */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleMyCemetery(cem.id);
                  }}
                  className="p-2 rounded-full hover:bg-slate-100 transition-colors mr-0.5 shrink-0"
                  title={isSaved ? 'In My cemeteries' : 'Add to My cemeteries'}
                  aria-label="Toggle My Cemetery"
                >
                  <Heart
                    className={`w-5 h-5 transition-transform active:scale-125 ${
                      isSaved
                        ? 'text-rose-500 fill-rose-500'
                        : 'text-slate-300 hover:text-rose-400'
                    }`}
                  />
                </button>

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
