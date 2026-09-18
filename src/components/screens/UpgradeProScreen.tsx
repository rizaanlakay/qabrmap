'use client';

import React from 'react';
import Image from 'next/image';
import {
  ArrowLeft,
  Sparkles,
  Heart,
  Share2,
  Camera,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  Phone,
  Mail,
  Globe,
  Check,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';

interface UpgradeProScreenProps {
  onBack: () => void;
  onNavigate?: (screen: string) => void;
}

export const UpgradeProScreen: React.FC<UpgradeProScreenProps> = ({ onBack, onNavigate }) => {
  const { user, profile, openAuthModal } = useAuth();
  const subscriptionType = profile?.subscriptionType || (user?.user_metadata?.subscription_type === 'Pro' ? 'Pro' : 'Free');
  const isPro = subscriptionType === 'Pro';

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-y-auto">
      {/* Top Header Bar */}
      <div className="px-4 py-3 bg-white border-b border-slate-200/80 sticky top-0 z-20 shrink-0 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-colors"
            aria-label="Go Back"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
          </button>
          <div>
            <h1 className="text-base font-bold text-slate-900 tracking-tight">Upgrade to Pro</h1>
            <p className="text-[11px] text-slate-500">Ta&apos;awun Community Fund</p>
          </div>
        </div>
        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200/80 whitespace-nowrap shrink-0">
          {isPro ? 'Pro Active' : 'Free Member'}
        </span>
      </div>

      <div className="p-4 space-y-4 max-w-md mx-auto w-full pb-10">
        {/* Hero Card with Brand Gradient */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0D281E] via-[#143A2C] to-[#0A1E16] text-white p-5 shadow-xl border border-[#C5A059]/40">
          <div className="absolute -top-12 -right-12 w-40 h-40 bg-[#CDAD62]/20 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute -bottom-10 -left-10 w-36 h-36 bg-emerald-400/15 rounded-full blur-2xl pointer-events-none" />

          <div className="relative">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-[#CDAD62]/20 border border-[#CDAD62]/50 text-[#F5D77F]">
                <Sparkles className="w-3 h-3 text-[#F5D77F]" />
                Pro Membership
              </span>
              <div className="w-10 h-10 rounded-xl bg-white/95 p-1 shadow-sm flex items-center justify-center shrink-0">
                <Image
                  src="/Logo.png"
                  alt="Ta'awun Logo"
                  width={34}
                  height={34}
                  className="object-contain"
                />
              </div>
            </div>

            <h2 className="text-xl font-extrabold tracking-tight mt-3 text-white leading-tight">
              Unlock the Full Power of Qabr Map
            </h2>
            <p className="text-xs text-emerald-100/90 mt-1.5 leading-relaxed">
              Pro membership is provided <strong>100% free</strong> to all active members of the <strong>Ta&apos;awun Community Fund</strong> as part of our mutual assistance initiative.
            </p>
          </div>
        </div>

        {/* Pro Features Section */}
        <div>
          <div className="flex items-center justify-between mb-2.5 px-1">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Included with Pro
            </h3>
            <span className="text-[11px] font-semibold text-emerald-700">
              3 Exclusive Features
            </span>
          </div>

          <div className="space-y-3">
            {/* Feature 1: Save Unlimited Graves */}
            <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm hover:border-emerald-300 transition-colors">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-2xl bg-rose-50 border border-rose-100 text-rose-600 flex items-center justify-center shrink-0 shadow-sm">
                  <Heart className="w-5 h-5 fill-rose-500 text-rose-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2.5">
                    <h4 className="text-sm font-bold text-slate-900 leading-snug">
                      Save Unlimited Graves
                    </h4>
                    <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200/70 px-3 py-1 rounded-full whitespace-nowrap shrink-0">
                      Unlimited
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Free accounts are limited to saving relationships or hearting up to <strong>3 graves</strong>. Pro members can save and organize unlimited resting places for ancestors, family, and loved ones.
                  </p>
                  <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Free: Max 3 graves</span>
                    <span className="font-bold text-emerald-700 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      Pro: Unlimited
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Feature 2: Share Graves with Friends & Family */}
            <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm hover:border-emerald-300 transition-colors">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center shrink-0 shadow-sm">
                  <Share2 className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2.5">
                    <h4 className="text-sm font-bold text-slate-900 leading-snug">
                      Share Graves with Friends &amp; Family
                    </h4>
                    <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200/70 px-3 py-1 rounded-full whitespace-nowrap shrink-0">
                      Direct Sharing
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Share direct grave links via WhatsApp, SMS, or social media. Family members receive verified coordinates, photos, and instant turn-by-turn guidance straight to the gravesite.
                  </p>
                  <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Free: Disabled</span>
                    <span className="font-bold text-emerald-700 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      Pro: Full Sharing
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Feature 3: My Surveys — Scan Multiple Sites in One Go */}
            <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm hover:border-emerald-300 transition-colors">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-100 text-brand-forest flex items-center justify-center shrink-0 shadow-sm">
                  <Camera className="w-5 h-5 text-brand-forest" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2.5">
                    <h4 className="text-sm font-bold text-slate-900 leading-snug">
                      My Surveys: Continuous Scanning
                    </h4>
                    <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200/70 px-3 py-1 rounded-full whitespace-nowrap shrink-0">
                      Multi-Scan
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    The My Surveys feature allows you to scan multiple cemetery sites and rows in one continuous session without stopping. Automated AI reads inscriptions and syncs photos in the background.
                  </p>
                  <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Free: Single mapping</span>
                    <span className="font-bold text-emerald-700 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      Pro: Continuous Surveys
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* How to Get Pro Membership Section */}
        <div className="bg-gradient-to-br from-emerald-950 via-[#103325] to-[#0A1F16] rounded-3xl p-5 text-white shadow-md border border-[#C5A059]/40 space-y-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#F5D77F]">
              How to Get Pro
            </span>
            <h3 className="text-base font-bold text-white mt-0.5">
              Join the Ta&apos;awun Community Fund
            </h3>
            <p className="text-xs text-emerald-100/85 mt-1 leading-relaxed">
              When you become a member of the Ta&apos;awun Janazah Fund, you comprehensively cover your family&apos;s funeral expenses and receive instant Pro access to Qabr Map.
            </p>
          </div>

          {/* 3 Step Breakdown */}
          <div className="space-y-3 text-xs">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-[#CDAD62] text-[#0A1F16] font-extrabold flex items-center justify-center shrink-0 text-xs shadow-sm mt-0.5">
                1
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-white">Join Ta&apos;awun Community Fund</span>
                <p className="text-[11px] text-emerald-200/80 mt-0.5">
                  Sign up for dignified, 100% Shariah-compliant mutual funeral assistance.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-[#CDAD62] text-[#0A1F16] font-extrabold flex items-center justify-center shrink-0 text-xs shadow-sm mt-0.5">
                2
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-white">Use Your Registered Email</span>
                <p className="text-[11px] text-emerald-200/80 mt-0.5">
                  Sign into Qabr Map with the same email address registered with Ta&apos;awun.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-[#CDAD62] text-[#0A1F16] font-extrabold flex items-center justify-center shrink-0 text-xs shadow-sm mt-0.5">
                3
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-white">Enjoy Unlimited Pro Access</span>
                <p className="text-[11px] text-emerald-200/80 mt-0.5">
                  Your account is upgraded to Pro automatically with unlimited features.
                </p>
              </div>
            </div>
          </div>

          {/* CTA Link Button */}
          <div className="pt-2">
            <a
              href="https://taawun.co.za"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#CDAD62] via-[#E2C98C] to-[#CDAD62] hover:from-[#E2C98C] hover:to-[#CDAD62] text-[#0A1F16] font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-black/30 active:scale-[0.99] transition-all group"
            >
              <span>Join Ta&apos;awun Community Fund</span>
              <ExternalLink className="w-4 h-4 text-[#0A1F16] group-hover:translate-x-0.5 transition-transform" />
            </a>
            <p className="text-[10px] text-center text-emerald-200/70 mt-2">
              Visit taawun.co.za &bull; Instant quote &amp; easy registration
            </p>
          </div>

          {/* Contact Channels Bar */}
          <div className="pt-3 border-t border-[#C5A059]/30">
            <div className="grid grid-cols-4 divide-x divide-[#C5A059]/30 text-center">
              <a
                href="https://wa.me/27685298643"
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center px-0.5 group hover:opacity-90"
              >
                <div className="w-7 h-7 rounded-full border border-[#C5A059] flex items-center justify-center mb-1 text-[#DFBF7A]">
                  <Phone className="w-3 h-3" />
                </div>
                <span className="text-[7.5px] font-semibold text-[#DFBF7A] uppercase">WhatsApp</span>
                <span className="text-[7px] text-white/90 mt-0.5">+27 68 529</span>
              </a>

              <a
                href="tel:0212039773"
                className="flex flex-col items-center px-0.5 group hover:opacity-90"
              >
                <div className="w-7 h-7 rounded-full border border-[#C5A059] flex items-center justify-center mb-1 text-[#DFBF7A]">
                  <Phone className="w-3 h-3" />
                </div>
                <span className="text-[7.5px] font-semibold text-[#DFBF7A] uppercase">Phone</span>
                <span className="text-[7px] text-white/90 mt-0.5">021 203 9773</span>
              </a>

              <a
                href="mailto:info@taawun.co.za"
                className="flex flex-col items-center px-0.5 group hover:opacity-90"
              >
                <div className="w-7 h-7 rounded-full border border-[#C5A059] flex items-center justify-center mb-1 text-[#DFBF7A]">
                  <Mail className="w-3 h-3" />
                </div>
                <span className="text-[7.5px] font-semibold text-[#DFBF7A] uppercase">Email</span>
                <span className="text-[7px] text-white/90 mt-0.5 break-all">info@taawun</span>
              </a>

              <a
                href="https://taawun.co.za"
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center px-0.5 group hover:opacity-90"
              >
                <div className="w-7 h-7 rounded-full border border-[#C5A059] flex items-center justify-center mb-1 text-[#DFBF7A]">
                  <Globe className="w-3 h-3" />
                </div>
                <span className="text-[7.5px] font-semibold text-[#DFBF7A] uppercase">Website</span>
                <span className="text-[7px] text-white/90 mt-0.5 break-all">taawun.co.za</span>
              </a>
            </div>
          </div>
        </div>

        {/* Back / Sign In Options */}
        <div className="space-y-2 pt-2">
          {!user && (
            <button
              onClick={openAuthModal}
              className="w-full py-2.5 px-4 rounded-xl border border-emerald-600 bg-white hover:bg-emerald-50 text-brand-forest text-xs font-semibold transition-colors"
            >
              Already a Ta&apos;awun member? Sign In
            </button>
          )}
          <button
            onClick={onBack}
            className="w-full py-2.5 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors"
          >
            Return to Home
          </button>
        </div>
      </div>
    </div>
  );
};
