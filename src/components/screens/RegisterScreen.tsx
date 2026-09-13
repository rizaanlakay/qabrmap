'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { 
  User, 
  Mail, 
  Lock, 
  Phone, 
  Heart, 
  Bell, 
  ArrowRight, 
  ArrowLeft, 
  CheckCircle2, 
  ShieldCheck, 
  Sparkles, 
  Loader2, 
  MapPin,
  Calendar
} from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { dataStore } from '@/lib/data/store';
import { Cemetery, RelationshipCategory } from '@/types';

interface RegisterScreenProps {
  cemeteries: Cemetery[];
  onFinish: () => void;
  onGoToSignIn: () => void;
}

export const RegisterScreen: React.FC<RegisterScreenProps> = ({ 
  cemeteries, 
  onFinish, 
  onGoToSignIn 
}) => {
  const { signUp, signInWithGoogle } = useAuth();
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  
  // Step state: 1 to 5
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Form states
  // Step 2: Account
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');

  // Step 3: First Loved One
  const [hasLovedOne, setHasLovedOne] = useState(true);
  const [lovedOneName, setLovedOneName] = useState('');
  const [selectedCemeteryId, setSelectedCemeteryId] = useState(cemeteries[0]?.id || 'cem_athlone');
  const [relationshipCategory, setRelationshipCategory] = useState<RelationshipCategory>('family');
  const [specificRelation, setSpecificRelation] = useState('Father');
  const [lovedOneNote, setLovedOneNote] = useState('');

  // Step 4: Preferences
  const [fridayReminder, setFridayReminder] = useState(true);
  const [janazahNotices, setJanazahNotices] = useState(true);
  const [preservationUpdates, setPreservationUpdates] = useState(true);

  // Status
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Common relationship options
  const relationshipOptions = [
    'Father',
    'Mother',
    'Grandfather',
    'Grandmother',
    'Husband',
    'Wife',
    'Son',
    'Daughter',
    'Brother',
    'Sister',
    'Uncle',
    'Aunt',
    'Close Friend',
    'Colleague',
    'Teacher / Mentor',
    'Other'
  ];

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setIsGoogleLoading(true);
    try {
      const result = await signInWithGoogle();
      if (result.error) {
        setErrorMessage(result.error);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to sign in with Google');
    } finally {
      setIsGoogleLoading(false);
    }
  };

  // Handle registration submission at Step 4
  const handleCompleteRegistration = async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      // 1. Create account via Supabase Auth
      const { error } = await signUp(email, password, fullName);
      if (error) {
        setErrorMessage(error);
        setLoading(false);
        return;
      }

      // 2. If user provided a loved one, save it into DataStore
      if (hasLovedOne && lovedOneName.trim()) {
        const dummyGraveId = `grave_user_loved_${Date.now()}`;
        const newGrave = {
          id: dummyGraveId,
          cemeteryId: selectedCemeteryId,
          graveNumber: 'NEW',
          latitude: -33.967521,
          longitude: 18.503277,
          positionAccuracyMeters: 3.0,
          positionConfidence: 'HIGH' as const,
          status: 'MAPPED' as const,
          primaryPhotoUrl: '/sample-gravestone.svg',
          photoCount: 1,
          person: {
            id: `person_${dummyGraveId}`,
            firstName: lovedOneName.trim().split(' ')[0] || lovedOneName,
            surname: lovedOneName.trim().split(' ').slice(1).join(' ') || '',
            fullName: lovedOneName.trim(),
            gender: 'unknown' as const,
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // Save grave to data store
        await dataStore.saveNewGrave(newGrave);

        // Save relationship
        dataStore.saveGraveRelationship({
          graveId: dummyGraveId,
          category: relationshipCategory,
          specificRelation: specificRelation,
          notes: lovedOneNote.trim() || 'Saved during registration',
          savedAt: new Date().toISOString(),
        });
      }

      // Move to success step 5
      setCurrentStep(5);
    } catch (err: any) {
      setErrorMessage(err.message || 'An unexpected error occurred during registration.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-y-auto">
      {/* Progress Header */}
      <div className="bg-brand-forest text-white px-6 pt-5 pb-6 shrink-0 relative overflow-hidden">
        {/* Subtle decorative background pattern */}
        <div className="absolute right-0 top-0 opacity-10 pointer-events-none translate-x-4 -translate-y-4">
          <Image src="/icons/icon.svg" alt="Pattern" width={160} height={160} />
        </div>

        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => {
              if (currentStep > 1 && currentStep < 5) {
                setCurrentStep(currentStep - 1);
              } else {
                onFinish();
              }
            }}
            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          
          <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
            {currentStep < 5 ? `Step ${currentStep} of 4` : 'Complete'}
          </span>

          <button
            onClick={onGoToSignIn}
            className="text-xs text-emerald-200 hover:text-white font-medium transition-colors"
          >
            Sign In
          </button>
        </div>

        {/* Step Title */}
        <h1 className="text-xl font-bold tracking-tight">
          {currentStep === 1 && 'Welcome to QabrMap'}
          {currentStep === 2 && 'Create Your Account'}
          {currentStep === 3 && 'Remember a Loved One'}
          {currentStep === 4 && 'Remembrance Preferences'}
          {currentStep === 5 && 'Alhamdulillah, Welcome!'}
        </h1>
        <p className="text-xs text-emerald-100/80 mt-1 max-w-xs">
          {currentStep === 1 && 'A completely free, community-powered Muslim resting places directory.'}
          {currentStep === 2 && 'Sign up to sync your saved graves and notes across all your devices.'}
          {currentStep === 3 && 'Honor family members and friends by saving their resting places.'}
          {currentStep === 4 && 'Set up Friday remembrance and community Janazah alerts.'}
          {currentStep === 5 && 'Your account and preferences have been successfully configured.'}
        </p>

        {/* Step Progress Dots */}
        {currentStep < 5 && (
          <div className="flex space-x-1.5 mt-4">
            {[1, 2, 3, 4].map((step) => (
              <div
                key={step}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  step === currentStep
                    ? 'w-8 bg-emerald-400'
                    : step < currentStep
                    ? 'w-3 bg-white/60'
                    : 'w-3 bg-white/20'
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Main Form Content */}
      <div className="flex-1 px-5 py-6 flex flex-col justify-between max-w-md mx-auto w-full">
        {/* ================= STEP 1: WELCOME & PURPOSE ================= */}
        {currentStep === 1 && (
          <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Mission Card */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto mb-3 shadow-inner">
                <Image src="/icons/icon.svg" alt="QabrMap Crest" width={40} height={40} />
              </div>
              <p className="font-serif italic text-xs text-slate-500 mb-1">
                بِسْمِ ٱللَّٰهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ
              </p>
              <h2 className="text-base font-bold text-slate-900">
                Preserving Sacred Resting Places
              </h2>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                QabrMap empowers the Muslim community to document, find, and remember the graves of our parents, grandparents, and loved ones with dignified GPS precision.
              </p>
            </div>

            {/* Core Values / Free Forever Banner */}
            <div className="space-y-2.5">
              <div className="flex items-start space-x-3 bg-emerald-50/70 border border-emerald-100 rounded-xl p-3">
                <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-xs font-bold text-emerald-950">100% Free Forever</h3>
                  <p className="text-[11px] text-emerald-800/80 mt-0.5">
                    No subscriptions, no fees, no paywalls. Created purely for community benefit.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3 bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                <Heart className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-xs font-bold text-slate-900">Private &amp; Dedicated</h3>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Save personal relationships, memories, and visit notes linked directly to your profile.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3 bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                <Sparkles className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-xs font-bold text-slate-900">Cross-Device Sync</h3>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Access your saved cemeteries and graves from any phone, tablet, or computer.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setCurrentStep(2)}
              className="w-full py-3 px-4 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-sm font-semibold flex items-center justify-center space-x-2 transition-all shadow-md active:scale-98"
            >
              <span>Get Started</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ================= STEP 2: ACCOUNT CREATION ================= */}
        {currentStep === 2 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Google Sign In option */}
            <div>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading || isGoogleLoading}
                className="w-full py-2.5 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 text-xs font-semibold flex items-center justify-center space-x-2.5 transition-all shadow-sm active:scale-98 disabled:opacity-50 cursor-pointer"
              >
                {isGoogleLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                ) : (
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                )}
                <span>Sign in with Google</span>
              </button>

              <div className="relative my-3 flex items-center justify-center">
                <div className="border-t border-slate-200 w-full" />
                <span className="bg-slate-50 px-2.5 text-[10px] text-slate-400 font-medium uppercase tracking-wider shrink-0">
                  or fill in details manually
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Mogamat Zain Adams"
                    className="w-full pl-10 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-forest transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Email Address <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full pl-10 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-forest transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full pl-10 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-forest transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Phone or WhatsApp <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+27 82 123 4567"
                    className="w-full pl-10 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-forest transition-all"
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Optional: Used only for Janazah/burial announcements if enabled.
                </p>
              </div>
            </div>

            <button
              disabled={!fullName.trim() || !email.trim() || password.length < 6}
              onClick={() => setCurrentStep(3)}
              className="w-full mt-4 py-3 px-4 rounded-xl bg-brand-forest hover:bg-brand-dark disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center space-x-2 transition-all shadow-md active:scale-98"
            >
              <span>Continue to Loved Ones</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ================= STEP 3: HONOR FIRST LOVED ONE ================= */}
        {currentStep === 3 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-3">
              <div className="flex items-center space-x-2.5">
                <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />
                <span className="text-xs font-medium text-slate-800">
                  Add a loved one right now?
                </span>
              </div>
              <input
                type="checkbox"
                checked={hasLovedOne}
                onChange={(e) => setHasLovedOne(e.target.checked)}
                className="w-4 h-4 text-brand-forest rounded focus:ring-brand-forest"
              />
            </div>

            {hasLovedOne ? (
              <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-3 shadow-sm">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Loved One&apos;s Full Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={lovedOneName}
                    onChange={(e) => setLovedOneName(e.target.value)}
                    placeholder="e.g. Fatima Hendricks"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-forest focus:bg-white transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Relationship
                    </label>
                    <select
                      value={specificRelation}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSpecificRelation(val);
                        if (['Close Friend', 'Colleague'].includes(val)) {
                          setRelationshipCategory('friend');
                        } else if (val === 'Teacher / Mentor') {
                          setRelationshipCategory('mentor');
                        } else {
                          setRelationshipCategory('family');
                        }
                      }}
                      className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-forest focus:bg-white"
                    >
                      {relationshipOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Cemetery
                    </label>
                    <select
                      value={selectedCemeteryId}
                      onChange={(e) => setSelectedCemeteryId(e.target.value)}
                      className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-forest focus:bg-white"
                    >
                      {cemeteries.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name.replace(' Muslim Cemetery', '')}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Personal Du&apos;a or Note <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <textarea
                    rows={2}
                    value={lovedOneNote}
                    onChange={(e) => setLovedOneNote(e.target.value)}
                    placeholder="e.g. May Allah grant her Jannatul Firdaus and widen her grave..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-forest focus:bg-white transition-all"
                  />
                </div>
              </div>
            ) : (
              <div className="bg-slate-100/80 border border-slate-200 rounded-xl p-4 text-center">
                <p className="text-xs text-slate-500">
                  No problem. You can search or map your loved ones anytime from the home screen.
                </p>
              </div>
            )}

            <button
              onClick={() => setCurrentStep(4)}
              className="w-full mt-4 py-3 px-4 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-sm font-semibold flex items-center justify-center space-x-2 transition-all shadow-md active:scale-98"
            >
              <span>Continue to Preferences</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ================= STEP 4: PREFERENCES & CONFIRMATION ================= */}
        {currentStep === 4 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {errorMessage && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start space-x-2">
                <span className="shrink-0 font-bold">Error:</span>
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-3 shadow-sm">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider text-emerald-800">
                Islamic Notifications &amp; Remembrances
              </h3>

              {/* Toggle 1: Friday Jumu'ah Du'a */}
              <label className="flex items-start space-x-3 p-2 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={fridayReminder}
                  onChange={(e) => setFridayReminder(e.target.checked)}
                  className="w-4 h-4 mt-0.5 text-brand-forest rounded focus:ring-brand-forest"
                />
                <div>
                  <span className="text-xs font-semibold text-slate-800 block">
                    Friday Jumu&apos;ah Du&apos;a Reminder
                  </span>
                  <span className="text-[11px] text-slate-500 leading-snug block">
                    Gentle reminder on Thursday evening / Friday to recite Surah Yaseen and make du&apos;a for your loved ones.
                  </span>
                </div>
              </label>

              {/* Toggle 2: Janazah Announcements */}
              <label className="flex items-start space-x-3 p-2 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={janazahNotices}
                  onChange={(e) => setJanazahNotices(e.target.checked)}
                  className="w-4 h-4 mt-0.5 text-brand-forest rounded focus:ring-brand-forest"
                />
                <div>
                  <span className="text-xs font-semibold text-slate-800 block">
                    Local Janazah &amp; Burial Notices
                  </span>
                  <span className="text-[11px] text-slate-500 leading-snug block">
                    Community notices when a janazah or burial takes place in your selected cemetery.
                  </span>
                </div>
              </label>

              {/* Toggle 3: Preservation */}
              <label className="flex items-start space-x-3 p-2 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={preservationUpdates}
                  onChange={(e) => setPreservationUpdates(e.target.checked)}
                  className="w-4 h-4 mt-0.5 text-brand-forest rounded focus:ring-brand-forest"
                />
                <div>
                  <span className="text-xs font-semibold text-slate-800 block">
                    Community Mapping Updates
                  </span>
                  <span className="text-[11px] text-slate-500 leading-snug block">
                    Be notified when new gravestones or register records are verified in your cemetery.
                  </span>
                </div>
              </label>
            </div>

            {/* Terms reminder */}
            <p className="text-[11px] text-center text-slate-400">
              By joining, you contribute to a sacred, non-commercial Muslim community archive.
            </p>

            <button
              disabled={loading}
              onClick={handleCompleteRegistration}
              className="w-full py-3 px-4 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-sm font-semibold flex items-center justify-center space-x-2 transition-all shadow-md active:scale-98 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creating Account &amp; Syncing...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Complete Free Registration</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* ================= STEP 5: SUCCESS CELEBRATION ================= */}
        {currentStep === 5 && (
          <div className="space-y-6 text-center animate-in zoom-in-95 duration-300 my-auto">
            <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center mx-auto shadow-md">
              <CheckCircle2 className="w-10 h-10 text-emerald-700" />
            </div>

            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Alhamdulillah!
              </h2>
              <p className="text-xs text-slate-600 mt-1 max-w-xs mx-auto leading-relaxed">
                Your account is ready and synced with Supabase cloud. You are now part of QabrMap.
              </p>
            </div>

            {hasLovedOne && lovedOneName.trim() && (
              <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm text-left max-w-xs mx-auto">
                <div className="flex items-center space-x-2 text-xs font-semibold text-slate-800">
                  <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />
                  <span>Saved to My Cemeteries:</span>
                </div>
                <p className="text-sm font-bold text-brand-dark mt-1">
                  {lovedOneName}
                </p>
                <div className="flex items-center space-x-2 mt-1">
                  <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                    {specificRelation}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {cemeteries.find((c) => c.id === selectedCemeteryId)?.name || 'Cemetery'}
                  </span>
                </div>
              </div>
            )}

            <button
              onClick={onFinish}
              className="w-full py-3 px-4 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-sm font-semibold flex items-center justify-center space-x-2 transition-all shadow-md active:scale-98"
            >
              <span>Enter QabrMap</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
