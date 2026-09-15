// Loads the 8th Wall XR engine binary (world tracking in the browser) from its CDN on demand.
// The engine is closed source under Niantic Spatial's limited-use licence; the attribution notice lives
// in XR_ENGINE_NOTICE and must be shown wherever the engine is used.

// Pinned so a new engine release can't change behaviour under us
export const XR8_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/dist/xr.js';
export const XR_ENGINE_NOTICE =
  'This product includes the XR Engine software developed by Niantic Spatial, Inc. Copyright © 2026 Niantic Spatial, Inc.';
export const XR_ENGINE_LICENSE_URL = 'https://github.com/8thwall/engine/blob/main/LICENSE';

export interface XR8Reality {
  position: { x: number; y: number; z: number };
  rotation: { w: number; x: number; y: number; z: number };
  trackingStatus: 'LIMITED' | 'NORMAL';
  trackingReason: 'UNSPECIFIED' | 'INITIALIZING';
}

export interface XR8PipelineModule {
  name: string;
  onStart?: (args: { canvasWidth: number; canvasHeight: number }) => void;
  onUpdate?: (args: { processCpuResult: { reality?: XR8Reality } }) => void;
  onCameraStatusChange?: (args: { status: 'requesting' | 'hasStream' | 'hasVideo' | 'failed' }) => void;
  onException?: (error: unknown) => void;
  listeners?: Array<{ event: string; process: (event: { name: string; detail: Record<string, unknown> }) => void }>;
}

// The parts of the engine this app touches; everything else stays untyped
export interface XR8Api {
  run: (options: { canvas: HTMLCanvasElement; allowedDevices?: unknown }) => void;
  stop: () => void;
  addCameraPipelineModules: (modules: XR8PipelineModule[]) => void;
  GlTextureRenderer: { pipelineModule: () => XR8PipelineModule };
  Threejs: {
    pipelineModule: () => XR8PipelineModule;
    xrScene: () => { scene: import('three').Scene; camera: import('three').PerspectiveCamera; renderer: import('three').WebGLRenderer };
  };
  XrController: {
    pipelineModule: () => XR8PipelineModule;
    configure: (options: { scale?: 'responsive' | 'absolute'; disableWorldTracking?: boolean; enableWorldPoints?: boolean }) => void;
    updateCameraProjectionMatrix: (options: {
      origin?: { x: number; y: number; z: number };
      facing?: { w: number; x: number; y: number; z: number };
    }) => void;
    recenter: () => void;
    // Estimates the 3D point under a screen position (0..1 from the top left) from the tracker's feature points
    hitTest: (
      x: number,
      y: number,
      includedTypes: Array<'FEATURE_POINT' | 'ESTIMATED_SURFACE' | 'DETECTED_SURFACE'>
    ) => Array<{ type: string; position: { x: number; y: number; z: number }; distance: number }>;
  };
  XrConfig: { device: () => { ANY: unknown; MOBILE: unknown } };
}

declare global {
  interface Window {
    XR8?: XR8Api;
    THREE?: unknown;
  }
}

let loading: Promise<XR8Api> | null = null;

// Resolves once window.XR8 exists. The engine looks for its own script tag by file name, so it must be
// loaded through a script element rather than fetched and evaluated.
export function loadXR8(): Promise<XR8Api> {
  if (typeof window === 'undefined') return Promise.reject(new Error('The AR engine only runs in the browser'));
  if (window.XR8) return Promise.resolve(window.XR8);
  if (loading) return loading;

  loading = new Promise<XR8Api>((resolve, reject) => {
    const onLoaded = () => {
      if (window.XR8) resolve(window.XR8);
      else reject(new Error('The AR engine loaded but did not start'));
    };
    window.addEventListener('xrloaded', onLoaded, { once: true });

    const script = document.createElement('script');
    script.src = XR8_SCRIPT_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    // Pulls the world-tracking chunk alongside the core so tracking can start as soon as the camera does
    script.dataset.preloadChunks = 'slam';
    script.onerror = () => {
      window.removeEventListener('xrloaded', onLoaded);
      loading = null;
      reject(new Error('Could not download the AR engine. Check the connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}
