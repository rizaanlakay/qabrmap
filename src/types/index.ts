// Core TypeScript domain models for QabrMap

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
  lastVerifiedAt?: string;
  relationship?: GraveRelationship;
  createdAt: string;
  updatedAt: string;
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

export interface AIQualityResult {
  usable: boolean;
  blurScore: number;
  lightingScore: number;
  stoneVisibilityScore: number;
  warnings: string[];
  recommendation?: string;
}

export interface AIDetectionResult {
  boundingBox: GravestoneBoundingBox;
  estimatedStoneDimensions: { widthCm: number; heightCm: number };
  stoneOrientationDegrees: number;
  groundPlaneDetected: boolean;
}

export interface OCRLine {
  text: string;
  confidence: number;
  language: string;
}

export interface AIStructuredExtraction {
  graveNumber: string;
  firstName: string;
  middleNames: string[];
  surname: string;
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

export interface AIProcessingState {
  step: 'quality' | 'detection' | 'ocr' | 'extraction' | 'positioning' | 'duplicates' | 'complete';
  quality: 'pending' | 'processing' | 'complete' | 'failed';
  detection: 'pending' | 'processing' | 'complete' | 'failed';
  ocr: 'pending' | 'processing' | 'complete' | 'failed';
  extraction: 'pending' | 'processing' | 'complete' | 'failed';
  positioning: 'pending' | 'processing' | 'complete' | 'failed';
  duplicates: 'pending' | 'processing' | 'complete' | 'failed';
  error?: string;
  data?: {
    quality?: AIQualityResult;
    detection?: AIDetectionResult;
    structured?: AIStructuredExtraction;
    position?: {
      estimatedLat: number;
      estimatedLng: number;
      distanceMeters: number;
      bearingDegrees: number;
      accuracyMeters: number;
      confidence: ConfidenceLevel;
      localX?: number;
      localY?: number;
    };
    duplicateMatch?: {
      found: boolean;
      graveId?: string;
      confidence?: number;
    };
  };
}

export interface SurveySession {
  id: string;
  cemeteryId: string;
  cemeteryName: string;
  sectionCode: string;
  startedAt: string;
  completedAt?: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  capturedCount: number;
  processedCount: number;
  pendingCount: number;
  reviewCount: number;
}

export interface OfflineUploadQueueItem {
  id: string;
  graveId?: string;
  surveySessionId?: string;
  cemeteryId: string;
  photoBlob: Blob | string; // Base64 or Blob
  telemetry: DeviceTelemetry;
  extractedDraft?: Partial<AIStructuredExtraction>;
  status: 'queued' | 'syncing' | 'completed' | 'failed';
  retryCount: number;
  createdAt: string;
  error?: string;
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
