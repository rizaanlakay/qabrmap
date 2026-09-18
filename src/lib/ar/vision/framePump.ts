import type { XR8Api, XR8PipelineModule, XR8PixelArray } from '../xr8';

// The engine's CameraPixelArray module copies the raw camera image off the GPU on every frame, which is far
// more than a matcher that answers every second or two can use. This wraps it so the copy only happens on
// request. The engine's module reads the image it rendered on its previous call, so the first read after a
// pause is as old as the pause; that one is thrown away and the next is delivered.
//
// On attach the engine's module also makes itself the only source of the camera image drawn on screen, so
// that picture and pixels stay in step. Left like that, the picture would freeze whenever this gate is shut,
// so the screen's source is handed straight back to the engine.

export interface GrayFrame {
  // One byte per pixel, rows from the top
  pixels: Uint8Array;
  width: number;
  height: number;
}

export interface FramePump {
  pipelineModule: XR8PipelineModule;
  // Ask for one frame; it arrives through onFrame a couple of engine frames later
  request(): void;
  cancel(): void;
  onFrame(listener: (frame: GrayFrame) => void): void;
}

function isPixelArray(value: unknown): value is XR8PixelArray {
  const v = value as Partial<XR8PixelArray> | null | undefined;
  return !!v && v.pixels instanceof Uint8Array && typeof v.rows === 'number' && typeof v.cols === 'number';
}

// Null when this engine build has no CameraPixelArray
export function createFramePump(XR8: Pick<XR8Api, 'CameraPixelArray' | 'GlTextureRenderer'>, maxDimension: number): FramePump | null {
  if (!XR8.CameraPixelArray) return null;
  const inner = XR8.CameraPixelArray.pipelineModule({ luminance: true, maxDimension });
  let wanted = false;
  let reads = 0;
  let listener: ((frame: GrayFrame) => void) | null = null;

  const pipelineModule: XR8PipelineModule = {
    ...inner,
    onAttach: (args) => {
      inner.onAttach?.(args);
      XR8.GlTextureRenderer.setTextureProvider?.(null);
    },
    onProcessGpu: (args) => {
      if (!wanted) return undefined;
      const result = inner.onProcessGpu?.(args);
      reads += 1;
      if (reads >= 2 && isPixelArray(result) && result.rows > 0 && result.cols > 0 && result.rowBytes === result.cols) {
        wanted = false;
        listener?.({ pixels: result.pixels, width: result.cols, height: result.rows });
      }
      return result;
    },
  };

  return {
    pipelineModule,
    request() {
      if (wanted) return;
      wanted = true;
      reads = 0;
    },
    cancel() {
      wanted = false;
    },
    onFrame(next) {
      listener = next;
    },
  };
}
