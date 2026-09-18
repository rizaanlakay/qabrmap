'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ArrowLeft, Search as SearchIcon, X, ChevronRight, Heart, Loader2, WifiOff, Clock } from 'lucide-react';
import { Grave } from '@/types';
import { GraveImage } from '@/components/common/GraveImage';
import { dataStore } from '@/lib/data/store';
import { graveNumberLabel } from '@/lib/ui/graveLabels';
import { MIN_SEARCH_CHARS, SEARCH_DEBOUNCE_MS, SearchKind, filterGravesLocally, isSearchable } from '@/lib/graves/searchGraves';

interface SearchScreenProps {
  initialQuery?: string;
  onSelectGrave: (grave: Grave) => void;
  onBack: () => void;
}

type FilterType = 'all' | 'saved' | 'names' | 'numbers';

// Loved ones shown before anything is typed; the chip shows the rest
const LOVED_ONES_PREVIEW = 5;

const GraveResultCard: React.FC<{ grave: Grave; onSelect: (grave: Grave) => void }> = ({ grave, onSelect }) => {
  const rel = grave.relationship || dataStore.getGraveRelationship(grave.id);
  return (
    <div
      onClick={() => onSelect(grave)}
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
          {graveNumberLabel(grave) && (
            <>
              <span className="font-semibold text-brand-dark">{graveNumberLabel(grave)}</span>
              <span className="mx-1.5 text-slate-300">•</span>
            </>
          )}
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
};

const SectionTitle: React.FC<{ icon: React.ReactNode; title: string; action?: React.ReactNode }> = ({ icon, title, action }) => (
  <div className="flex items-center justify-between px-1 pt-1">
    <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-500 uppercase tracking-wide">
      {icon}
      <span>{title}</span>
    </div>
    {action}
  </div>
);

export const SearchScreen: React.FC<SearchScreenProps> = ({
  initialQuery = '',
  onSelectGrave,
  onBack,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [filterType, setFilterType] = useState<FilterType>('all');

  // The database does the searching, a page at a time; nothing here ever holds every grave
  const [results, setResults] = useState<Grave[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [fromDevice, setFromDevice] = useState(false);
  const [status, setStatus] = useState<'idle' | 'searching' | 'loading-more' | 'done'>('idle');
  // Answers to a search the user has already typed past are dropped
  const searchIdRef = useRef(0);

  // Shown before anything is typed; both are small lists fetched by id
  const [lovedOnes, setLovedOnes] = useState<Grave[]>([]);
  const [recent, setRecent] = useState<Grave[]>([]);
  useEffect(() => {
    let isMounted = true;
    dataStore.getLovedOnes().then((list) => isMounted && setLovedOnes(list)).catch(() => {});
    dataStore.getRecentGraves().then((list) => isMounted && setRecent(list)).catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  const searchable = isSearchable(query);
  const kind: SearchKind = filterType === 'saved' ? 'all' : filterType;

  useEffect(() => {
    const searchId = ++searchIdRef.current;
    setResults([]);
    setHasMore(false);
    setFromDevice(false);
    if (filterType === 'saved' || !searchable) {
      setStatus('idle');
      return;
    }
    setStatus('searching');
    const timer = window.setTimeout(() => {
      dataStore
        .searchGravesPage(query, kind, 0)
        .then((page) => {
          if (searchIdRef.current !== searchId) return;
          setResults(page.graves);
          setHasMore(page.hasMore);
          setFromDevice(page.source === 'device');
          setStatus('done');
        })
        .catch(() => {
          if (searchIdRef.current === searchId) setStatus('done');
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, filterType, kind, searchable]);

  const loadMore = useCallback(() => {
    if (status !== 'done' || !hasMore) return;
    const searchId = searchIdRef.current;
    setStatus('loading-more');
    dataStore
      .searchGravesPage(query, kind, results.length)
      .then((page) => {
        if (searchIdRef.current !== searchId) return;
        // A grave mapped between two pages can shift the next page by one; never show it twice
        setResults((shown) => [...shown, ...page.graves.filter((grave) => !shown.some((other) => other.id === grave.id))]);
        setHasMore(page.hasMore);
        setStatus('done');
      })
      .catch(() => {
        if (searchIdRef.current === searchId) setStatus('done');
      });
  }, [status, hasMore, query, kind, results.length]);

  // The next page loads as the end of the list scrolls into view
  const moreRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const target = moreRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore, hasMore]);

  const lovedOneMatches = useMemo(() => filterGravesLocally(lovedOnes, query, 'all'), [lovedOnes, query]);
  // A grave is not listed twice before anything is typed
  const recentOthers = useMemo(
    () => recent.filter((grave) => !lovedOnes.slice(0, LOVED_ONES_PREVIEW).some((loved) => loved.id === grave.id)),
    [recent, lovedOnes]
  );

  const renderBody = () => {
    if (filterType === 'saved') {
      if (lovedOneMatches.length === 0) {
        return (
          <div className="text-center py-12 text-slate-400 text-sm">
            {lovedOnes.length === 0
              ? 'No marked loved ones yet. Open any grave and tap "Mark Relationship".'
              : 'None of your loved ones match.'}
          </div>
        );
      }
      return lovedOneMatches.map((grave) => <GraveResultCard key={grave.id} grave={grave} onSelect={onSelectGrave} />);
    }

    if (!searchable) {
      return (
        <>
          {query.trim().length > 0 && (
            <div className="text-center text-xs text-slate-400">Type at least {MIN_SEARCH_CHARS} letters or digits to search.</div>
          )}
          {lovedOnes.length > 0 && (
            <>
              <SectionTitle
                icon={<Heart className="w-3.5 h-3.5 fill-rose-500 text-rose-500" />}
                title="Loved ones"
                action={
                  lovedOnes.length > LOVED_ONES_PREVIEW ? (
                    <button onClick={() => setFilterType('saved')} className="text-xs font-semibold text-brand-forest">
                      See all {lovedOnes.length}
                    </button>
                  ) : undefined
                }
              />
              {lovedOnes.slice(0, LOVED_ONES_PREVIEW).map((grave) => (
                <GraveResultCard key={grave.id} grave={grave} onSelect={onSelectGrave} />
              ))}
            </>
          )}
          {recentOthers.length > 0 && (
            <>
              <SectionTitle icon={<Clock className="w-3.5 h-3.5" />} title="Recently viewed" />
              {recentOthers.map((grave) => (
                <GraveResultCard key={grave.id} grave={grave} onSelect={onSelectGrave} />
              ))}
            </>
          )}
          {lovedOnes.length === 0 && recentOthers.length === 0 && query.trim().length === 0 && (
            <div className="text-center py-12 px-6 text-slate-400 text-sm">
              <SearchIcon className="w-8 h-8 mx-auto mb-3 text-slate-300" />
              Search by name, nickname or grave number across every mapped cemetery.
            </div>
          )}
        </>
      );
    }

    if (status === 'searching') {
      return (
        <div className="flex items-center justify-center py-12 text-slate-400 text-sm space-x-2" role="status">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Searching…</span>
        </div>
      );
    }

    return (
      <>
        {fromDevice && (
          <div className="flex items-start space-x-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" role="status">
            <WifiOff className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>The full search isn&apos;t reachable right now, so this only covers graves already saved on this phone.</span>
          </div>
        )}
        {results.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">No matching graves found.</div>
        ) : (
          results.map((grave) => <GraveResultCard key={grave.id} grave={grave} onSelect={onSelectGrave} />)
        )}
        {hasMore && (
          <button
            ref={moreRef}
            onClick={loadMore}
            disabled={status === 'loading-more'}
            className="w-full py-3 text-xs font-semibold text-brand-forest flex items-center justify-center space-x-2"
          >
            {status === 'loading-more' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{status === 'loading-more' ? 'Loading more…' : 'Show more'}</span>
          </button>
        )}
      </>
    );
  };

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
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filter Chips matching Mockup Screen 4; centred, and wrapped onto a second line on narrow phones instead of scrolling */}
        <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
          {[
            { id: 'all', label: 'All' },
            { id: 'saved', label: 'Loved Ones' },
            { id: 'names', label: 'Names' },
            { id: 'numbers', label: 'Grave Numbers' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id as FilterType)}
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
      <div className="flex-1 overflow-y-auto p-4 space-y-3">{renderBody()}</div>
    </div>
  );
};
