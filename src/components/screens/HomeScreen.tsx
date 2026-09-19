'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import {
  Search,
  Camera,
  Compass,
  Heart,
  User as UserIcon,
  ExternalLink,
  CheckCircle2,
  Phone,
  Mail,
  Globe,
  Sparkles,
  ChevronRight,
  Menu,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { RemembranceQuoteCarousel } from '../common/RemembranceQuoteCarousel';
import { BurgerMenuDrawer } from '../common/BurgerMenuDrawer';

interface HomeScreenProps {
  myCemeteryCount?: number;
  onNavigate: (screen: string) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ myCemeteryCount = 2, onNavigate }) => {
  const { user, profile, openAuthModal } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const displayName = profile?.displayName || user?.user_metadata?.display_name || user?.email?.split('@')[0];
  const subscriptionType = profile?.subscriptionType || (user?.user_metadata?.subscription_type === 'Pro' ? 'Pro' : 'Free');

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-slate-50">
      {/* Burger Menu Drawer (Only accessible from Home Screen) */}
      <BurgerMenuDrawer
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onNavigate={onNavigate}
      />

      {/* Full-bleed Hero with overlaid text */}
      <div className="relative w-full h-[272px] sm:h-72 shrink-0">
        {/* Hero Image — edge to edge, flush to top */}
        <Image
          src="/QabrHero.png"
          alt="Ta'awun Qabr Map Hero"
          fill
          className="object-cover"
          priority
        />
        {/* Dark gradient overlay for text legibility */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/25 to-black/60" />

        {/* White Burger Menu Button (Top Left overlaying Hero) */}
        <button
          id="home-burger-menu-button"
          onClick={() => setIsMenuOpen(true)}
          className="absolute top-3.5 left-3.5 z-30 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-md border border-white/25 text-white flex items-center justify-center transition-all shadow-md active:scale-95 cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/40"
          title="Open Menu"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5 text-white" />
        </button>

        {/* User Account / Profile Button */}
        {user ? (
          <button
            onClick={openAuthModal}
            className="absolute top-3.5 right-3.5 z-30 flex items-center gap-2 px-2.5 py-1.5 rounded-2xl bg-black/50 hover:bg-black/70 backdrop-blur-md border border-white/20 text-white transition-all shadow-md active:scale-95 text-left cursor-pointer"
            title="View profile & account"
          >
            <div className="w-7 h-7 rounded-full bg-emerald-700/90 border border-emerald-400/50 flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-inner">
              {(displayName || 'U')[0].toUpperCase()}
            </div>
            <div className="flex flex-col min-w-0 pr-0.5">
              <span className="max-w-[110px] truncate text-xs font-bold leading-tight text-white">
                {displayName}
              </span>
              <span className="text-[10px] font-semibold leading-tight text-emerald-300 flex items-center gap-1 mt-0.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                {subscriptionType}
              </span>
            </div>
          </button>
        ) : (
          <button
            onClick={openAuthModal}
            className="absolute top-3.5 right-3.5 z-30 flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-md border border-white/20 text-white text-xs font-medium transition-all shadow-sm active:scale-95 cursor-pointer"
            title="Sign in"
          >
            <UserIcon className="w-3.5 h-3.5 text-emerald-300" />
            <span>Sign In</span>
          </button>
        )}

        {/* Overlaid Brand Content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="w-10 h-10 mb-1 relative drop-shadow-lg">
            <Image
              src="/icons/icon.svg"
              alt="Ta'awun Qabr Map Crest"
              width={40}
              height={40}
              className="object-contain drop-shadow-lg"
            />
          </div>
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight text-white text-center px-4"
            style={{ textShadow: '0 2px 8px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.4)' }}
          >
            Ta&apos;awun Qabr Map
          </h1>
          <p
            className="text-xs sm:text-sm text-white/90 tracking-widest mt-0.5 font-medium"
            style={{ textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}
          >
            Find. Remember. Always.
          </p>
          <div
            className="mt-2 flex flex-col items-center text-center"
            style={{ textShadow: '0 1px 4px rgba(0,0,0,0.7)' }}
          >
            <p className="text-[10px] text-white/80 tracking-wide font-normal">
              brought to you by
            </p>
            <a
              href="https://taawun.co.za"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-col items-center group mt-0.5 pointer-events-auto"
            >
              <span className="text-xs font-bold text-white group-hover:text-emerald-300 group-hover:underline underline-offset-2 tracking-wide transition-colors">
                Ta&apos;awun Community Fund
              </span>
              <div className="mt-1.5 w-9 h-9 rounded-full overflow-hidden shadow-lg border-2 border-[#CDAD62]/80 bg-white/95 p-0.5 flex items-center justify-center group-hover:scale-105 group-hover:border-[#CDAD62] transition-all duration-200">
                <Image
                  src="/Logo.png"
                  alt="Ta'awun Community Fund Logo"
                  width={34}
                  height={34}
                  className="w-full h-full object-cover rounded-full scale-105"
                />
              </div>
            </a>
          </div>
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
        {/* Upgrade to Pro Button (Visible to Free Users) */}
        {subscriptionType !== 'Pro' && (
          <button
            onClick={() => onNavigate('upgrade-pro')}
            className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-[#CDAD62] via-[#E2C98C] to-[#CDAD62] hover:from-[#E2C98C] hover:to-[#CDAD62] text-[#0A1F16] font-bold text-sm flex items-center justify-between shadow-md shadow-[#C5A059]/20 active:scale-[0.99] transition-all group border border-[#F5D77F]/60"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-black/10 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-[#0A1F16]" />
              </div>
              <div className="text-left">
                <div className="flex items-center gap-1.5">
                  <span className="font-extrabold text-sm leading-tight text-[#0A1F16]">
                    Upgrade to Pro
                  </span>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-[#0A1F16]/15 text-[#0A1F16]">
                    Unlock
                  </span>
                </div>
                <p className="text-[11px] font-medium text-[#143A2C]/80 leading-tight mt-0.5">
                  Unlimited graves, sharing &amp; survey tools
                </p>
              </div>
            </div>
            <div className="w-7 h-7 rounded-full bg-white/40 flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform">
              <ChevronRight className="w-4 h-4 text-[#0A1F16]" />
            </div>
          </button>
        )}

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

      {/* Auto-cycling Islamic Remembrance & Reflections Carousel */}
      <RemembranceQuoteCarousel autoCycleIntervalMs={7000} />

      {/* Ta'awun Community Fund Sponsor & Funeral Cover Card */}
      <section className="px-4 pb-8 my-2" aria-label="Ta'awun Community Fund">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0D281E] via-[#143A2C] to-[#0A1E16] text-white p-5 shadow-lg border border-[#C5A059]/40">
          {/* Subtle Ambient Glow Orbs */}
          <div className="absolute -top-10 -right-10 w-36 h-36 bg-[#CDAD62]/20 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-emerald-400/15 rounded-full blur-2xl pointer-events-none" />

          {/* Top Brand Header */}
          <div className="relative flex items-center gap-3.5">
            <div className="w-14 h-14 rounded-2xl bg-white/95 p-1.5 shadow-md flex items-center justify-center shrink-0 border border-white/50 backdrop-blur-sm">
              <Image
                src="/Logo.png"
                alt="Ta'awun Community Fund"
                width={48}
                height={48}
                className="object-contain"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-emerald-200/90 font-medium leading-tight">
                This app is brought to you by
              </p>
              <h3 className="text-base font-bold text-white tracking-tight leading-tight mt-0.5">
                Ta&apos;awun Community Fund
              </h3>
            </div>
          </div>

          {/* Explanation / What Ta'awun is */}
          <p className="relative text-xs text-emerald-100/90 leading-relaxed mt-3.5 pt-3 border-t border-emerald-800/60 font-normal">
            The Ta&apos;awun Janazah Fund is a Shariah-compliant mutual assistance fund designed to help Muslim families comprehensively cover funeral expenses with dignity, ease, and complete peace of mind.
          </p>

          {/* Benefit Pills */}
          <div className="relative grid grid-cols-2 gap-2 mt-3 text-[11px] text-emerald-100/90">
            <div className="flex items-center gap-1.5 bg-black/20 rounded-lg px-2.5 py-1.5 border border-white/10">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#F5D77F] shrink-0" />
              <span>100% Shariah Compliant</span>
            </div>
            <div className="flex items-center gap-1.5 bg-black/20 rounded-lg px-2.5 py-1.5 border border-white/10">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#F5D77F] shrink-0" />
              <span>Dignified Janazah Cover</span>
            </div>
          </div>

          {/* CTA Button */}
          <a
            href="https://taawun.co.za"
            target="_blank"
            rel="noopener noreferrer"
            className="relative mt-4 w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#CDAD62] via-[#DFBF7A] to-[#CDAD62] hover:from-[#DFBF7A] hover:to-[#CDAD62] text-[#0A1F16] font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-black/30 active:scale-[0.99] transition-all group"
          >
            <span>Get quote - Learn more</span>
            <ExternalLink className="w-3.5 h-3.5 text-[#0A1F16] group-hover:translate-x-0.5 transition-transform" />
          </a>

          {/* Contact Channels */}
          <div className="relative mt-4 pt-3.5 border-t border-[#C5A059]/30">
            <div className="grid grid-cols-4 divide-x divide-[#C5A059]/35 text-center">
              {/* WhatsApp */}
              <a
                href="https://wa.me/27685298643"
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center justify-start px-0.5 group hover:opacity-90 transition-opacity"
              >
                <div className="w-8 h-8 rounded-full border border-[#C5A059] flex items-center justify-center mb-1 text-[#DFBF7A] group-hover:scale-105 group-hover:border-[#DFBF7A] transition-transform">
                  <svg className="w-3.5 h-3.5 fill-[#DFBF7A]" viewBox="0 0 24 24">
                    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.9C17.18 3.03 14.69 2 12.04 2ZM12.05 20.15C10.57 20.15 9.12 19.75 7.85 19L7.55 18.82L4.43 19.64L5.26 16.6L5.06 16.29C4.24 14.98 3.81 13.47 3.81 11.91C3.81 7.37 7.5 3.68 12.04 3.68C14.25 3.68 16.31 4.54 17.87 6.1C19.42 7.66 20.28 9.72 20.28 11.92C20.28 16.46 16.59 20.15 12.05 20.15ZM16.57 14.41C16.32 14.29 15.1 13.69 14.88 13.61C14.65 13.53 14.49 13.49 14.32 13.73C14.16 13.98 13.69 14.53 13.55 14.69C13.4 14.86 13.26 14.88 13.01 14.76C12.77 14.63 11.98 14.37 11.05 13.54C10.32 12.89 9.83 12.08 9.68 11.84C9.54 11.59 9.67 11.46 9.79 11.34C9.9 11.23 10.04 11.05 10.16 10.91C10.28 10.77 10.32 10.66 10.4 10.5C10.48 10.34 10.44 10.2 10.38 10.07C10.32 9.95 9.83 8.74 9.63 8.24C9.43 7.76 9.23 7.83 9.07 7.82C8.93 7.81 8.76 7.81 8.6 7.81C8.43 7.81 8.17 7.87 7.94 8.12C7.72 8.36 7.09 8.95 7.09 10.16C7.09 11.37 7.97 12.54 8.09 12.7C8.21 12.87 9.82 15.36 12.29 16.42C12.88 16.67 13.33 16.82 13.69 16.94C14.28 17.13 14.82 17.1 15.25 17.04C15.73 16.97 16.71 16.44 16.92 15.87C17.12 15.29 17.12 14.8 17.06 14.69C17 14.59 16.82 14.53 16.57 14.41Z"/>
                  </svg>
                </div>
                <span className="text-[8px] sm:text-[9px] font-semibold text-[#DFBF7A] tracking-wider uppercase">
                  WHATSAPP
                </span>
                <span className="text-[7.5px] xs:text-[8.5px] sm:text-[9.5px] text-white/95 font-medium mt-0.5 leading-tight text-center">
                  +27 68 529 8643
                </span>
              </a>

              {/* Phone */}
              <a
                href="tel:0212039773"
                className="flex flex-col items-center justify-start px-0.5 group hover:opacity-90 transition-opacity"
              >
                <div className="w-8 h-8 rounded-full border border-[#C5A059] flex items-center justify-center mb-1 text-[#DFBF7A] group-hover:scale-105 group-hover:border-[#DFBF7A] transition-transform">
                  <Phone className="w-3.5 h-3.5 text-[#DFBF7A]" />
                </div>
                <span className="text-[8px] sm:text-[9px] font-semibold text-[#DFBF7A] tracking-wider uppercase">
                  PHONE
                </span>
                <span className="text-[7.5px] xs:text-[8.5px] sm:text-[9.5px] text-white/95 font-medium mt-0.5 leading-tight text-center">
                  021 203 9773
                </span>
              </a>

              {/* Email */}
              <a
                href="mailto:info@taawun.co.za"
                className="flex flex-col items-center justify-start px-0.5 group hover:opacity-90 transition-opacity"
              >
                <div className="w-8 h-8 rounded-full border border-[#C5A059] flex items-center justify-center mb-1 text-[#DFBF7A] group-hover:scale-105 group-hover:border-[#DFBF7A] transition-transform">
                  <Mail className="w-3.5 h-3.5 text-[#DFBF7A]" />
                </div>
                <span className="text-[8px] sm:text-[9px] font-semibold text-[#DFBF7A] tracking-wider uppercase">
                  EMAIL
                </span>
                <span className="text-[7px] xs:text-[8px] sm:text-[9px] text-white/95 font-medium mt-0.5 leading-tight text-center break-words">
                  info@&#8203;taawun.co.za
                </span>
              </a>

              {/* Website */}
              <a
                href="https://taawun.co.za"
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center justify-start px-0.5 group hover:opacity-90 transition-opacity"
              >
                <div className="w-8 h-8 rounded-full border border-[#C5A059] flex items-center justify-center mb-1 text-[#DFBF7A] group-hover:scale-105 group-hover:border-[#DFBF7A] transition-transform">
                  <Globe className="w-3.5 h-3.5 text-[#DFBF7A]" />
                </div>
                <span className="text-[8px] sm:text-[9px] font-semibold text-[#DFBF7A] tracking-wider uppercase">
                  WEBSITE
                </span>
                <span className="text-[7px] xs:text-[8px] sm:text-[9px] text-white/95 font-medium mt-0.5 leading-tight text-center break-words">
                  www.&#8203;taawun.co.za
                </span>
              </a>
            </div>

            {/* Decorative Gold Star/Diamond Divider */}
            <div className="relative flex items-center justify-center mt-3 pt-0.5">
              <div className="flex-grow border-t border-[#C5A059]/40" />
              <div className="shrink-0 px-2.5 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-[#CDAD62]" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="12,3 14.2,7.5 12,11.5 9.8,7.5" />
                  <polygon points="12,12.5 14.2,16.5 12,21 9.8,16.5" />
                  <polygon points="3,12 7.5,9.8 11.5,12 7.5,14.2" />
                  <polygon points="12.5,12 16.5,9.8 21,12 16.5,14.2" />
                </svg>
              </div>
              <div className="flex-grow border-t border-[#C5A059]/40" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
