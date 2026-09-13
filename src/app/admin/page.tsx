'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AdminDashboard } from '@/components/admin/AdminDashboard';
import { dataStore } from '@/lib/data/store';
import { Cemetery, Grave } from '@/types';
import { Loader2 } from 'lucide-react';

export default function AdminPage() {
  const router = useRouter();
  const [cemeteries, setCemeteries] = useState<Cemetery[]>([]);
  const [selectedCemetery, setSelectedCemetery] = useState<Cemetery | null>(null);
  const [graves, setGraves] = useState<Grave[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
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
    loadData();
  }, []);

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

  if (loading && !selectedCemetery) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-white p-6">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mb-3" />
        <p className="text-sm font-medium">Loading QabrMap Admin Portal...</p>
      </div>
    );
  }

  if (!selectedCemetery) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-white p-6 text-center">
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

  return (
    <div className="w-full h-full flex flex-col bg-slate-900">
      {/* Top Cemetery Switcher for Admin */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-2.5 flex items-center justify-between text-xs text-white">
        <span className="font-semibold text-emerald-400 uppercase tracking-wider text-[11px]">
          Admin Portal
        </span>
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
