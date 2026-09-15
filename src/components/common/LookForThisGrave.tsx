'use client';

import React from 'react';
import Image from 'next/image';

interface LookForThisGraveProps {
  url: string;
  tone?: 'light' | 'dark';
}

// The whole-grave photo taken at capture, so a visitor can match what they see to the pin
export const LookForThisGrave: React.FC<LookForThisGraveProps> = ({ url, tone = 'light' }) => {
  const dark = tone === 'dark';
  return (
    <div className="mt-2 flex items-center space-x-2.5">
      <div className={`w-16 h-12 rounded-lg overflow-hidden relative shrink-0 border ${dark ? 'border-white/30 bg-black/40' : 'border-slate-200 bg-slate-100'}`}>
        <Image src={url} alt="The whole grave" fill className="object-cover" />
      </div>
      <span className={`text-[11px] font-semibold ${dark ? 'text-white/80' : 'text-slate-600'}`}>Look for this grave</span>
    </div>
  );
};
