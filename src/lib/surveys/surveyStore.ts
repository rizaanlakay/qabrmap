import type { DeviceTelemetry, Survey, SurveyCapture, SurveyQueueState } from '@/types';
import { offlineDb, QabrMapDatabase } from '../offline/db';
import { createSaveAttempt } from '../capture/saveMappedGrave';
import { isEligible } from './queueRules';

export interface StartSurveyInput {
  userId: string;
  cemeteryId: string;
  cemeteryName: string;
  sectionNote: string;
}

export interface NewCaptureInput {
  survey: Survey;
  photo: Blob;
  thumbnail: string;
  telemetry: DeviceTelemetry;
  insideBoundary: boolean;
}

const newestFirst = <T extends { startedAt?: string; createdAt?: string }>(a: T, b: T) =>
  (b.startedAt ?? b.createdAt ?? '').localeCompare(a.startedAt ?? a.createdAt ?? '');

// Surveys and their captures on this phone. The ids and clock are passed in so tests are repeatable.
export class SurveyStore {
  constructor(
    private readonly db: QabrMapDatabase,
    private readonly newId: () => string = () => crypto.randomUUID(),
    private readonly clock: () => Date = () => new Date()
  ) {}

  // At most one active survey per surveyor on a phone, so starting again returns the one already running
  async startSurvey(input: StartSurveyInput): Promise<Survey> {
    return this.db.transaction('rw', this.db.surveys, async () => {
      const active = await this.activeSurvey(input.userId);
      if (active) return active;
      const survey: Survey = {
        id: `survey_${this.newId()}`,
        userId: input.userId,
        cemeteryId: input.cemeteryId,
        cemeteryName: input.cemeteryName,
        sectionNote: input.sectionNote.trim(),
        startedAt: this.clock().toISOString(),
        status: 'ACTIVE',
      };
      await this.db.surveys.add(survey);
      return survey;
    });
  }

  async finishSurvey(surveyId: string): Promise<Survey | undefined> {
    await this.db.surveys.update(surveyId, { status: 'COMPLETED', completedAt: this.clock().toISOString() });
    return this.db.surveys.get(surveyId);
  }

  getSurvey(surveyId: string): Promise<Survey | undefined> {
    return this.db.surveys.get(surveyId);
  }

  activeSurvey(userId: string): Promise<Survey | undefined> {
    return this.db.surveys.where('userId').equals(userId).filter((survey) => survey.status === 'ACTIVE').first();
  }

  async listSurveys(userId: string): Promise<Survey[]> {
    return (await this.db.surveys.where('userId').equals(userId).toArray()).sort(newestFirst);
  }

  async updateSurvey(surveyId: string, changes: Partial<Survey>): Promise<void> {
    await this.db.surveys.update(surveyId, changes);
  }

  async addCapture(input: NewCaptureInput): Promise<SurveyCapture> {
    const capture: SurveyCapture = {
      id: `capture_${this.newId()}`,
      surveyId: input.survey.id,
      userId: input.survey.userId,
      cemeteryId: input.survey.cemeteryId,
      createdAt: this.clock().toISOString(),
      photo: input.photo,
      thumbnail: input.thumbnail,
      telemetry: input.telemetry,
      insideBoundary: input.insideBoundary,
      status: 'queued',
      readAttempts: 0,
      saveFailures: 0,
      manualRetries: 0,
      nextAttemptAt: 0,
      // Made now, so every retry of this capture's save uses the same grave and person ids
      attempt: createSaveAttempt(this.newId),
    };
    await this.db.surveyCaptures.add(capture);
    return capture;
  }

  getCapture(id: string): Promise<SurveyCapture | undefined> {
    return this.db.surveyCaptures.get(id);
  }

  async listCaptures(surveyId: string): Promise<SurveyCapture[]> {
    return (await this.db.surveyCaptures.where('surveyId').equals(surveyId).toArray()).sort(newestFirst);
  }

  async userCaptures(userId: string): Promise<SurveyCapture[]> {
    return (await this.db.surveyCaptures.where('userId').equals(userId).toArray()).sort(newestFirst);
  }

  async updateCapture(id: string, changes: Partial<SurveyCapture>): Promise<void> {
    await this.db.surveyCaptures.update(id, changes);
  }

  async deleteCapture(id: string): Promise<void> {
    await this.db.surveyCaptures.delete(id);
  }

  async eligibleCaptures(userId: string, now: number): Promise<SurveyCapture[]> {
    const captures = await this.db.surveyCaptures
      .where('userId')
      .equals(userId)
      .filter((capture) => isEligible(capture, userId, now))
      .toArray();
    return captures.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async earliestNextAttempt(userId: string): Promise<number | null> {
    const waiting = await this.db.surveyCaptures
      .where('userId')
      .equals(userId)
      .filter((capture) => capture.status === 'queued' || capture.status === 'saving')
      .toArray();
    return waiting.length ? Math.min(...waiting.map((capture) => capture.nextAttemptAt)) : null;
  }

  // A read cut off by the app closing is read again; its attempt was already counted
  async resetInterruptedReads(userId: string): Promise<number> {
    return this.db.surveyCaptures
      .where('userId')
      .equals(userId)
      .filter((capture) => capture.status === 'reading')
      .modify({ status: 'queued' });
  }

  async getQueueState(userId: string): Promise<SurveyQueueState> {
    return (await this.db.surveyQueueState.get(userId)) ?? { userId, consecutiveFailures: 0, pausedForErrors: false };
  }

  async setQueueState(state: SurveyQueueState): Promise<void> {
    await this.db.surveyQueueState.put(state);
  }
}

export const surveyStore = new SurveyStore(offlineDb);
