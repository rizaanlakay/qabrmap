'use client';

import React, { useEffect, useRef } from 'react';
import type { VisionState } from '@/lib/ar/vision/visionDriver';

// Field diagnostics for stone matching, off unless asked for. The picture is the exact frame the matcher was
// given with its answer drawn on it, which shows at a glance whether the camera image arrives the right way
// up, and whether a wrong outline on screen is the matcher's fault or the placement's.
export const VisionDebugView: React.FC<{ state: VisionState }> = ({ state }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { phase, debug } = state;
  const preview = debug.preview;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !preview) return;
    canvas.width = preview.width;
    canvas.height = preview.height;
    const image = ctx.createImageData(preview.width, preview.height);
    for (let i = 0; i < preview.pixels.length; i++) {
      const v = preview.pixels[i];
      image.data[i * 4] = v;
      image.data[i * 4 + 1] = v;
      image.data[i * 4 + 2] = v;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    if (preview.quad) {
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = Math.max(3, preview.width / 80);
      ctx.beginPath();
      preview.quad.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.fillStyle = '#facc15';
    const dot = Math.max(2, preview.width / 120);
    for (const p of preview.points) ctx.fillRect(p.x - dot, p.y - dot, dot * 2, dot * 2);
  }, [preview]);

  const depth = debug.depthM === null ? 'none' : `${debug.depthM.toFixed(1)} m ${debug.depthFromHit ? 'tracked' : 'guessed'}`;
  return (
    <div className="absolute top-14 left-2 z-40 w-36 rounded-lg bg-black/75 border border-white/20 p-1.5 text-[9px] leading-tight font-mono text-white pointer-events-none">
      <canvas ref={canvasRef} className={preview ? 'w-full rounded mb-1' : 'hidden'} />
      <div>vision: {phase}</div>
      {debug.reason && <div className="text-amber-300">{debug.reason}</div>}
      <div>photo features {debug.referenceFeatures}</div>
      <div>frame {debug.frameWidth} x {debug.frameHeight}</div>
      <div>match {Math.round(debug.matchMs)} ms</div>
      <div>points {debug.inliers} of {debug.good} ({debug.frameFeatures} in frame)</div>
      <div>found {debug.matchesFound} of {debug.matchesRun}</div>
      <div>depth {depth}</div>
    </div>
  );
};
