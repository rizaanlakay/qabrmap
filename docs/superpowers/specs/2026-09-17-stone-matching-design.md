# Visual stone matching on the tracked AR screen

Date: 2026-09-17
Status: built, needs a phone visit to a grave

## Problem

The tracked AR screen gets a visitor to within GPS accuracy of a grave (about 5 m), where several stones can look alike. The grave's photo is already shown on the card as "Look for this grave". The phone should do that looking: find the photographed stone in the camera view and outline it.

A desk test (`tools/stone-matcher/`, throwaway) on one real photo and one real walk showed that keypoint matching finds the stone once it faces the camera and is about 130 px or more across, with 13 to 55 matched points against 4 or fewer when the stone is out of view. ORB failed on real granite; AKAZE worked.

## What the phone test must answer

The desk test used a compressed screen recording. These can only be seen on a phone at a grave, and the debug view exists to show them:

1. The raw frame's orientation and crop (is the outline on the stone, not mirrored or offset).
2. Time per match on a phone (desk: 0.5 s; expected 1.5 to 3 s).
3. Working distance with the engine's 960 x 720 camera feed (expected 3 to 5 m, facing the stone).

## Decisions

| Topic | Decision |
|---|---|
| Scope | Tracked screen only. The sensor fallback screen is unchanged. GPS, compass, line, pin, badge, card and the visit button are unchanged. |
| Frames | The engine's `CameraPixelArray` module in greyscale at 960 px, which reads the camera image before three.js or the UI is drawn. It reads every frame by default, so it is wrapped and only runs when the matcher wants a frame. Its first read after a pause is a stale image and is thrown away. On attach that module also makes itself the only source of the camera picture on screen, which would freeze the picture while the gate is shut, so the wrapper hands the source back with `GlTextureRenderer.setTextureProvider(null)`. |
| Region | Only the part of the camera image visible on screen is matched (the engine centre-crops the feed to the canvas). Less to process, and the visitor points the phone at what they mean. |
| Matcher | OpenCV.js 4.10 (pinned jsDelivr URL, about 10 MB, fetched on demand) in a classic worker at `public/vision/stone-matcher.worker.js`. AKAZE at threshold 0.0006, reference matched at four sizes, ratio test 0.75, RANSAC homography, sanity check on the projected outline. Ported from the desk tester. |
| Reference | `gravePhotoUrl` (the whole-grave photo, which is what was tested), else `primaryPhotoUrl` when it is a real photo. Neither: the feature stays off and says nothing. |
| Outline area | The reference photo shows ground and neighbours too, so the outline covers the box holding the middle 90% of recently matched points, padded 15%. |
| Following | A match answer arrives seconds after its frame. The camera pose and a grid of hit tests are recorded when the frame is taken; the outline is unprojected from that pose at the depth of the nearest hit (else the grave pin's distance, else 3 m) and lives in the world as a three.js object, so the world tracker keeps it on the stone between matches. |
| States | `off`, `loading`, `scanning`, `potential` (10 or more matched points), `likely` (20 or more, on 2 matches in the same place), `unavailable`. A candidate that moves more than 0.6 of its size is a new candidate. A failed match only counts against the outline when the outline was in view for that frame; 4 such misses remove it. |
| Activation | Worker and reference load at 30 m or less (the existing smoothed GPS distance). Matching runs at 15 m or less, or once arrived, and only while tracking is NORMAL. At most one match in flight; at least 250 ms between them. |
| UI | One status chip above the existing pill: "Scanning for the stone…", "Possible match", "Likely match. Check the name and dates." No percentages. The existing visit button is the confirmation; confirming changes nothing about positions. |
| Failure | Any failure (no photo, photo blocked, worker or OpenCV download failure, engine without `CameraPixelArray`) sets `unavailable` once and the screen carries on exactly as today. No error text unless debug is on. |
| Debug | `?visionDebug=1` (remembered in localStorage; `=0` clears) or five taps on the screen title. Shows the last matched frame with the outline and points drawn on it, match time, matched points, frame size and counts. |
| Cost | No cloud calls. Nothing leaves the phone. |

## Modules

All new code is under `src/lib/ar/vision/` unless noted. Pure modules are unit tested.

- `config.ts`: `VISION_CONFIG` and `OPENCV_SCRIPT_URL`.
- `frameMapping.ts` (pure): `visibleFrameRect(frameW, frameH, canvasW, canvasH)` gives the centre-crop the screen shows; `cropGray(pixels, frameW, rect)` copies it out.
- `framePump.ts`: wraps `XR8.CameraPixelArray.pipelineModule`. `request()` opens the gate; the second read after that is delivered once and the gate closes.
- `worldQuad.ts` (pure, three.js maths): `unprojectQuad(pose, quadNdc, depthM)` and `depthForQuad(pose, hits, centreNdc, fallbackM)`.
- `candidateTracker.ts` (pure): the state machine above, in world coordinates.
- `stoneHighlight.ts`: the three.js outline (border mesh plus faint fill, amber or green, drawn over everything).
- `referenceLevels.ts`: fetches the photo and renders the four sizes; `referenceSizes()` is pure.
- `matcherClient.ts`: owns the worker and the message protocol; one match at a time; every failure resolves, never throws into the frame loop.
- `visionDriver.ts`: the pipeline module that ties these together and reports `VisionState`.
- `public/vision/stone-matcher.worker.js`: OpenCV only.
- `src/lib/ar/xr8.ts`: types for `CameraPixelArray` and `onProcessGpu`.
- `src/components/screens/ARTrackedGuidanceScreen.tsx`: creates the driver, feeds it distance and the reference URL, shows the chip and the debug view.

## Out of scope

A general gravestone detector, OCR, the sensor fallback screen, any change to stored positions, raising the engine's camera resolution (a follow-up if the phone test shows range is the limit).
