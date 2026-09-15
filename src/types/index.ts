// Core TypeScript domain models for QabrMap
import type { MatchCandidate } from '../lib/graves/matchCandidate';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export type GraveStatus = 'MAPPED' | 'LOW_CONFIDENCE' | 'UNMAPPED' | 'VERIFIED' | 'DISPUTED';

export type IssueType =
  | 'WRONG_PERSON'
  | 'WRONG_GRAVE'
  | 'WRONG_GPS'
  | 'UNREADABLE_STONE'
  | 'DUPLICATE_GRAVE'
  | 'INCORRECT_DATE'
  | 'INCORRECT_NAME'
  | 'RELOCATED'
  | 'DAMAGED'
  | 'OTHER';

export interface Cemetery {
  id: string;
  name: string;
  slug: string;
  description: string;
  country: string;
  province: string;
  city: string;
  denomination: string;
  contactPhone?: string;
  contactEmail?: string;
  originLat: number;
  originLng: number;
  originAlt?: number;
  entranceLat?: number;
  entranceLng?: number;
  entranceName?: string;
  boundary?: GeoJSON.Polygon;
  totalGravesEstimate: number;
  mappedGravesCount: number;
  coveragePercentage: number;
  distanceKm?: number;
  thumbnailUrl?: string;
}

export interface CemeterySection {
  id: string;
  cemeteryId: string;
  name: string;
  code: string;
  qiblaBearingDegrees: number;
  rowCount: number;
  notes?: string;
}

export interface Person {
  id: string;
  firstName: string;
  middleNames?: string;
  surname: string;
  fullName: string;
  nickname?: string;
  gender?: 'male' | 'female' | 'unknown';
  birthDate?: string; // YYYY-MM-DD
  deathDate?: string; // YYYY-MM-DD
  burialDate?: string;
  ageYears?: number;
  familyRelationship?: string;
  notes?: string;
}

export interface Grave {
  id: string;
  cemeteryId: string;
  cemeteryName?: string;
  sectionId?: string;
  sectionName?: string;
  personId?: string;
  person?: Person;
  graveNumber: string;
  plotNumber?: string;
  rowNumber?: string;
  latitude: number;
  longitude: number;
  estimatedAltitude?: number;
  localX?: number;
  localY?: number;
  localZ?: number;
  positionAccuracyMeters: number;
  positionConfidence: ConfidenceLevel;
  orientationDegrees?: number;
  status: GraveStatus;
  primaryPhotoUrl?: string;
  photoCount: number;
  // Whole-grave photo shown as "Look for this grave" while navigating
  gravePhotoUrl?: string;
  // Independent GPS observations the position is averaged from; 0 or missing for seeded graves
  observationCount?: number;
  lastVerifiedAt?: string;
  // The account that mapped this grave; only they can delete it
  createdBy?: string;
  relationship?: GraveRelationship;
  createdAt: string;
  updatedAt: string;
}

// stone: the gravestone. grave: the whole grave, a visual clue for visitors
export type GravePhotoKind = 'stone' | 'grave';

export interface GravePhoto {
  id: string;
  graveId: string;
  url: string;
  storagePath?: string;
  uploadedBy?: string;
  isPrimary: boolean;
  kind: GravePhotoKind;
  capturedAt?: string;
  createdAt: string;
}

export type RelationshipCategory = 'family' | 'friend' | 'coworker' | 'mentor' | 'other';

export interface GraveRelationship {
  graveId: string;
  category: RelationshipCategory;
  specificRelation: string; // e.g. "Father", "Mother", "Grandparent", "Close Friend", "Coworker"
  notes?: string;
  savedAt: string;
}

export interface DeviceTelemetry {
  latitude: number;
  longitude: number;
  altitude?: number;
  gpsAccuracy: number;
  headingDegrees?: number;
  headingAccuracy?: number;
  pitch?: number;
  roll?: number;
  deviceOrientation?: string;
  timestamp: string;
  timezone?: string;
  imageDimensions?: { width: number; height: number };
  exifData?: Record<string, unknown>;
}

export interface GravestoneBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Grave details read from a photo, used to fill in the Confirm screen
export interface AIStructuredExtraction {
  graveNumber: string;
  firstName: string;
  middleNames: string[];
  surname: string;
  nickname?: string;
  fullName: string;
  birthDate?: string;
  deathDate?: string;
  burialDate?: string;
  gender?: 'male' | 'female';
  confidence: number;
  rawOcrText: string;
  otherText: string[];
  fieldConfidences: {
    graveNumber: number;
    fullName: number;
    dates: number;
  };
}

// A survey of one cemetery on this phone. Its captures live on the phone until they become graves.
export type SurveyStatus = 'ACTIVE' | 'COMPLETED';

export interface SurveyCounts {
  captured: number;
  saved: number;
  pending: number;
  review: number;
}

export interface Survey {
  id: string;
  userId: string;
  cemeteryId: string;
  cemeteryName: string;
  sectionNote: string;
  startedAt: string;
  completedAt?: string;
  status: SurveyStatus;
  // Last successful write to survey_sessions, and the counts it wrote
  cloudSyncedAt?: string;
  cloudCounts?: SurveyCounts;
}

export type CaptureStatus = 'queued' | 'reading' | 'saving' | 'review' | 'saved' | 'failed';

export type ReviewReason = 'no-name' | 'low-confidence' | 'outside-cemetery' | 'possible-duplicate' | 'unreadable';

// Same shape as SaveAttempt, stored so a retried save reuses its ids and uploaded photo
export interface CaptureSaveAttempt {
  graveId: string;
  personId: string;
  upload?: { publicUrl: string; path: string };
}

export interface SurveyCapture {
  id: string;
  surveyId: string;
  userId: string;
  cemeteryId: string;
  createdAt: string;
  // JPEG, long edge 1600 px; removed once the capture is saved
  photo?: Blob;
  // JPEG data URL, long edge 160 px; kept for the list
  thumbnail: string;
  telemetry: DeviceTelemetry;
  insideBoundary: boolean;
  status: CaptureStatus;
  reviewReason?: ReviewReason;
  reading?: AIStructuredExtraction;
  readAttempts: number;
  saveFailures: number;
  manualRetries: number;
  // Epoch milliseconds; 0 means as soon as possible
  nextAttemptAt: number;
  lastError?: string;
  attempt: CaptureSaveAttempt;
  graveId?: string;
  outcome?: 'created' | 'added-photo';
  matchCandidate?: MatchCandidate;
}

// Stored per surveyor, so a queue paused after repeated errors stays paused until they tap Resume
export interface SurveyQueueState {
  userId: string;
  consecutiveFailures: number;
  pausedForErrors: boolean;
}

export interface ProvenanceLog {
  id: string;
  graveId: string;
  contributor: string;
  timestamp: string;
  action: string;
  source: 'MANUAL' | 'AI_OCR_V1' | 'FIELD_SURVEY' | 'COMMUNITY_AUDIT';
  confidence: number;
  details: string;
}

export interface Correction {
  id: string;
  graveId: string;
  reportedByUserId?: string;
  issueType: IssueType;
  description: string;
  status: 'PENDING' | 'RESOLVED' | 'REJECTED';
  createdAt: string;
}
