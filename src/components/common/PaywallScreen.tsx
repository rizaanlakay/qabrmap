'use client';

import React from 'react';
import { ArrowLeft, Lock, Sparkles, ExternalLink } from 'lucide-react';

export interface PaywallScreenProps {
  headerTitle?: string;
  headerSubtitle?: string;
  title?: string;
  description?: React.ReactNode;
  primaryButtonText?: string;
  onPrimaryAction: () => void;
  onViewAccount?: () => void;
  onUpgradePro?: () => void;
  onBack: () => void;
}

export const PaywallScreen: React.FC<PaywallScreenProps> = ({
  headerTitle = 'Pro Feature',
  headerSubtitle,
  title = 'Feature is Disabled',
  description,
  primaryButtonText = 'Return to Home',
  onPrimaryAction,
  onViewAccount,
  onUpgradePro,
  onBack,
}) => {
  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-y-auto">
      {/* Top Header Bar */}
      <div className="px-4 py-3 bg-white border-b border-slate-200/80 sticky top-0 z-10 shrink-0">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-colors"
            aria-label="Go Back"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">{headerTitle}</h1>
            {headerSubtitle && (
              <p className="text-[11px] text-slate-500">{headerSubtitle}</p>
            )}
          </div>
        </div>
      </div>

      {/* Paywall Content Body */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-sm mx-auto">
        <div className="w-16 h-16 rounded-3xl bg-amber-50 border border-amber-200/70 text-amber-700 flex items-center justify-center mx-auto mb-4 shadow-sm">
          <Lock className="w-8 h-8 text-amber-600" />
        </div>
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 uppercase tracking-wider mb-2">
          Pro Feature
        </span>
        <h2 className="text-lg font-bold text-slate-900 tracking-tight">
          {title}
        </h2>
        <div className="text-xs text-slate-500 mt-2 leading-relaxed">
          {description || (
            <p>
              This feature is exclusive to <strong>Pro members</strong>. Everyone on the Free plan can search, map individual graves, and save loved ones.
            </p>
          )}
        </div>

        {/* Ta'awun Community Fund Pro Access Promo Callout */}
        <div className="mt-4 p-4 rounded-2xl bg-emerald-50/90 border border-emerald-200/80 text-left w-full shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-brand-forest text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
              <Sparkles className="w-4 h-4 text-emerald-200" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-xs font-bold text-slate-900">
                Get Free Unlimited Pro Access
              </h3>
              <p className="text-[11.5px] text-slate-600 mt-1 leading-relaxed">
                Join as a member of <strong>Ta&apos;awun Community Fund</strong> and get free unlimited access as a Pro User.
              </p>
              <a
                href="https://taawun.co.za"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] font-bold text-brand-forest hover:text-brand-dark mt-2.5 group"
              >
                <span>Join Ta&apos;awun Community Fund</span>
                <ExternalLink className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
              </a>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-5 w-full space-y-2.5">
          {onUpgradePro && (
            <button
              onClick={onUpgradePro}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#CDAD62] via-[#E2C98C] to-[#CDAD62] hover:from-[#E2C98C] hover:to-[#CDAD62] text-[#0A1F16] text-xs font-bold shadow-sm active:scale-98 transition-all flex items-center justify-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#0A1F16]" />
              <span>See Pro Features &amp; Benefits</span>
            </button>
          )}
          <button
            onClick={onPrimaryAction}
            className="w-full py-3 px-4 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold shadow-md active:scale-98 transition-all"
          >
            {primaryButtonText}
          </button>
          {onViewAccount && (
            <button
              onClick={onViewAccount}
              className="w-full py-2.5 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all"
            >
              View Account &amp; Plan
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
