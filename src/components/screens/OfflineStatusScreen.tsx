'use client';

import React, { useState } from 'react';
import {
  ArrowLeft,
  WifiOff,
  Camera,
  Map,
  Search,
  ClipboardList,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';

interface OfflineStatusScreenProps {
  pendingUploadCount?: number;
  onContinue: () => void;
  onTriggerSync: () => Promise<void>;
  onBack: () => void;
}

export const OfflineStatusScreen: React.FC<OfflineStatusScreenProps> = ({
  pendingUploadCount = 3,
  onContinue,
  onTriggerSync,
  onBack,
}) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const handleSyncClick = async () => {
    setIsSyncing(true);
    setSyncStatus('Connecting to server...');
    try {
      await onTriggerSync();
      setSyncStatus('Sync complete! All records backed up.');
    } catch {
      setSyncStatus('Still offline. Data remains safely queued.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden justify-between">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-slate-200/80 flex items-center shrink-0">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-colors mr-2"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">Offline Mode</h1>
      </div>

      {/* Main Illustration and Checklist matching Mockup Screen 12 */}
      <div className="p-6 flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full">
        {/* Disconnected Wi-Fi Icon */}
        <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 mb-5 shadow-inner">
          <WifiOff className="w-10 h-10 stroke-[2]" />
        </div>

        {/* Heading & Explanation */}
        <h2 className="text-xl font-bold text-slate-900 text-center">You are offline</h2>
        <p className="text-xs text-slate-500 text-center leading-relaxed mt-2 max-w-[260px]">
          Your data is saved on this device and will sync when you are back online.
        </p>

        {/* Offline Capability Status Cards matching Screen 12 */}
        <div className="w-full mt-6 space-y-3">
          <div className="flex items-center space-x-3.5 bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <Camera className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-slate-800">
              {pendingUploadCount} photos pending upload
            </span>
          </div>

          <div className="flex items-center space-x-3.5 bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <Map className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-slate-800">
              Cemetery map available
            </span>
          </div>

          <div className="flex items-center space-x-3.5 bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <Search className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-slate-800">
              Search works offline
            </span>
          </div>

          <div className="flex items-center space-x-3.5 bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <ClipboardList className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-slate-800">
              Your surveys are saved
            </span>
          </div>
        </div>

        {syncStatus && (
          <div className="mt-4 text-xs font-medium text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-200 flex items-center">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
            <span>{syncStatus}</span>
          </div>
        )}
      </div>

      {/* Action Buttons & Sync Status Footer matching Screen 12 */}
      <div className="p-5 bg-white border-t border-slate-200/80 space-y-2.5 shrink-0">
        <button
          onClick={onContinue}
          className="w-full py-3.5 px-4 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold shadow-md transition-all active:scale-[0.99]"
        >
          Continue
        </button>

        <button
          onClick={handleSyncClick}
          disabled={isSyncing}
          className="w-full py-3 px-4 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-center space-x-2 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
        </button>

        <div className="text-center pt-1 text-[11px] text-slate-400 font-medium">
          Last synced: 12 Sep 2026, 08:14
        </div>
      </div>
    </div>
  );
};
