# Visual Stone Matching Implementation Plan

**Goal:** Outline the photographed gravestone in the tracked AR view and keep the outline on it.

**Architecture:** A gated read of the engine's raw greyscale camera image feeds an OpenCV.js worker that finds the grave's photo in the frame. The answer is unprojected from the camera pose recorded with the frame into a world-anchored three.js outline, so the world tracker does the following between slow matches.

**Tech Stack:** Next.js 14, TypeScript, three.js 0.170, 8th Wall engine binary 1.0.0, OpenCV.js 4.10 (CDN, worker only), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-stone-matching-design.md`

Executed inline in one session on 2026-09-17, so tasks list interfaces and tests rather than full code.

## Global Constraints

- The existing AR navigation, marker, GPS and compass logic, card and visit button must not change behaviour.
- No second camera stream. No cloud calls. No new npm dependencies.
- Every vision failure ends in `unavailable` and leaves the screen as it is today.
- The XR engine attribution notice stays on the screen.
- No em-dashes in any text.

---

### Task 1: Config, frame mapping, frame pump

**Files:** create `src/lib/ar/vision/config.ts`, `frameMapping.ts`, `framePump.ts`; modify `src/lib/ar/xr8.ts`; test `tests/vision_frame_mapping.test.ts`, `tests/vision_frame_pump.test.ts`.

**Produces:**
- `VISION_CONFIG`, `OPENCV_SCRIPT_URL`
- `visibleFrameRect(frameW, frameH, canvasW, canvasH): FrameRect`, `cropGray(pixels, frameW, rect): Uint8Array`
- `createFramePump(XR8, maxDimension): { pipelineModule, request(), cancel(), onFrame(cb) } | null` and `GrayFrame { pixels, width, height }`

**Tests:** wide and tall canvases crop the right axis, centred; crop copies the right rows; pump does nothing until requested, drops the first read after a request, delivers the second once, closes the gate, returns null when the engine has no `CameraPixelArray`.

### Task 2: World maths and candidate tracker

**Files:** create `worldQuad.ts`, `candidateTracker.ts`; test `tests/vision_world_quad.test.ts`, `tests/vision_candidate_tracker.test.ts`.

**Produces:**
- `CameraPose { position, quaternion, projectionMatrixInverse }`, `snapshotPose(camera)`, `unprojectQuad(pose, quadNdc, depthM): Vector3[]`, `depthForQuad(pose, hits, centreNdc, fallbackM): number`, `isInView(pose, projectionMatrix, point): boolean`
- `createCandidateTracker(config)` with `update(observation | null, expectedVisible): CandidateState` and `reset()`

**Tests:** a centred quad unprojects to a plane at the asked depth facing the camera; depth comes from the nearest hit, else the fallback; potential then likely after two near matches; a jump restarts stability; misses only count when expected visible; four remove the candidate.

### Task 3: Worker, client, reference levels

**Files:** create `public/vision/stone-matcher.worker.js`, `matcherClient.ts`, `referenceLevels.ts`; test `tests/vision_matcher_client.test.ts`, `tests/vision_reference_levels.test.ts`.

**Produces:**
- Protocol in: `init {cvUrl, akazeThreshold}`, `reference {levels, w, h}`, `match {id, image(grey), ratio, potential}`, `reset`. Out: `ready`, `reference {count}`, `result {id, result}`, `error {id?, message}`, `fatal {message}`.
- `createMatcherClient(makeWorker, config)` with `ready: Promise<boolean>`, `setReference(levels): Promise<number>`, `match(frame): Promise<MatchResult | null>`, `busy()`, `dispose()`
- `referenceSizes(w, h, config)`, `loadReferenceLevels(url, config)`

**Tests:** fake worker: ready resolves, a second match while busy resolves null, an error resolves null, fatal resolves ready false, dispose terminates. Sizes skip copies under 48 px and never upscale.

**Verify:** run the real worker in Chrome against the real photo and a greyscale frame from the test video.

### Task 4: Highlight and vision driver

**Files:** create `stoneHighlight.ts`, `visionDriver.ts`; test `tests/vision_stone_highlight.test.ts`, `tests/vision_driver.test.ts`.

**Produces:** `createStoneHighlight()`, `createVisionDriver(XR8, deps)` with `pipelineModules`, `prepare(referenceUrl)`, `setActive(bool)`, `setFallbackDepth(m)`, `onState(cb)`, `dispose()`, and `VisionState`.

**Tests:** inactive driver never requests frames; a good answer shows the outline and reports `potential`; a failed prepare reports `unavailable` and never requests frames; dispose removes the outline.

### Task 5: Screen integration

**Files:** modify `src/components/screens/ARTrackedGuidanceScreen.tsx`.

Create the driver beside the scene driver, add its modules to the pipeline, prepare at 30 m, activate at 15 m or on arrival while tracking is normal, show the chip, the debug toggle and view.

**Verify:** `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`.

### Task 6: Phone test notes

**Files:** create `docs/stone-matching-phone-test.md`.
