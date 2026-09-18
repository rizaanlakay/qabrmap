'use client';

import React from 'react';
import Image from 'next/image';
import { PlusSquare, Share, X } from 'lucide-react';
import { InstallPlatform } from '@/lib/pwa/installPrompt';

interface InstallAppCardProps {
  platform: Exclude<InstallPlatform, 'unsupported'>;
  onInstall: () => void;
  onDismiss: () => void;
}

export const InstallAppCard: React.FC<InstallAppCardProps> = ({ platform, onInstall, onDismiss }) => {
  return (
    <div
      role="dialog"
      aria-labelledby="install-app-title"
      className="absolute inset-x-3 bottom-3 z-40 bg-white rounded-2xl border border-slate-200/80 shadow-float p-3.5"
    >
      <div className="flex items-start">
        <Image
          src="/icons/icon-192.png"
          alt=""
          width={44}
          height={44}
          className="w-11 h-11 rounded-xl shrink-0 shadow-sm"
        />
        <div className="ml-3 flex-1 min-w-0">
          <h3 id="install-app-title" className="text-sm font-bold text-slate-900">
            Install Ta&apos;awun Qabr Map
          </h3>
          {platform === 'native' ? (
            <p className="text-xs text-slate-500 mt-0.5">
              Add it to your home screen to open it full screen, quickly, when you&apos;re at the cemetery.
            </p>
          ) : (
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Tap{' '}
              <Share className="inline w-3.5 h-3.5 -mt-0.5 text-blue-600" aria-label="Share" />{' '}
              <span className="font-semibold text-slate-700">Share</span>, then{' '}
              <PlusSquare className="inline w-3.5 h-3.5 -mt-0.5 text-slate-700" aria-hidden="true" />{' '}
              <span className="font-semibold text-slate-700">Add to Home Screen</span>.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-2 -mt-1 -mr-1 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors shrink-0"
          aria-label="Dismiss install offer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {platform === 'native' ? (
        <div className="mt-3 flex space-x-2">
          <button
            type="button"
            onClick={onDismiss}
            className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onInstall}
            className="flex-1 py-2.5 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold shadow-md active:scale-[0.99] transition-all"
          >
            Install
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onDismiss}
          className="mt-3 w-full py-2.5 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold shadow-md active:scale-[0.99] transition-all"
        >
          Got it
        </button>
      )}
    </div>
  );
};
