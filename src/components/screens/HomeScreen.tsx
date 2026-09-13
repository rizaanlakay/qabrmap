'use client';

import React from 'react';
import Image from 'next/image';
import { Search, Camera, Compass, Heart, User as UserIcon } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';

interface HomeScreenProps {
  myCemeteryCount?: number;
  onNavigate: (screen: string) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ myCemeteryCount = 2, onNavigate }) => {
  const { user, openAuthModal } = useAuth();

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-slate-50">
      {/* Full-bleed Hero with overlaid text */}
      <div className="relative w-full h-56 shrink-0">
        {/* Hero Image — edge to edge, flush to top */}
        <Image
          src="/QabrHero.png"
          alt="QabrMap Hero"
          fill
          className="object-cover"
          priority
        />
        {/* Dark gradient overlay for text legibility */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/25 to-black/60" />

        {/* User Account / Profile Button */}
        <button
          onClick={openAuthModal}
          className="absolute top-3.5 right-3.5 z-20 flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-md border border-white/20 text-white text-xs font-medium transition-all shadow-sm active:scale-95"
          title={user ? 'View profile' : 'Sign in'}
        >
          <UserIcon className="w-3.5 h-3.5 text-emerald-300" />
          <span className="max-w-[100px] truncate">
            {user ? (user.user_metadata?.display_name || user.email?.split('@')[0]) : 'Sign In'}
          </span>
        </button>

        {/* Overlaid Brand Content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="w-12 h-12 mb-2 relative drop-shadow-lg">
            <Image
              src="/icons/icon.svg"
              alt="QabrMap Crest"
              width={48}
              height={48}
              className="object-contain drop-shadow-lg"
            />
          </div>
          <h1
            className="text-3xl font-bold tracking-tight text-white"
            style={{ textShadow: '0 2px 8px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.4)' }}
          >
            QabrMap
          </h1>
          <p
            className="text-sm text-white/90 tracking-widest mt-0.5 font-medium"
            style={{ textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}
          >
            Find. Remember. Always.
          </p>
        </div>
      </div>

      {/* New User Community Registration Banner (if not signed in) */}
      {!user && (
        <div className="mx-5 mt-3 bg-gradient-to-r from-emerald-900 to-brand-forest rounded-2xl p-3.5 text-white shadow-sm flex items-center justify-between border border-emerald-800/60">
          <div className="pr-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
              Free Community Account
            </span>
            <h3 className="text-xs font-semibold mt-0.5">
              Honor &amp; Sync Your Loved Ones
            </h3>
            <p className="text-[11px] text-emerald-100/80 mt-0.5">
              Cloud backup, family relations &amp; Friday reminders
            </p>
          </div>
          <button
            onClick={() => onNavigate('register')}
            className="shrink-0 px-3 py-2 bg-emerald-400 hover:bg-emerald-300 text-emerald-950 font-bold text-xs rounded-xl shadow transition-all active:scale-95"
          >
            Register Free
          </button>
        </div>
      )}

      {/* Main Action Cards matching Mockup Screen 1 */}
      <div className="px-5 mt-3 space-y-3">
        {/* Card 1: Find a loved one (Primary Green Card) */}
        <button
          onClick={() => onNavigate('search')}
          className="w-full bg-brand-forest hover:bg-brand-dark text-white rounded-2xl p-4 flex items-center shadow-md transition-all active:scale-[0.99] text-left group"
        >
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center mr-4 shrink-0 group-hover:bg-white/20 transition-colors">
            <Search className="w-6 h-6 text-emerald-300" />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-wide">Find a loved one</h2>
            <p className="text-xs text-emerald-100/80 mt-0.5">Search and navigate to a grave</p>
          </div>
        </button>

        {/* Card 2: Map a grave */}
        <button
          onClick={() => onNavigate('capture')}
          className="w-full bg-white hover:bg-slate-50 border border-slate-200/80 text-brand-dark rounded-2xl p-4 flex items-center shadow-sm transition-all active:scale-[0.99] text-left group"
        >
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-brand-forest flex items-center justify-center mr-4 shrink-0 group-hover:bg-emerald-100 transition-colors">
            <Camera className="w-6 h-6 text-brand-forest" />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-wide text-slate-800">Map a grave</h2>
            <p className="text-xs text-slate-500 mt-0.5">Photograph and help map</p>
          </div>
        </button>

        {/* Card 3: Explore cemeteries */}
        <button
          onClick={() => onNavigate('cemetery-select')}
          className="w-full bg-white hover:bg-slate-50 border border-slate-200/80 text-brand-dark rounded-2xl p-4 flex items-center shadow-sm transition-all active:scale-[0.99] text-left group"
        >
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-brand-forest flex items-center justify-center mr-4 shrink-0 group-hover:bg-emerald-100 transition-colors">
            <Compass className="w-6 h-6 text-brand-forest" />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-wide text-slate-800">Explore cemeteries</h2>
            <p className="text-xs text-slate-500 mt-0.5">Browse nearby or worldwide</p>
          </div>
        </button>

        {/* Card 4: My cemeteries (Only shown for signed in users) */}
        {user && (
          <button
            onClick={() => onNavigate('my-cemeteries')}
            className="w-full bg-white hover:bg-slate-50 border border-slate-200/80 text-brand-dark rounded-2xl p-4 flex items-center shadow-sm transition-all active:scale-[0.99] text-left group animate-in fade-in duration-200"
          >
            <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center mr-4 shrink-0 group-hover:bg-rose-100 transition-colors">
              <Heart className="w-6 h-6 fill-rose-500 text-rose-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold tracking-wide text-slate-800">My cemeteries</h2>
                {myCemeteryCount > 0 && (
                  <span className="text-[11px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
                    {myCemeteryCount}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Your loved ones &amp; their resting places</p>
            </div>
          </button>
        )}
      </div>

      {/* Quranic Verse Banner at Bottom */}
      <div className="px-6 py-4 my-2 text-center">
        <blockquote className="text-[12px] italic text-slate-600 leading-relaxed font-serif">
          &ldquo;And do not say of those who are killed in the way of Allah that they are dead. Rather, they are alive...&rdquo;
        </blockquote>
        <cite className="block text-[11px] text-slate-400 font-sans mt-1.5 not-italic">
          — Qur&apos;an 2:154
        </cite>
      </div>
    </div>
  );
};
