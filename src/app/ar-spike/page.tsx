'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createFloorLine } from '@/lib/ar/floorLine';
import { createFloorEstimator } from '@/lib/ar/floorEstimate';
import { loadXR8, XR8Api, XR8PipelineModule, XR_ENGINE_LICENSE_URL, XR_ENGINE_NOTICE } from '@/lib/ar/xr8';

// Spike: does the 8th Wall engine binary track the floor well enough on our phones for a real AR line?
// Not linked from anywhere. Open /ar-spike on the phone, allow the camera, move the phone slowly, and
// watch whether the chevrons stay on the ground while you tilt, turn and walk.

// Where the phone starts above the floor until the real floor has been measured from tracked points
const EYE_HEIGHT_M = 1.5;
// Screen spots (0..1 from the top left) probed for ground points: the lower middle of the view
const FLOOR_PROBES: Array<[number, number]> = [[0.3, 0.7], [0.5, 0.75], [0.7, 0.7], [0.5, 0.9]];
// Probe every this many frames; hit tests are not free
const FLOOR_PROBE_EVERY = 6;
// How quickly the line follows the phone and the measured floor, per frame
const FOLLOW_ALPHA = 0.08;

type Phase = 'loading' | 'camera' | 'initialising' | 'tracking' | 'limited' | 'failed';

const PHASE_TEXT: Record<Phase, string> = {
  loading: 'Loading the AR engine…',
  camera: 'Starting the camera…',
  initialising: 'Move the phone slowly from side to side so it can find the floor',
  tracking: 'Tracking. Tilt, turn and walk: the line should stay on the ground',
  limited: 'Tracking is limited. Point at a textured floor and move slowly',
  failed: 'The AR engine could not start',
};

export default function ArSpikePage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [detail, setDetail] = useState('');
  const [frames, setFrames] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let engine: XR8Api | null = null;
    let onResize: (() => void) | null = null;

    const start = async () => {
      let XR8: XR8Api;
      try {
        XR8 = await loadXR8();
      } catch (err) {
        setPhase('failed');
        setDetail(err instanceof Error ? err.message : String(err));
        return;
      }
      if (cancelled || !canvasRef.current) return;
      engine = XR8;
      const canvas = canvasRef.current;
      // The engine sizes its drawing buffer and inline style from the canvas attributes, so they must match the
      // screen before it starts, not the 300 by 150 default
      const fitCanvas = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
      };
      fitCanvas();
      onResize = fitCanvas;
      window.addEventListener('resize', onResize);
      // The engine's three.js module drives whatever THREE it finds on window
      window.THREE = THREE;

      const line = createFloorLine();
      const floor = createFloorEstimator();
      const startedAt = performance.now();
      let frameCount = 0;
      let trackedCamera: THREE.PerspectiveCamera | null = null;

      const floorLineModule: XR8PipelineModule = {
        name: 'qabrmap-floor-line',
        onStart: () => {
          // The engine writes its own inline size on start; pin the canvas to the screen again
          fitCanvas();
          const { scene, camera } = XR8.Threejs.xrScene();
          trackedCamera = camera;
          scene.add(line.group);
          camera.position.set(0, EYE_HEIGHT_M, 0);
          XR8.XrController.updateCameraProjectionMatrix({ origin: camera.position, facing: camera.quaternion });
          setPhase('initialising');
        },
        onUpdate: ({ processCpuResult }) => {
          line.animate((performance.now() - startedAt) / 1000);
          frameCount += 1;
          const reality = processCpuResult.reality;
          const camera = trackedCamera;

          // Measure the floor from tracked points below the camera, a few screen spots at a time
          if (camera && reality?.position && frameCount % FLOOR_PROBE_EVERY === 0) {
            for (const [x, y] of FLOOR_PROBES) {
              try {
                for (const hit of XR8.XrController.hitTest(x, y, ['FEATURE_POINT', 'ESTIMATED_SURFACE'])) {
                  floor.addSample(hit.position.y, camera.position.y);
                }
              } catch {
                // No tracker on this device (desktop): the assumed floor stays
              }
            }
          }

          // The line starts at the phone's feet and sits on the measured floor, easing so it never jumps
          if (camera) {
            const floorY = floor.floorY();
            const target = line.group.position;
            target.x += (camera.position.x - target.x) * FOLLOW_ALPHA;
            target.z += (camera.position.z - target.z) * FOLLOW_ALPHA;
            if (floorY !== null) target.y += (floorY - target.y) * FOLLOW_ALPHA;
          }

          if (frameCount % 30 === 0) setFrames(frameCount);
          if (reality && frameCount % 10 === 0) {
            // Desktop browsers report tracking status without a position, so the position is optional here
            const p = reality.position;
            const where = p ? `  cam y ${p.y.toFixed(2)}` : '';
            const floorY = floor.floorY();
            const ground = floorY === null ? `  floor: measuring (${floor.sampleCount()} pts)` : `  floor y ${floorY.toFixed(2)}`;
            setDetail(`${reality.trackingStatus} ${reality.trackingReason}${where}${ground}`);
          }
        },
        onCameraStatusChange: ({ status }) => {
          if (status === 'requesting') setPhase('camera');
          if (status === 'failed') {
            setPhase('failed');
            setDetail('Camera permission was refused');
          }
        },
        onException: (error) => {
          setPhase('failed');
          setDetail(error instanceof Error ? error.message : String(error));
        },
        listeners: [
          {
            event: 'reality.trackingstatus',
            process: ({ detail: info }) => {
              const status = String(info.status);
              const reason = String(info.reason);
              if (status === 'NORMAL') setPhase('tracking');
              else setPhase(reason === 'INITIALIZING' ? 'initialising' : 'limited');
            },
          },
        ],
      };

      // Real-world metres, so a chevron 1 m ahead is 1 m ahead
      XR8.XrController.configure({ scale: 'absolute', disableWorldTracking: false });
      XR8.addCameraPipelineModules([
        XR8.XrController.pipelineModule(),
        XR8.GlTextureRenderer.pipelineModule(),
        XR8.Threejs.pipelineModule(),
        floorLineModule,
      ]);
      XR8.run({ canvas: canvasRef.current, allowedDevices: XR8.XrConfig.device().ANY });
    };

    void start();

    return () => {
      cancelled = true;
      if (onResize) window.removeEventListener('resize', onResize);
      try {
        engine?.stop();
      } catch {
        // Stopping an engine that never started throws; nothing to clean up
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-black text-white select-none">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      <div className="absolute top-0 inset-x-0 p-4 pt-6 bg-gradient-to-b from-black/80 to-transparent">
        <h1 className="text-sm font-bold">AR floor line spike</h1>
        <p className="mt-1 text-xs text-white/80" role="status">
          {PHASE_TEXT[phase]}
        </p>
        <p className="mt-1 text-[11px] font-mono text-emerald-300 break-all">{detail}</p>
        <p className="text-[11px] font-mono text-white/60">frames {frames}</p>
      </div>

      <div className="absolute bottom-0 inset-x-0 p-4 pb-6 bg-gradient-to-t from-black/80 to-transparent text-[10px] text-white/60">
        {XR_ENGINE_NOTICE}{' '}
        <a href={XR_ENGINE_LICENSE_URL} className="underline" target="_blank" rel="noopener noreferrer">
          Licence
        </a>
      </div>
    </div>
  );
}
