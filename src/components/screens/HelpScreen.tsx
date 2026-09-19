'use client';

import React from 'react';
import {
  ArrowLeft,
  Camera,
  Share2,
  Navigation,
  Compass,
  Car,
  Eye,
  CheckCircle2,
  Sparkles,
  HelpCircle,
  Search,
  ScanLine,
  Smartphone,
  MapPin,
  CornerUpRight,
  Footprints,
} from 'lucide-react';

interface HelpScreenProps {
  onNavigate: (screen: string) => void;
  onBack: () => void;
}

export const HelpScreen: React.FC<HelpScreenProps> = ({ onNavigate, onBack }) => {
  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-y-auto">
      {/* Header */}
      <div className="bg-brand-forest text-white px-5 pt-5 pb-6 shrink-0 relative shadow-md">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={onBack}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all active:scale-95 flex items-center justify-center"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-xs font-semibold text-emerald-300">
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Guide &amp; Instructions</span>
          </div>
          <div className="w-9" /> {/* Balance spacer */}
        </div>

        <div className="mt-2">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            How It Works
          </h1>
          <p className="text-xs sm:text-sm text-emerald-100/90 mt-1 leading-relaxed">
            3 simple steps to capture, share, and navigate to any resting place with precision.
          </p>
        </div>
      </div>

      {/* 3 Steps Container */}
      <div className="p-4 sm:p-5 space-y-6 max-w-xl mx-auto w-full">
        {/* ================= STEP 1: CAPTURE ================= */}
        <section className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm relative overflow-hidden">
          {/* Step Badge */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-xl bg-brand-forest text-white flex items-center justify-center font-bold text-sm shadow">
                1
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-brand-forest">
                  Step 1
                </span>
                <h2 className="text-base font-bold text-slate-900 leading-tight">
                  Capture &amp; Map
                </h2>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200/60">
              <Camera className="w-3 h-3 text-emerald-600" />
              Camera &amp; AI
            </span>
          </div>

          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            Click the <strong>Capture</strong> button and hold the gravestone centered within the square alignment frame on your camera.
          </p>

          {/* Visual Camera Simulation Card */}
          <div className="mt-4 rounded-xl overflow-hidden bg-slate-950 border border-slate-800 relative shadow-inner">
            {/* Viewfinder simulation */}
            <div className="h-48 sm:h-52 relative flex flex-col items-center justify-center p-4 bg-gradient-to-b from-slate-900/90 via-slate-950 to-slate-900">
              {/* Top camera status bar */}
              <div className="absolute top-2.5 inset-x-3 flex items-center justify-between text-[10px] text-slate-400">
                <span className="flex items-center gap-1 text-emerald-400 font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  GPS ±1.2m
                </span>
                <span className="bg-white/10 px-2 py-0.5 rounded text-white font-medium">
                  Single Grave Mode
                </span>
              </div>

              {/* Viewfinder Square */}
              <div className="relative w-36 h-36 border-2 border-dashed border-emerald-400/80 rounded-2xl flex flex-col items-center justify-center p-3 bg-emerald-500/5 shadow-[0_0_20px_rgba(16,185,129,0.15)]">
                {/* Corner crosshairs */}
                <div className="absolute -top-1 -left-1 w-3.5 h-3.5 border-t-2 border-l-2 border-emerald-400" />
                <div className="absolute -top-1 -right-1 w-3.5 h-3.5 border-t-2 border-r-2 border-emerald-400" />
                <div className="absolute -bottom-1 -left-1 w-3.5 h-3.5 border-b-2 border-l-2 border-emerald-400" />
                <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 border-b-2 border-r-2 border-emerald-400" />

                {/* Gravestone Graphic Simulation */}
                <div className="w-16 h-20 border-2 border-white/60 rounded-t-full bg-white/10 flex flex-col items-center justify-center p-1.5 shadow">
                  <div className="w-6 h-1 rounded-full bg-emerald-300/80 mb-1" />
                  <div className="w-10 h-1 rounded-full bg-white/60 mb-0.5" />
                  <div className="w-8 h-1 rounded-full bg-white/40 mb-0.5" />
                  <div className="w-6 h-1 rounded-full bg-white/30" />
                </div>
                <span className="text-[9px] font-bold text-emerald-300 mt-1 uppercase tracking-wider text-center">
                  Hold gravestone in square
                </span>
              </div>

              {/* Shutter Capture Button */}
              <div className="absolute bottom-2.5 flex items-center justify-center">
                <div className="w-11 h-11 rounded-full border-2 border-white/80 p-0.5 flex items-center justify-center shadow-lg bg-white/10">
                  <div className="w-9 h-9 rounded-full bg-emerald-500 hover:bg-emerald-400 flex items-center justify-center text-slate-950 font-bold transition-transform active:scale-95 shadow">
                    <Camera className="w-4 h-4 text-white" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Key Takeaways */}
          <div className="mt-3.5 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
            <div className="flex items-start space-x-1.5 bg-slate-50 p-2 rounded-lg border border-slate-200/60">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span><strong>AI Inscription OCR:</strong> Automatically reads name and dates</span>
            </div>
            <div className="flex items-start space-x-1.5 bg-slate-50 p-2 rounded-lg border border-slate-200/60">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span><strong>Geotagging:</strong> Locks sub-meter coordinates automatically</span>
            </div>
          </div>
        </section>

        {/* ================= STEP 2: SHARE ================= */}
        <section className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm relative overflow-hidden">
          {/* Step Badge */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-xl bg-brand-forest text-white flex items-center justify-center font-bold text-sm shadow">
                2
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-brand-forest">
                  Step 2
                </span>
                <h2 className="text-base font-bold text-slate-900 leading-tight">
                  Share with Loved Ones
                </h2>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-full border border-rose-200/60">
              <Share2 className="w-3 h-3 text-rose-600" />
              Family Share
            </span>
          </div>

          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            Click the <strong>Share</strong> button on the top of the <strong>Grave Details Screen</strong> to send a direct link to family, relatives, and friends.
          </p>

          {/* Visual Grave Details Top Bar Simulation */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-inner space-y-3">
            {/* Top Bar Mockup */}
            <div className="bg-white rounded-xl p-2.5 border border-slate-200 shadow-sm flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                  <ArrowLeft className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-semibold text-slate-800">Grave Details</span>
              </div>

              {/* Action Buttons with Highlighted Share */}
              <div className="flex items-center space-x-1.5">
                {/* Heart Button */}
                <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-rose-500">
                  <span className="text-xs">♥</span>
                </div>

                {/* Highlighted Share Button */}
                <div className="relative">
                  <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-md ring-4 ring-emerald-400/30 animate-pulse">
                    <Share2 className="w-4 h-4 text-white" />
                  </div>
                  {/* Tooltip pointer */}
                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[9px] font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded shadow-sm border border-emerald-300 whitespace-nowrap">
                    Click Share
                  </span>
                </div>

                <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                  <span className="text-xs font-bold">⋮</span>
                </div>
              </div>
            </div>

            {/* Share Link Preview Card */}
            <div className="mt-5 pt-1 bg-white rounded-xl p-3 border border-emerald-200/80 shadow-sm">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                  <Share2 className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-bold text-slate-800 truncate">
                    Share Resting Place Link
                  </h4>
                  <p className="text-[10px] text-slate-500 truncate">
                    qabrmap.taawun.co.za/?grave=412
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-slate-600 mt-2">
                Recipients receive photos, exact grave location, and instant one-tap turn-by-turn navigation on their phone.
              </p>
            </div>
          </div>

          {/* Key Takeaways */}
          <div className="mt-3.5 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
            <div className="flex items-start space-x-1.5 bg-slate-50 p-2 rounded-lg border border-slate-200/60">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span><strong>Instant WhatsApp:</strong> Send directly to family chats</span>
            </div>
            <div className="flex items-start space-x-1.5 bg-slate-50 p-2 rounded-lg border border-slate-200/60">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span><strong>Direct Link:</strong> Opens grave page with no install required</span>
            </div>
          </div>
        </section>

        {/* ================= STEP 3: FIND & NAVIGATE ================= */}
        <section className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm relative overflow-hidden">
          {/* Step Badge */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-xl bg-brand-forest text-white flex items-center justify-center font-bold text-sm shadow">
                3
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-brand-forest">
                  Step 3
                </span>
                <h2 className="text-base font-bold text-slate-900 leading-tight">
                  Find &amp; Navigate
                </h2>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200/60">
              <Navigation className="w-3 h-3 text-blue-600" />
              Driving &amp; AR
            </span>
          </div>

          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            Click the <strong>Navigate to Grave</strong> button. The app provides intelligent dual-mode guidance:
          </p>

          {/* Dual Mode Cards */}
          <div className="mt-4 space-y-3">
            {/* Mode A: Far from cemetery - Driving Directions */}
            <div className="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50/70 to-slate-50 p-3.5 shadow-sm">
              <div className="flex items-center space-x-2.5 mb-2">
                <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm shrink-0">
                  <Car className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-900">
                    When Far: Driving Directions
                  </h3>
                  <span className="text-[10px] text-blue-700 font-medium">
                    Road navigation to cemetery entrance
                  </span>
                </div>
              </div>

              {/* Mini Road Navigation Banner Simulation */}
              <div className="bg-slate-900 text-white rounded-lg p-2.5 flex items-center space-x-3 shadow-inner">
                <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white shrink-0">
                  <CornerUpRight className="w-4 h-4 stroke-[3]" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] font-bold block truncate">
                    In 300m, turn right into Athlone Cemetery
                  </span>
                  <span className="text-[9px] text-slate-400">
                    2.4 km • 6 min remaining
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-600 mt-2 leading-tight">
                Turn-by-turn road navigation with voice guidance guides you straight to the cemetery gates.
              </p>
            </div>

            {/* Mode B: Entering cemetery - Augmented Reality */}
            <div className="rounded-xl border border-emerald-300 bg-gradient-to-r from-emerald-50/80 to-slate-50 p-3.5 shadow-sm">
              <div className="flex items-center space-x-2.5 mb-2">
                <div className="w-8 h-8 rounded-lg bg-brand-forest text-white flex items-center justify-center shadow-sm shrink-0">
                  <Eye className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-900">
                    Entering Cemetery: Switch to AR Camera Mode
                  </h3>
                  <span className="text-[10px] text-emerald-700 font-medium">
                    Augmented Reality directions through your camera
                  </span>
                </div>
              </div>

              {/* Mini AR Camera Simulation */}
              <div className="relative rounded-lg overflow-hidden bg-slate-950 border border-slate-800 text-white p-3 shadow-inner h-28 flex flex-col items-center justify-center">
                {/* AR Horizon and Grid lines */}
                <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:16px_16px]" />

                {/* Floating AR Beacon over gravestone */}
                <div className="relative z-10 flex flex-col items-center animate-bounce">
                  <div className="px-2.5 py-1 rounded-full bg-emerald-500 text-slate-950 font-bold text-[10px] shadow-lg flex items-center gap-1">
                    <MapPin className="w-3 h-3 fill-slate-950" />
                    <span>Grave #412 • 8m</span>
                  </div>
                  <div className="w-0.5 h-4 bg-emerald-400" />
                  <div className="w-3 h-1 rounded-full bg-emerald-400/60 shadow-[0_0_8px_#10b981]" />
                </div>

                {/* Footsteps guidance indicator */}
                <div className="absolute bottom-2 inset-x-3 flex items-center justify-between text-[9px] text-emerald-300 font-medium">
                  <span className="flex items-center gap-1">
                    <Footprints className="w-3 h-3 text-emerald-400" />
                    Follow walking arrows
                  </span>
                  <span className="bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/40">
                    Live AR Active
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-slate-600 mt-2 leading-tight">
                When you enter the cemetery gates, the app switches to walking mode. Open <strong>Camera Mode</strong> to see 3D Augmented Reality arrows floating directly over the headstone in real time!
              </p>
            </div>
          </div>
        </section>

        {/* Quick Action Buttons */}
        <div className="pt-2 pb-6 space-y-2.5">
          <button
            onClick={() => onNavigate('search')}
            className="w-full bg-brand-forest hover:bg-brand-dark text-white rounded-xl py-3.5 px-4 font-semibold text-sm flex items-center justify-center space-x-2 shadow-md transition-all active:scale-[0.99]"
          >
            <Search className="w-4 h-4" />
            <span>Search for a Loved One</span>
          </button>

          <button
            onClick={() => onNavigate('capture')}
            className="w-full bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-3 px-4 font-semibold text-sm flex items-center justify-center space-x-2 transition-all active:scale-[0.99] shadow-sm"
          >
            <Camera className="w-4 h-4 text-emerald-700" />
            <span>Map a New Gravestone</span>
          </button>

          <button
            onClick={onBack}
            className="w-full py-2.5 text-xs text-slate-500 hover:text-slate-700 font-medium text-center transition-colors"
          >
            Return to Home
          </button>
        </div>
      </div>
    </div>
  );
};
