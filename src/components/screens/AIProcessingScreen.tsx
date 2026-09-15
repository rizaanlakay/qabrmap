'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Clock,
  Sparkles,
} from 'lucide-react';
import { AIProcessingState, DeviceTelemetry } from '@/types';
import { GravestoneProcessingPipeline } from '@/lib/ai/pipeline';

interface AIProcessingScreenProps {
  capturedImage: string;
  telemetry: DeviceTelemetry;
  onProcessingFinished: (finalState: AIProcessingState) => void;
  onEnterManually: () => void;
  onBack: () => void;
}

export const AIProcessingScreen: React.FC<AIProcessingScreenProps> = ({
  capturedImage,
  telemetry,
  onProcessingFinished,
  onEnterManually,
  onBack,
}) => {
  const [state, setState] = useState<AIProcessingState>({
    step: 'quality',
    quality: 'processing',
    detection: 'pending',
    ocr: 'pending',
    extraction: 'pending',
    positioning: 'pending',
    duplicates: 'pending',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const pipeline = new GravestoneProcessingPipeline({
      stepDelayMs: 400, // Smooth human-readable cadence
    });

    pipeline
      .process(capturedImage, telemetry, (progress) => {
        if (isMounted) setState({ ...progress });
      })
      .then((finalState) => {
        if (isMounted) {
          setTimeout(() => {
            onProcessingFinished(finalState);
          }, 500);
        }
      })
      .catch((err: unknown) => {
        console.error('AI Pipeline error:', err);
        if (isMounted) setError(err instanceof Error ? err.message : 'The photo could not be processed.');
      });

    return () => {
      isMounted = false;
    };
  }, [capturedImage, telemetry, onProcessingFinished]);

  const steps = [
    {
      id: 'quality',
      label: 'Image quality check',
      status: state.quality,
    },
    {
      id: 'detection',
      label: 'Detecting gravestone',
      status: state.detection,
    },
    {
      id: 'ocr',
      label: 'Extracting text (OCR)',
      status: state.ocr,
    },
    {
      id: 'extraction',
      label: 'Identifying details',
      status: state.extraction,
    },
    {
      id: 'positioning',
      label: 'Estimating location',
      status: state.positioning,
    },
    {
      id: 'duplicates',
      label: 'Checking for duplicates',
      status: state.duplicates,
    },
  ];

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
          <span>Processing Photo</span>
          <Sparkles className="w-4 h-4 ml-2 text-emerald-600" />
        </h1>
      </div>

      {/* Checklist matching Mockup Screen 9 */}
      <div className="p-6 flex-1 flex flex-col justify-center max-w-sm mx-auto w-full space-y-6">
        {steps.map((step, idx) => {
          const isComplete = step.status === 'complete';
          const isProcessing = step.status === 'processing';

          return (
            <div key={step.id} className="flex items-center space-x-4">
              {/* Status Icon */}
              <div className="shrink-0">
                {isComplete ? (
                  <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                ) : isProcessing ? (
                  <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center animate-spin">
                    <Loader2 className="w-5 h-5" />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
                    <Clock className="w-4 h-4" />
                  </div>
                )}
              </div>

              {/* Step Label & Status */}
              <div className="flex-1">
                <div
                  className={`text-sm font-semibold transition-colors ${
                    isComplete
                      ? 'text-slate-900'
                      : isProcessing
                      ? 'text-blue-900 font-bold'
                      : 'text-slate-400'
                  }`}
                >
                  {step.label}
                </div>
                <div
                  className={`text-xs capitalize transition-colors ${
                    isComplete
                      ? 'text-emerald-700 font-medium'
                      : isProcessing
                      ? 'text-blue-600 font-medium'
                      : 'text-slate-400'
                  }`}
                >
                  {isProcessing ? 'Processing...' : isComplete ? 'Complete' : 'Waiting...'}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {error ? (
        <div className="p-4 bg-white border-t border-slate-200/80 space-y-3">
          <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start">
            <AlertTriangle className="w-4 h-4 mr-2 shrink-0" />
            <span>
              <b className="font-semibold">The photo couldn&apos;t be read.</b> {error}
            </span>
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
      ) : (
        <div className="p-6 text-center">
          <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
            This may take a few moments. You can continue to use the app.
          </p>
        </div>
      )}
    </div>
  );
};
