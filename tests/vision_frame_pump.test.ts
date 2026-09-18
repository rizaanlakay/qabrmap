// tests/vision_frame_pump.test.ts
import { describe, it, expect } from 'vitest';
import { createFramePump, GrayFrame } from '../src/lib/ar/vision/framePump';

// The engine's module, reduced to what the pump relies on: each call returns the image rendered by the call
// before it, and nothing on the first call
function fakeEngine() {
  let calls = 0;
  let options: { luminance?: boolean; maxDimension?: number } | null = null;
  // What the screen's camera image is drawn from; the engine's own source when null
  const screenSource: { provider: unknown } = { provider: null };
  const XR8 = {
    GlTextureRenderer: {
      pipelineModule: () => ({ name: 'gltexturerenderer' }),
      setTextureProvider: (provider: unknown) => {
        screenSource.provider = provider;
      },
    },
    CameraPixelArray: {
      pipelineModule: (opts: { luminance?: boolean; maxDimension?: number }) => {
        options = opts;
        return {
          name: 'camerapixelarray',
          // The real module takes over the screen's camera image here
          onAttach: () => {
            screenSource.provider = () => null;
          },
          onProcessGpu: () => {
            calls += 1;
            if (calls === 1) return {};
            // The pixel value says which call rendered this image
            return { rows: 2, cols: 2, rowBytes: 2, pixels: new Uint8Array(4).fill(calls - 1) };
          },
        };
      },
    },
  };
  return { XR8, calls: () => calls, options: () => options, screenSource };
}

const frameArgs = { frameStartResult: {} };

describe('Vision Frame Pump Tests', () => {
  it('asks the engine for a greyscale image at the given size and keeps the module name', () => {
    const engine = fakeEngine();
    const pump = createFramePump(engine.XR8, 960);
    expect(engine.options()).toEqual({ luminance: true, maxDimension: 960 });
    expect(pump?.pipelineModule.name).toBe('camerapixelarray');
  });

  it('never touches the engine module until a frame is requested', () => {
    const engine = fakeEngine();
    const pump = createFramePump(engine.XR8, 960)!;
    pump.pipelineModule.onProcessGpu?.(frameArgs);
    pump.pipelineModule.onProcessGpu?.(frameArgs);
    expect(engine.calls()).toBe(0);
  });

  it('drops the first read after a request, delivers the second once, then stops reading', () => {
    const engine = fakeEngine();
    const pump = createFramePump(engine.XR8, 960)!;
    const frames: GrayFrame[] = [];
    pump.onFrame((frame) => frames.push(frame));

    pump.request();
    pump.pipelineModule.onProcessGpu?.(frameArgs);
    expect(frames).toHaveLength(0);
    pump.pipelineModule.onProcessGpu?.(frameArgs);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ width: 2, height: 2 });
    pump.pipelineModule.onProcessGpu?.(frameArgs);
    expect(frames).toHaveLength(1);
    expect(engine.calls()).toBe(2);
  });

  it('throws away the stale image the engine still holds from before a pause', () => {
    const engine = fakeEngine();
    const pump = createFramePump(engine.XR8, 960)!;
    const frames: GrayFrame[] = [];
    pump.onFrame((frame) => frames.push(frame));
    pump.request();
    pump.pipelineModule.onProcessGpu?.(frameArgs);
    pump.pipelineModule.onProcessGpu?.(frameArgs);

    // Later: call 3 would return the image rendered by call 2, long ago. Call 4 returns call 3's, which is fresh.
    pump.request();
    pump.pipelineModule.onProcessGpu?.(frameArgs);
    expect(frames).toHaveLength(1);
    pump.pipelineModule.onProcessGpu?.(frameArgs);
    expect(frames).toHaveLength(2);
    expect(frames[1].pixels[0]).toBe(3);
  });

  it('delivers nothing after a cancel', () => {
    const engine = fakeEngine();
    const pump = createFramePump(engine.XR8, 960)!;
    const frames: GrayFrame[] = [];
    pump.onFrame((frame) => frames.push(frame));
    pump.request();
    pump.cancel();
    pump.pipelineModule.onProcessGpu?.(frameArgs);
    pump.pipelineModule.onProcessGpu?.(frameArgs);
    expect(frames).toHaveLength(0);
  });

  it('hands the screen camera image back to the engine, so the picture never freezes while the gate is shut', () => {
    const engine = fakeEngine();
    const pump = createFramePump(engine.XR8, 960)!;
    pump.pipelineModule.onAttach?.({});
    expect(engine.screenSource.provider).toBeNull();
  });

  it('is null on an engine build without the pixel array module', () => {
    expect(createFramePump({ GlTextureRenderer: { pipelineModule: () => ({ name: 'gltexturerenderer' }) } }, 960)).toBeNull();
  });
});
