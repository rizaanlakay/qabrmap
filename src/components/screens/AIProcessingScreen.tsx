'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import { AIStructuredExtraction } from '@/types';
import { requestStoneReading } from '@/lib/capture/requestStoneReading';

interface AIProcessingScreenProps {
  capturedImage: string;
  onProcessingFinished: (extraction: AIStructuredExtraction) => void;
  onEnterManually: () => void;
  onBack: () => void;
}

// Sends the photo to be read, then hands the details to the Confirm screen
export const AIProcessingScreen: React.FC<AIProcessingScreenProps> = ({
  capturedImage,
  onProcessingFinished,
  onEnterManually,
  onBack,
}) => {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    requestStoneReading(capturedImage, controller.signal)
      .then((extraction) => {
        if (isMounted) onProcessingFinished(extraction);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "The photo couldn't be read. Try again or enter the details manually.");
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [capturedImage, onProcessingFinished]);

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
        <h1 className="text-lg font-bold text-slate-900 tracking-tight flex items-center">
          <span>Reading Photo</span>
          <Sparkles className="w-4 h-4 ml-2 text-emerald-600" />
        </h1>
      </div>

      <div className="p-6 flex-1 flex flex-col items-center justify-center text-center max-w-sm mx-auto w-full">
        {error ? (
          <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
        ) : (
          <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}
        <p className="mt-4 text-sm font-bold text-slate-900">
          {error ? 'The details could not be read' : 'Reading the stone'}
        </p>
        <p className="mt-1 text-xs text-slate-500 leading-relaxed">
          {error ? 'You can take the photo again, or type the details in yourself.' : 'This usually takes a few seconds.'}
        </p>
      </div>

      {error && (
        <div className="p-4 bg-white border-t border-slate-200/80 space-y-3">
          <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
            {error}
          </div>
          <div className="flex space-x-3">
            <button
              onClick={onBack}
              className="flex-1 py-3 px-4 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Retake
            </button>
            <button
              onClick={onEnterManually}
              className="flex-1 py-3 px-4 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold shadow-md transition-all"
            >
              Enter details manually
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
