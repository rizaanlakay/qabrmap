'use client';

import React, { useEffect } from 'react';
import Image from 'next/image';
import {
  Home,
  Search,
  Camera,
  HelpCircle,
  User,
  LogIn,
  X,
  ChevronRight,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';

interface BurgerMenuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (screen: string) => void;
}

export const BurgerMenuDrawer: React.FC<BurgerMenuDrawerProps> = ({
  isOpen,
  onClose,
  onNavigate,
}) => {
  const { user, profile, openAuthModal } = useAuth();

  const displayName =
    profile?.displayName ||
    user?.user_metadata?.display_name ||
    user?.email?.split('@')[0];
  const subscriptionType =
    profile?.subscriptionType ||
    (user?.user_metadata?.subscription_type === 'Pro' ? 'Pro' : 'Free');

  // Close drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent background scroll while open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleItemClick = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 animate-in fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Container aligned with the mobile app frame */}
      <div className="w-full max-w-md h-full relative pointer-events-none">
        {/* Drawer panel */}
        <div
          className="pointer-events-auto absolute top-0 left-0 bottom-0 w-72 sm:w-80 max-w-[85%] h-full bg-slate-900 border-r border-slate-800/80 shadow-2xl flex flex-col z-10 animate-in slide-in-from-left duration-300 ease-out"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation Menu"
        >
        {/* Drawer Header */}
        <div className="p-5 border-b border-slate-800 bg-gradient-to-b from-brand-forest/40 to-slate-900 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-brand-forest/60 border border-emerald-500/30 flex items-center justify-center p-1.5 shadow-inner">
              <Image
                src="/icons/icon.svg"
                alt="Ta'awun Qabr Map Logo"
                width={32}
                height={32}
                className="object-contain drop-shadow"
              />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight leading-tight">
                Ta&apos;awun Qabr Map
              </h2>
              <p className="text-[11px] text-emerald-300/90 font-medium tracking-wide">
                Find. Remember. Always.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Menu Items List */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5">
          {/* 1. Home */}
          <button
            id="drawer-item-home"
            onClick={() => handleItemClick(() => onNavigate('home'))}
            className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-all group text-left"
          >
            <div className="flex items-center space-x-3.5">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                <Home className="w-5 h-5" />
              </div>
              <div>
                <span className="text-sm font-semibold tracking-wide block">Home</span>
                <span className="text-[11px] text-slate-400">Dashboard &amp; overview</span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all" />
          </button>

          {/* 2. Search */}
          <button
            id="drawer-item-search"
            onClick={() => handleItemClick(() => onNavigate('search'))}
            className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-all group text-left"
          >
            <div className="flex items-center space-x-3.5">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                <Search className="w-5 h-5" />
              </div>
              <div>
                <span className="text-sm font-semibold tracking-wide block">Search</span>
                <span className="text-[11px] text-slate-400">Find loved ones &amp; graves</span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all" />
          </button>

          {/* 3. Capture */}
          <button
            id="drawer-item-capture"
            onClick={() => handleItemClick(() => onNavigate('capture'))}
            className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-all group text-left"
          >
            <div className="flex items-center space-x-3.5">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                <Camera className="w-5 h-5" />
              </div>
              <div>
                <span className="text-sm font-semibold tracking-wide block">Capture</span>
                <span className="text-[11px] text-slate-400">Photograph &amp; map a grave</span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all" />
          </button>

          {/* 4. Help */}
          <button
            id="drawer-item-help"
            onClick={() => handleItemClick(() => onNavigate('help'))}
            className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-all group text-left"
          >
            <div className="flex items-center space-x-3.5">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                <HelpCircle className="w-5 h-5" />
              </div>
              <div>
                <span className="text-sm font-semibold tracking-wide block">Help</span>
                <span className="text-[11px] text-slate-400">3-step guide: Capture, Share &amp; AR</span>
              </div>
            </div>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              Guide
            </span>
          </button>

          {/* 5. Profile / SignIn */}
          <button
            id="drawer-item-profile"
            onClick={() =>
              handleItemClick(() => {
                if (user) {
                  onNavigate('profile');
                } else {
                  openAuthModal();
                }
              })
            }
            className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-800/80 text-slate-200 hover:text-white transition-all group text-left"
          >
            <div className="flex items-center space-x-3.5">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                {user ? <User className="w-5 h-5" /> : <LogIn className="w-5 h-5" />}
              </div>
              <div className="min-w-0">
                <span className="text-sm font-semibold tracking-wide block truncate">
                  {user ? 'Profile' : 'Profile / SignIn'}
                </span>
                <span className="text-[11px] text-slate-400 truncate block">
                  {user ? displayName || 'View account' : 'Sign in to sync & save'}
                </span>
              </div>
            </div>
            {user ? (
              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-800/60 shrink-0">
                {subscriptionType}
              </span>
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all" />
            )}
          </button>
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40 space-y-2 text-center">
          <a
            href="https://taawun.co.za"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center space-x-1.5 text-xs text-slate-400 hover:text-emerald-300 transition-colors"
          >
            <span>Brought to you by Ta&apos;awun Community Fund</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <p className="text-[10px] text-slate-500">
            Version 2.0 • Digital Muslim Cemetery Mapping
          </p>
        </div>
      </div>
    </div>
  </div>
);
};
