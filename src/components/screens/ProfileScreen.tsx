'use client';

import React, { useState } from 'react';
import { 
  User, 
  Mail, 
  ShieldCheck, 
  Heart, 
  ClipboardList, 
  LogOut, 
  Bell, 
  ChevronRight, 
  ExternalLink,
  ArrowLeft,
  CheckCircle2,
  Lock
} from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { dataStore } from '@/lib/data/store';

interface ProfileScreenProps {
  onNavigate: (screen: string) => void;
  onBack: () => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ onNavigate, onBack }) => {
  const { user, signOut, isAdmin } = useAuth();
  const [fridayReminders, setFridayReminders] = useState(true);
  const [janazahAlerts, setJanazahAlerts] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const displayName = user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'Community Member';
  const email = user?.email || 'No email provided';
  const initial = displayName.charAt(0).toUpperCase();

  const savedGravesCount = dataStore.getMyCemeteriesGraveCount();
  const activeSession = dataStore.getActiveSurveySession();

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      onNavigate('home');
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-y-auto">
      {/* Header */}
      <div className="bg-brand-forest text-white px-6 pt-5 pb-6 shrink-0 relative">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={onBack}
            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
            Account &amp; Profile
          </span>
          <div className="w-7" /> {/* Spacer */}
        </div>

        {/* User Card */}
        <div className="flex items-center space-x-3.5">
          <div className="w-14 h-14 rounded-2xl bg-emerald-700/80 border-2 border-emerald-400/40 flex items-center justify-center text-white text-xl font-bold shadow-inner">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <h1 className="text-lg font-bold text-white tracking-tight truncate">
                {displayName}
              </h1>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                Verified
              </span>
            </div>
            <p className="text-xs text-emerald-100/80 truncate mt-0.5 flex items-center space-x-1">
              <Mail className="w-3 h-3 opacity-70" />
              <span>{email}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Stats Summary Bar */}
      <div className="px-5 -mt-3">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 grid grid-cols-2 divide-x divide-slate-100">
          <div className="pr-3 text-center">
            <span className="block text-xl font-bold text-brand-dark">
              {savedGravesCount}
            </span>
            <span className="text-[11px] text-slate-500 font-medium">
              Saved Loved Ones
            </span>
          </div>
          <div className="pl-3 text-center">
            <span className="block text-xl font-bold text-brand-forest">
              {activeSession.capturedCount}
            </span>
            <span className="text-[11px] text-slate-500 font-medium">
              Graves Mapped
            </span>
          </div>
        </div>
      </div>

      {/* Profile Sections */}
      <div className="px-5 py-4 space-y-4">
        {/* Quick Links */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden divide-y divide-slate-100">
          <button
            onClick={() => onNavigate('my-cemeteries')}
            className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors group"
          >
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
                <Heart className="w-4 h-4 fill-rose-500" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-slate-900 group-hover:text-brand-forest">
                  My Cemeteries &amp; Loved Ones
                </h3>
                <p className="text-[11px] text-slate-500">
                  {savedGravesCount} resting places saved
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
          </button>

          <button
            onClick={() => onNavigate('survey-session')}
            className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors group"
          >
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-brand-forest flex items-center justify-center">
                <ClipboardList className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-slate-900 group-hover:text-brand-forest">
                  My Survey Sessions
                </h3>
                <p className="text-[11px] text-slate-500">
                  {activeSession.capturedCount} field graves cataloged
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>

        {/* Cloud Sync Status */}
        <div className="bg-emerald-50/70 border border-emerald-100 rounded-2xl p-4 flex items-start space-x-3">
          <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-xs font-bold text-emerald-950">
              Cloud Backup Active
            </h3>
            <p className="text-[11px] text-emerald-800/90 mt-0.5 leading-relaxed">
              Your saved loved ones and personal relationships are synchronized with your Supabase cloud account.
            </p>
          </div>
        </div>

        {/* Preferences */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 space-y-3">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider text-emerald-800">
            Notification Preferences
          </h3>

          <label className="flex items-center justify-between cursor-pointer py-1">
            <div className="pr-3">
              <span className="text-xs font-semibold text-slate-800 block">
                Friday Jumu&apos;ah Du&apos;a Reminder
              </span>
              <span className="text-[11px] text-slate-500 block mt-0.5">
                Surah Yaseen reminder on Thursday evening / Friday morning
              </span>
            </div>
            <input
              type="checkbox"
              checked={fridayReminders}
              onChange={(e) => setFridayReminders(e.target.checked)}
              className="w-4 h-4 text-brand-forest rounded focus:ring-brand-forest"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer py-1 border-t border-slate-100 pt-2.5">
            <div className="pr-3">
              <span className="text-xs font-semibold text-slate-800 block">
                Local Janazah Notices
              </span>
              <span className="text-[11px] text-slate-500 block mt-0.5">
                Cape Town community burial announcements
              </span>
            </div>
            <input
              type="checkbox"
              checked={janazahAlerts}
              onChange={(e) => setJanazahAlerts(e.target.checked)}
              className="w-4 h-4 text-brand-forest rounded focus:ring-brand-forest"
            />
          </label>
        </div>

        {/* Administration link - ONLY visible to verified administrators (rizaan@gmail.com) */}
        {isAdmin && (
          <div className="bg-slate-100/80 border border-emerald-200/60 rounded-2xl p-3 flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs text-slate-700">
              <Lock className="w-3.5 h-3.5 text-emerald-700" />
              <span className="font-semibold text-slate-800">Administrator Access:</span>
            </div>
            <a
              href="/admin"
              className="text-xs font-semibold text-emerald-800 hover:text-emerald-950 flex items-center space-x-1 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-xs"
            >
              <span>Admin Portal</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* Sign Out Button */}
        <button
          disabled={isSigningOut}
          onClick={handleSignOut}
          className="w-full py-3 px-4 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 font-semibold text-xs flex items-center justify-center space-x-2 transition-colors active:scale-98 disabled:opacity-50"
        >
          <LogOut className="w-4 h-4" />
          <span>{isSigningOut ? 'Signing out...' : 'Sign Out of QabrMap'}</span>
        </button>
      </div>
    </div>
  );
};
