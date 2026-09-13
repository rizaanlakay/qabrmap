// Asynchronous Gravestone AI Processing Pipeline with progress callbacks

import {
  AIProcessingState,
  DeviceTelemetry,
  GravestoneBoundingBox,
} from '@/types';
import {
  DefaultVisionProvider,
  DefaultOCRProvider,
  DefaultExtractionProvider,
  DefaultEmbeddingProvider,
  VisionProvider,
  OCRProvider,
  ExtractionProvider,
  EmbeddingProvider,
} from './providers';
import { processPhotoToGravePosition } from '../geospatial';

export interface PipelineOptions {
  visionProvider?: VisionProvider;
  ocrProvider?: OCRProvider;
  extractionProvider?: ExtractionProvider;
  embeddingProvider?: EmbeddingProvider;
  cemeteryOrigin?: { lat: number; lng: number };
  onProgress?: (state: AIProcessingState) => void;
  stepDelayMs?: number; // Optional delay to allow smooth visual transitions in UI
}

export class GravestoneProcessingPipeline {
  private vision: VisionProvider;
  private ocr: OCRProvider;
  private extraction: ExtractionProvider;
  private embedding: EmbeddingProvider;
  private cemeteryOrigin?: { lat: number; lng: number };
  private stepDelayMs: number;

  constructor(options: PipelineOptions = {}) {
    this.vision = options.visionProvider || new DefaultVisionProvider();
    this.ocr = options.ocrProvider || new DefaultOCRProvider();
    this.extraction = options.extractionProvider || new DefaultExtractionProvider();
    this.embedding = options.embeddingProvider || new DefaultEmbeddingProvider();
    this.cemeteryOrigin = options.cemeteryOrigin;
    this.stepDelayMs = options.stepDelayMs ?? 450;
  }

  private async delay(ms: number) {
    if (ms <= 0) return;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async process(
    imageDataUrl: string,
    telemetry: DeviceTelemetry,
    onProgress?: (state: AIProcessingState) => void
  ): Promise<AIProcessingState> {
    const notify = (state: AIProcessingState) => {
      if (onProgress) onProgress(state);
    };

    const state: AIProcessingState = {
      step: 'quality',
      quality: 'processing',
      detection: 'pending',
      ocr: 'pending',
      extraction: 'pending',
      positioning: 'pending',
      duplicates: 'pending',
      data: {},
    };

    notify({ ...state });
    await this.delay(this.stepDelayMs);

    try {
      // Step 1: Image Quality
      const quality = await this.vision.analyzeQuality(imageDataUrl);
      state.quality = 'complete';
      state.step = 'detection';
      state.detection = 'processing';
      state.data!.quality = quality;
      notify({ ...state });
      await this.delay(this.stepDelayMs);

      // Step 2: Gravestone Detection
      const detection = await this.vision.detectGravestone(imageDataUrl);
      state.detection = 'complete';
      state.step = 'ocr';
      state.ocr = 'processing';
      state.data!.detection = detection;
      notify({ ...state });
      await this.delay(this.stepDelayMs);

      // Step 3: OCR
      const ocrResult = await this.ocr.extractText(imageDataUrl, detection.boundingBox);
      state.ocr = 'complete';
      state.step = 'extraction';
      state.extraction = 'processing';
      notify({ ...state });
      await this.delay(this.stepDelayMs);

      // Step 4: Structured Info Extraction
      const structured = await this.extraction.extractStructuredData(
        ocrResult.rawOcrText,
        ocrResult.lines
      );
      state.extraction = 'complete';
      state.step = 'positioning';
      state.positioning = 'processing';
      state.data!.structured = structured;
      notify({ ...state });
      await this.delay(this.stepDelayMs);

      // Step 5: Positioning & Bearing Projection
      const positionResult = processPhotoToGravePosition(
        telemetry,
        detection.boundingBox,
        this.cemeteryOrigin
      );
      state.positioning = 'complete';
      state.step = 'duplicates';
      state.duplicates = 'processing';
      state.data!.position = positionResult;
      notify({ ...state });
      await this.delay(this.stepDelayMs);

      // Step 6: Visual Embedding & Duplicate Search
      const { vector, hash } = await this.embedding.generateEmbedding(imageDataUrl);
      state.duplicates = 'complete';
      state.step = 'complete';
      state.data!.duplicateMatch = {
        found: false,
      };
      notify({ ...state });

      return state;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown AI processing error';
      state.error = errorMsg;
      notify({ ...state });
      throw err;
    }
  }
}
