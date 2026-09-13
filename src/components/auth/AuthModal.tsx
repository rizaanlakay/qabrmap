'use client';

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth/AuthContext';
import { X, User, Mail, Lock, LogOut, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface AuthModalProps {
  onOpenRegistrationFlow?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onOpenRegistrationFlow }) => {
  const { user, isAuthModalOpen, closeAuthModal, signIn, signUp, signOut } = useAuth();
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isAuthModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setIsLoading(true);

    try {
      if (tab === 'signin') {
        const result = await signIn(email, password);
        if (result.error) {
          setError(result.error);
        } else {
          setSuccessMessage('Signed in successfully!');
          setTimeout(() => closeAuthModal(), 800);
        }
      } else {
        const result = await signUp(email, password, displayName);
        if (result.error) {
          setError(result.error);
        } else {
          setSuccessMessage('Account created! Check your email if verification is required.');
          setTimeout(() => closeAuthModal(), 1500);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-brand-forest px-6 pt-6 pb-5 text-white relative">
          <button
            onClick={closeAuthModal}
            className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center mb-2">
            <User className="w-5 h-5 text-emerald-300" />
          </div>
          <h2 className="text-lg font-bold tracking-tight">
            {user ? 'My Profile' : tab === 'signin' ? 'Welcome Back' : 'Create Account'}
          </h2>
          <p className="text-xs text-emerald-100/80 mt-0.5">
            {user
              ? 'Your QabrMap account & synced data'
              : 'Sign in to sync your loved ones across all devices'}
          </p>
        </div>

        {/* Content */}
        <div className="p-6">
          {user ? (
            /* Logged In View */
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-lg">
                    {(user.user_metadata?.display_name || user.email || 'U')[0].toUpperCase()}
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {user.user_metadata?.display_name || 'QabrMap Member'}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{user.email}</p>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-200/60 flex items-center justify-between text-xs text-slate-600">
                  <span>Cloud Database:</span>
                  <span className="font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                    Connected (Supabase)
                  </span>
                </div>
              </div>

              <div className="text-xs text-slate-500 bg-emerald-50/60 border border-emerald-100 p-3 rounded-xl flex items-start space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Your saved graves in <strong>My cemeteries</strong> and relationships are automatically backed up to your account.
                </span>
              </div>

              <button
                onClick={async () => {
                  await signOut();
                  closeAuthModal();
                }}
                className="w-full py-2.5 px-4 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 font-medium text-sm flex items-center justify-center space-x-2 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          ) : (
            /* Sign In / Sign Up Form */
            <div>
              {/* Tab Selector */}
              <div className="flex bg-slate-100 p-1 rounded-xl mb-4 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setTab('signin');
                    setError(null);
                  }}
                  className={`flex-1 py-1.5 rounded-lg transition-all ${
                    tab === 'signin'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab('signup');
                    setError(null);
                  }}
                  className={`flex-1 py-1.5 rounded-lg transition-all ${
                    tab === 'signup'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Create Account
                </button>
              </div>

              {error && (
                <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {successMessage && (
                <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-start space-x-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{successMessage}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3">
                {tab === 'signup' && (
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Full Name
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="e.g. Farouk Adams"
                        className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-forest focus:bg-white transition-all"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-forest focus:bg-white transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-forest focus:bg-white transition-all"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full mt-2 py-2.5 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold flex items-center justify-center space-x-2 transition-all shadow-md disabled:opacity-50"
                >
                  {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{tab === 'signin' ? 'Sign In' : 'Create Account'}</span>
                </button>
              </form>

              {tab === 'signup' && onOpenRegistrationFlow && (
                <button
                  type="button"
                  onClick={() => {
                    closeAuthModal();
                    onOpenRegistrationFlow();
                  }}
                  className="w-full mt-3 py-1.5 text-center text-xs text-brand-forest hover:text-brand-dark font-medium transition-colors"
                >
                  Want a guided setup? <span className="underline font-semibold">Start full onboarding →</span>
                </button>
              )}

              <p className="text-[10px] text-center text-slate-400 mt-3">
                Secured with Supabase Row Level Security.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
