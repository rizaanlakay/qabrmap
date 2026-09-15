'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Cloud, Loader2 } from 'lucide-react';
import { Cemetery, Survey, SurveyCapture } from '@/types';
import { surveyStore } from '@/lib/surveys/surveyStore';
import {
  beginSurvey,
  discardSurveyCapture,
  endSurvey,
  isStoragePersisted,
  listCloudSurveys,
  retrySurveyCapture,
  surveyQueue,
} from '@/lib/surveys/surveyQueue';
import { useLiveValue, useQueueActivity } from '@/lib/surveys/useSurveyData';
import { countCaptures, surveyStatusLine } from '@/lib/surveys/queueRules';
import { CloudSurveySummary } from '@/lib/surveys/queueAdapters';
import { StartSurveyCard } from '@/components/surveys/StartSurveyCard';
import { SurveySummaryCard } from '@/components/surveys/SurveySummaryCard';
import { OpenGraveResult, SurveyCaptureList } from '@/components/surveys/SurveyCaptureList';

interface SurveySessionScreenProps {
  userId: string;
  cemeteries: Cemetery[];
  onContinueSurvey: (survey: Survey) => void;
  onReviewCapture: (capture: SurveyCapture) => void;
  onOpenGrave: (graveId: string) => Promise<OpenGraveResult>;
  onBack: () => void;
}

const formatDay = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

export const SurveySessionScreen: React.FC<SurveySessionScreenProps> = ({
  userId,
  cemeteries,
  onContinueSurvey,
  onReviewCapture,
  onOpenGrave,
  onBack,
}) => {
  // null while loading, undefined when there is no active survey
  const active = useLiveValue<Survey | undefined | null>(() => surveyStore.activeSurvey(userId), [userId], null);
  const surveys = useLiveValue<Survey[]>(() => surveyStore.listSurveys(userId), [userId], []);
  const allCaptures = useLiveValue<SurveyCapture[]>(() => surveyStore.userCaptures(userId), [userId], []);
  const activity = useQueueActivity();

  const [viewingId, setViewingId] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const [cloudSurveys, setCloudSurveys] = useState<CloudSurveySummary[]>([]);

  const viewing = surveys.find((survey) => survey.id === viewingId) ?? null;
  const shown = viewing ?? active ?? null;
  const captures = useMemo(() => allCaptures.filter((capture) => capture.surveyId === shown?.id), [allCaptures, shown?.id]);
  const counts = countCaptures(captures);

  const activeId = active?.id;
  useEffect(() => {
    if (!activeId) return;
    isStoragePersisted().then((persisted) => setStorageWarning(!persisted));
  }, [activeId]);

  // Surveys made on another phone appear with their counts only
  useEffect(() => {
    let cancelled = false;
    listCloudSurveys(userId).then((rows) => {
      if (!cancelled) setCloudSurveys(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleStart = async (cemetery: Cemetery, sectionNote: string) => {
    const { persisted } = await beginSurvey({ userId, cemeteryId: cemetery.id, cemeteryName: cemetery.name, sectionNote });
    setStorageWarning(!persisted);
  };

  const phoneSurveyIds = new Set(surveys.map((survey) => survey.id));
  const pastSurveys = surveys.filter((survey) => survey.status === 'COMPLETED');
  const otherPhoneSurveys = cloudSurveys.filter((survey) => !phoneSurveyIds.has(survey.id));

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-y-auto">
      <div className="px-4 py-3 bg-white border-b border-slate-200/80 flex items-center shrink-0">
        <button
          onClick={() => (viewing ? setViewingId(null) : onBack())}
          className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-colors mr-2"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">{viewing ? 'Past Survey' : 'My Surveys'}</h1>
      </div>

      <div className="p-4 space-y-4 flex-1">
        {active === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
          </div>
        ) : shown ? (
          <>
            <SurveySummaryCard
              survey={shown}
              counts={counts}
              statusLine={surveyStatusLine(activity, counts)}
              paused={activity === 'paused'}
              storageWarning={storageWarning}
              onResume={() => void surveyQueue.resume()}
              onContinue={shown.status === 'ACTIVE' ? () => onContinueSurvey(shown) : undefined}
              onFinish={shown.status === 'ACTIVE' ? () => void endSurvey(shown.id) : undefined}
            />
            <SurveyCaptureList
              captures={captures}
              onReview={onReviewCapture}
              onOpenGrave={onOpenGrave}
              onRetry={(capture) => void retrySurveyCapture(capture)}
              onDiscard={(capture) => void discardSurveyCapture(capture.id)}
            />
          </>
        ) : (
          <>
            <StartSurveyCard cemeteries={cemeteries} onStart={handleStart} />

            {(pastSurveys.length > 0 || otherPhoneSurveys.length > 0) && (
              <div>
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2.5 px-1">Past surveys</h3>
                <ul className="space-y-2">
                  {pastSurveys.map((survey) => {
                    const surveyCounts = countCaptures(allCaptures.filter((capture) => capture.surveyId === survey.id));
                    return (
                      <li key={survey.id}>
                        <button
                          onClick={() => setViewingId(survey.id)}
                          className="w-full bg-white rounded-xl p-3 border border-slate-200/80 shadow-sm flex items-center justify-between text-left"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 truncate">{survey.cemeteryName}</div>
                            <div className="text-[11px] text-slate-500">
                              {formatDay(survey.startedAt)}
                              {survey.sectionNote ? ` • ${survey.sectionNote}` : ''} • {surveyCounts.saved} saved
                              {surveyCounts.review ? `, ${surveyCounts.review} to review` : ''}
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                        </button>
                      </li>
                    );
                  })}
                  {otherPhoneSurveys.map((survey) => (
                    <li key={survey.id} className="bg-white rounded-xl p-3 border border-slate-200/80 shadow-sm flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 truncate">{survey.cemeteryName}</div>
                        <div className="text-[11px] text-slate-500">
                          {formatDay(survey.startedAt)} • {survey.counts.saved} saved of {survey.counts.captured}
                        </div>
                      </div>
                      <span className="flex items-center text-[10px] text-slate-400 shrink-0 pl-2">
                        <Cloud className="w-3 h-3 mr-1" />
                        Another phone
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
