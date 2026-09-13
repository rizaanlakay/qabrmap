'use client';

import React from 'react';
import { Home, Search, Camera, ClipboardList, User } from 'lucide-react';

export type NavTab = 'home' | 'search' | 'capture' | 'surveys' | 'profile';

interface BottomNavProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ currentTab, onSelectTab }) => {
  return (
    <nav className="w-full bg-white border-t border-slate-200/80 px-3 py-2 flex items-center justify-around z-30 shrink-0 select-none shadow-[0_-2px_10px_rgba(0,0,0,0.04)]">
      {/* 1. Home */}
      <button
        onClick={() => onSelectTab('home')}
        className={`flex flex-col items-center justify-center transition-colors min-w-[56px] py-1 ${
          currentTab === 'home' ? 'text-brand-forest font-semibold' : 'text-slate-400 hover:text-slate-600'
        }`}
      >
        <Home className="w-5 h-5 stroke-[2.2]" />
        <span className="text-[10px] mt-1">Home</span>
      </button>

      {/* 2. Search */}
      <button
        onClick={() => onSelectTab('search')}
        className={`flex flex-col items-center justify-center transition-colors min-w-[56px] py-1 ${
          currentTab === 'search' ? 'text-brand-forest font-semibold' : 'text-slate-400 hover:text-slate-600'
        }`}
      >
        <Search className="w-5 h-5 stroke-[2.2]" />
        <span className="text-[10px] mt-1">Search</span>
      </button>

      {/* 3. Capture (Elevated Center FAB) */}
      <button
        onClick={() => onSelectTab('capture')}
        className="relative -top-3 flex flex-col items-center justify-center group focus:outline-none"
        aria-label="Capture a Grave"
      >
        <div className="w-13 h-13 p-3.5 bg-brand-forest text-white rounded-full shadow-lg shadow-brand-forest/30 flex items-center justify-center transform group-hover:scale-105 active:scale-95 transition-all">
          <Camera className="w-6 h-6 stroke-[2.2]" />
        </div>
        <span className="text-[10px] mt-0.5 font-medium text-brand-forest">Capture</span>
      </button>

      {/* 4. My Surveys */}
      <button
        onClick={() => onSelectTab('surveys')}
        className={`flex flex-col items-center justify-center transition-colors min-w-[56px] py-1 ${
          currentTab === 'surveys' ? 'text-brand-forest font-semibold' : 'text-slate-400 hover:text-slate-600'
        }`}
      >
        <ClipboardList className="w-5 h-5 stroke-[2.2]" />
        <span className="text-[10px] mt-1">My Surveys</span>
      </button>

      {/* 5. Profile */}
      <button
        onClick={() => onSelectTab('profile')}
        className={`flex flex-col items-center justify-center transition-colors min-w-[56px] py-1 ${
          currentTab === 'profile' ? 'text-brand-forest font-semibold' : 'text-slate-400 hover:text-slate-600'
        }`}
      >
        <User className="w-5 h-5 stroke-[2.2]" />
        <span className="text-[10px] mt-1">Profile</span>
      </button>
    </nav>
  );
};
