'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AdminDashboard } from '@/components/admin/AdminDashboard';
import { dataStore } from '@/lib/data/store';
import { Cemetery, Grave } from '@/types';
import { Loader2, ShieldAlert, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { DEFAULT_ADMIN_EMAIL } from '@/lib/auth/admin';

export default function AdminPage() {
  const router = useRouter();
  const { user, loading: authLoading, isAdmin, openAuthModal } = useAuth();
  const [cemeteries, setCemeteries] = useState<Cemetery[]>([]);
  const [selectedCemetery, setSelectedCemetery] = useState<Cemetery | null>(null);
  const [graves, setGraves] = useState<Grave[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      if (!isAdmin) return;

      const cList = await dataStore.getCemeteries();
      setCemeteries(cList);
      if (cList.length > 0) {
        const primary = cList.find((c) => c.id === 'cem_athlone') || cList[0];
        setSelectedCemetery(primary);
        const gList = await dataStore.getGraves(primary.id);
        setGraves(gList);
      }
      setLoading(false);
    }

    if (!authLoading) {
      if (isAdmin) {
        loadData();
      } else {
        setLoading(false);
      }
    }
  }, [authLoading, isAdmin]);

  const handleCemeteryChange = async (cemeteryId: string) => {
    const cem = cemeteries.find((c) => c.id === cemeteryId);
    if (cem) {
      setSelectedCemetery(cem);
      setLoading(true);
      const gList = await dataStore.getGraves(cem.id);
      setGraves(gList);
      setLoading(false);
    }
  };

  // 1. Loading Authentication State
  if (authLoading || (isAdmin && loading && !selectedCemetery)) {
    return (
      <div className="w-full h-full min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-6">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mb-3" />
        <p className="text-sm font-medium">Verifying Administrator Access...</p>
      </div>
    );
  }

  // 2. Access Restricted for Non-Admin Users
  if (!isAdmin) {
    return (
      <div className="w-full h-full min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mb-4">
          <ShieldAlert className="w-8 h-8 text-rose-400" />
        </div>
        <h1 className="text-xl font-bold text-white mb-2">Administrator Access Restricted</h1>
        <p className="text-xs text-slate-400 max-w-sm mb-6 leading-relaxed">
          The QabrMap Administration Portal is reserved exclusively for authorized administrators ({DEFAULT_ADMIN_EMAIL}).
          {user ? (
            <span className="block mt-2 text-slate-500">
              Signed in as: <b className="text-slate-300">{user.email}</b> (Standard Member)
            </span>
          ) : (
            <span className="block mt-2 text-slate-500">
              Please sign in with your administrator credentials to proceed.
            </span>
          )}
        </p>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to App</span>
          </button>
          {!user && (
            <button
              onClick={openAuthModal}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors"
            >
              Sign In as Admin
            </button>
          )}
        </div>
      </div>
    );
  }

  // 3. Fallback if no cemetery data is available
  if (!selectedCemetery) {
    return (
      <div className="w-full h-full min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-6 text-center">
        <p className="text-sm mb-4">No cemetery data found.</p>
        <button
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold"
        >
          Return to App
        </button>
      </div>
    );
  }

  // 4. Authorized Administrator Dashboard
  return (
    <div className="w-full h-full min-h-screen flex flex-col bg-slate-900">
      {/* Top Cemetery Switcher for Admin */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-2.5 flex items-center justify-between text-xs text-white">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => router.push('/')}
            className="text-slate-400 hover:text-white p-1 rounded transition-colors mr-1"
            title="Return to App"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="font-semibold text-emerald-400 uppercase tracking-wider text-[11px]">
            Admin Portal
          </span>
          <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800/60 px-1.5 py-0.5 rounded font-mono">
            {DEFAULT_ADMIN_EMAIL}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-slate-400 text-[11px]">Cemetery:</span>
          <select
            value={selectedCemetery.id}
            onChange={(e) => handleCemeteryChange(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-400"
          >
            {cemeteries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <AdminDashboard
          cemetery={selectedCemetery}
          graves={graves}
          onBack={() => router.push('/')}
        />
      </div>
    </div>
  );
}
