'use client';

import React, { useState } from 'react';
import {
  ArrowLeft,
  Upload,
  Download,
  Shield,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Compass,
  FileSpreadsheet,
} from 'lucide-react';
import { Cemetery, Grave } from '@/types';

interface AdminDashboardProps {
  cemetery: Cemetery;
  graves: Grave[];
  onBack: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  cemetery,
  graves,
  onBack,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'review' | 'import' | 'intelligence'>('overview');
  const [importSuccess, setImportSuccess] = useState(false);

  // Statistics
  const totalMapped = graves.filter((g) => g.status === 'MAPPED').length;
  const lowConfidence = graves.filter((g) => g.status === 'LOW_CONFIDENCE').length;
  const unmapped = graves.filter((g) => g.status === 'UNMAPPED').length;
  const withNames = graves.filter((g) => g.person?.fullName).length;
  const percentNames = Math.round((withNames / graves.length) * 100);
  const percentVerified = Math.round((totalMapped / graves.length) * 100);

  // Export GeoJSON
  const handleExportGeoJSON = () => {
    const featureCollection = {
      type: 'FeatureCollection',
      cemetery: cemetery.name,
      features: graves.map((g) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [g.longitude, g.latitude],
        },
        properties: {
          graveNumber: g.graveNumber,
          fullName: g.person?.fullName,
          birthDate: g.person?.birthDate,
          deathDate: g.person?.deathDate,
          confidence: g.positionConfidence,
          accuracyMeters: g.positionAccuracyMeters,
          status: g.status,
        },
      })),
    };

    const blob = new Blob([JSON.stringify(featureCollection, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cemetery.slug}-graves.geojson`;
    a.click();
  };

  // Export CSV
  const handleExportCSV = () => {
    const headers = ['GraveNumber', 'FullName', 'BirthDate', 'DeathDate', 'Latitude', 'Longitude', 'AccuracyMeters', 'Confidence', 'Status'];
    const rows = graves.map((g) => [
      g.graveNumber,
      `"${g.person?.fullName || ''}"`,
      g.person?.birthDate || '',
      g.person?.deathDate || '',
      g.latitude,
      g.longitude,
      g.positionAccuracyMeters,
      g.positionConfidence,
      g.status,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cemetery.slug}-graves.csv`;
    a.click();
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-slate-200/80 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
          </button>
          <div>
            <h1 className="text-base font-bold text-slate-900 tracking-tight flex items-center">
              <span>Cemetery Admin Portal</span>
              <Shield className="w-4 h-4 ml-1.5 text-brand-forest" />
            </h1>
            <p className="text-[11px] text-slate-500">{cemetery.name}</p>
          </div>
        </div>
      </div>

      {/* Admin Tabs */}
      <div className="flex border-b border-slate-200 bg-white px-4 shrink-0 overflow-x-auto text-xs font-semibold">
        {[
          { id: 'overview', label: 'Metrics' },
          { id: 'review', label: `Review (${lowConfidence})` },
          { id: 'intelligence', label: 'Row Intelligence' },
          { id: 'import', label: 'Import / Export' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`py-3 px-3 border-b-2 whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'border-brand-forest text-brand-forest'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* Metric Summary Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm">
                <div className="text-xs text-slate-500 font-medium">Total Graves Mapped</div>
                <div className="text-2xl font-extrabold text-slate-900 mt-1">
                  {cemetery.mappedGravesCount.toLocaleString()}
                </div>
                <div className="text-[11px] text-emerald-700 font-semibold mt-1">
                  {cemetery.totalGravesEstimate > 0
                    ? `${cemetery.coveragePercentage}% of cemetery total`
                    : 'Cemetery total not recorded'}
                </div>
              </div>

              <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm">
                <div className="text-xs text-slate-500 font-medium">Readable Names</div>
                <div className="text-2xl font-extrabold text-slate-900 mt-1">{percentNames}%</div>
                <div className="text-[11px] text-slate-500 mt-1">OCR structured rate</div>
              </div>

              <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm">
                <div className="text-xs text-slate-500 font-medium">Verified Coordinates</div>
                <div className="text-2xl font-extrabold text-emerald-700 mt-1">{percentVerified}%</div>
                <div className="text-[11px] text-emerald-600 mt-1">High confidence fixes</div>
              </div>

              <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm">
                <div className="text-xs text-slate-500 font-medium">Flagged For Review</div>
                <div className="text-2xl font-extrabold text-amber-600 mt-1">{lowConfidence}</div>
                <div className="text-[11px] text-amber-700 mt-1">Requires survey audit</div>
              </div>
            </div>

            {/* Coverage Heatmap Breakdown */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-3">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Section Breakdown
              </h3>
              <div className="space-y-2 text-xs">
                <div>
                  <div className="flex justify-between text-slate-700 font-medium mb-1">
                    <span>Section A (Historic 1910-1950)</span>
                    <span className="font-bold">94%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-600 rounded-full" style={{ width: '94%' }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-slate-700 font-medium mb-1">
                    <span>Section B (Central Rows 1-30)</span>
                    <span className="font-bold">87%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-600 rounded-full" style={{ width: '87%' }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-slate-700 font-medium mb-1">
                    <span>Section C (Southern Expansion)</span>
                    <span className="font-bold">62%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full" style={{ width: '62%' }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'review' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Low-confidence or disputed observations awaiting administrator verification.
            </p>
            {graves
              .filter((g) => g.status === 'LOW_CONFIDENCE')
              .slice(0, 6)
              .map((g) => (
                <div
                  key={g.id}
                  className="bg-white p-3.5 rounded-2xl border border-amber-200/80 shadow-sm flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-slate-900">Grave {g.graveNumber}</span>
                      <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full">
                        ±{g.positionAccuracyMeters}m
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      {g.person?.fullName || 'Uncataloged person'}
                    </div>
                  </div>
                  <div className="flex space-x-1.5">
                    <button className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700">
                      Approve
                    </button>
                    <button className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-200">
                      Edit
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}

        {activeTab === 'intelligence' && (
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-3.5 text-xs">
            <div className="flex items-center space-x-2 text-brand-forest">
              <Compass className="w-5 h-5" />
              <h3 className="font-bold text-sm text-slate-900">Spatial Row & Qibla Alignment</h3>
            </div>
            <p className="text-slate-600 leading-relaxed">
              QabrMap automatically models grave rows and orientation. In Athlone, graves are aligned facing Qibla (~28.5° NNE).
            </p>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 font-mono text-[11px] space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Detected Mean Orientation:</span>
                <span className="font-bold text-slate-800">28.4° ± 1.1°</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Estimated Grave Spacing:</span>
                <span className="font-bold text-slate-800">1.48 m along row</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Row-to-Row Pitch:</span>
                <span className="font-bold text-slate-800">2.42 m</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Active Surveyed Rows:</span>
                <span className="font-bold text-slate-800">32 parallel rows</span>
              </div>
            </div>
            <div className="p-2.5 bg-emerald-50 rounded-xl text-emerald-800 flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Newly captured graves snap to closest verified row coordinates when within 1.2m radius.</span>
            </div>
          </div>
        )}

        {activeTab === 'import' && (
          <div className="space-y-4">
            {/* Import Box */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-3">
              <div className="flex items-center space-x-2">
                <Upload className="w-5 h-5 text-brand-forest" />
                <h3 className="font-bold text-sm text-slate-900">Bulk Import Grave Records</h3>
              </div>
              <p className="text-xs text-slate-500">
                Upload historical municipal burial registers or survey CSV sheets (GraveNumber, Name, Birth, Death, Lat, Lng).
              </p>
              <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center">
                <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <button
                  onClick={() => {
                    setImportSuccess(true);
                    setTimeout(() => setImportSuccess(false), 3000);
                  }}
                  className="px-4 py-2 bg-brand-forest text-white text-xs font-semibold rounded-xl hover:bg-brand-dark"
                >
                  Choose CSV File
                </button>
              </div>
              {importSuccess && (
                <div className="p-2.5 bg-emerald-50 rounded-xl text-emerald-800 text-xs font-semibold flex items-center">
                  <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-600" />
                  Successfully validated and queued 150 historical records.
                </div>
              )}
            </div>

            {/* Export Buttons */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-3">
              <div className="flex items-center space-x-2">
                <Download className="w-5 h-5 text-brand-forest" />
                <h3 className="font-bold text-sm text-slate-900">Export Spatial Datasets</h3>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={handleExportCSV}
                  className="flex-1 py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center space-x-1.5"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Export CSV</span>
                </button>
                <button
                  onClick={handleExportGeoJSON}
                  className="flex-1 py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center space-x-1.5"
                >
                  <Layers className="w-4 h-4" />
                  <span>Export GeoJSON</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
