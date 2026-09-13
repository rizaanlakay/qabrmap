import { NextRequest, NextResponse } from 'next/server';
import { GravestoneProcessingPipeline } from '@/lib/ai/pipeline';
import { DeviceTelemetry } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { image, telemetry, cemeteryOrigin } = body as {
      image: string;
      telemetry: DeviceTelemetry;
      cemeteryOrigin?: { lat: number; lng: number };
    };

    if (!image) {
      return NextResponse.json({ success: false, error: 'Missing image payload' }, { status: 400 });
    }

    const pipeline = new GravestoneProcessingPipeline({
      cemeteryOrigin,
      stepDelayMs: 0, // Server-side runs as fast as possible
    });

    const result = await pipeline.process(image, telemetry || {
      latitude: -33.967521,
      longitude: 18.503277,
      gpsAccuracy: 3.5,
      headingDegrees: 62.0,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Processing failed';
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
