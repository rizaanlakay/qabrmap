'use client';

import React from 'react';
import { Wifi, WifiOff, BatteryMedium } from 'lucide-react';

interface StatusBarProps {
  isOffline?: boolean;
  onToggleOffline?: () => void;
  dark?: boolean;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  isOffline = false,
  onToggleOffline,
  dark = false,
}) => {
  return (
    <div
      className={`w-full px-5 pt-2.5 pb-1.5 flex items-center justify-between text-xs font-semibold select-none z-40 transition-colors ${
        dark ? 'text-white' : 'text-slate-800'
      }`}
    >
      <span>9:41</span>

      <div className="flex items-center space-x-2.5">
        <button
          onClick={onToggleOffline}
          title={isOffline ? 'Offline mode active (Click to toggle)' : 'Online (Click to simulate offline)'}
          className="flex items-center space-x-1 focus:outline-none"
        >
          {isOffline ? (
            <span className="flex items-center text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded text-[10px] font-bold">
              <WifiOff className="w-3.5 h-3.5 mr-1" /> Offline
            </span>
          ) : (
            <Wifi className="w-3.5 h-3.5 opacity-80" />
          )}
        </button>
        <span className="text-[10px] opacity-75">5G</span>
        <BatteryMedium className="w-4 h-4 opacity-80" />
      </div>
    </div>
  );
};
