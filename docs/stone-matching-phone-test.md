# Testing stone matching on a phone

Stone matching only runs on the tracked AR screen, on a real phone, at a grave that has a photo. Desktop Chrome never tracks, so none of this can be checked at a desk. Deploy to production first (previews are protected).

## Before you go

1. Pick a grave that has a "Look for this grave" photo, taken facing the stone.
2. Open the site once on the phone with `?visionDebug=1` on the address. That turns the diagnostics on and the phone remembers it. In the installed app, tap the AR screen's title five times quickly instead. `?visionDebug=0` or five more taps turns it off.

## At the cemetery

Open AR guidance to the grave as usual. With diagnostics on, a small panel sits under the close button.

| Panel line | What it should show |
|---|---|
| `vision:` | `off` far away, `loading` inside 30 m (about 10 MB download the first time), `scanning` inside 15 m once tracking has locked |
| `photo features` | Several hundred or more. Under 80 means the photo is too plain or too small to match. |
| `frame` | About `432 x 960`: the part of the 720 x 960 camera image that is on screen |
| `match` | Time per match. Under 3000 ms is workable, because the outline is held in place by world tracking between matches. |
| `points` | 4 or so when the stone is not in view; 10 or more turns the outline amber; 20 or more, twice, turns it green |
| `depth` | `tracked` when the outline's distance came from a tracked point, `guessed` when it fell back to the GPS distance |
| Picture | The frame the matcher saw, with its answer in green. Upright and not mirrored, with the green box on the stone. |

## What to try

1. Walk in normally. Note the distance at which the chip first says "Possible match", and "Likely match".
2. Stand 2 to 3 m away, facing the stone squarely. This is the easy case; if it fails here, note what the panel says.
3. Step sideways slowly with the outline showing. It should stay on the stone. If it slides off, note whether `depth` said `guessed`.
4. Point at a neighbouring stone for ten seconds. It must not turn amber.
5. Look away and back. The outline should still be on the stone.
6. Try a second grave in different light if you can.

## Reading failures

| What you see | Likely cause |
|---|---|
| `unavailable` with a reason | The reason names it: engine build, matcher download, or the photo (a host without CORS blocks it). AR guidance itself is unaffected. |
| Picture is sideways, upside down or mirrored | The raw frame's orientation differs on this phone. The outline will be wrong until `framePump` turns it; send a screenshot. |
| Green box right in the picture, outline wrong on screen | Placement, not matching: check `depth`, and whether the offset is constant (crop assumption) or grows as you move (depth). |
| `points` stays near 4 facing the stone at 2 m | The stone in the camera image is too small or too soft. Note the `frame` size; the engine's 960 x 720 feed may be the limit. |
| Tracking gets worse while scanning | The matcher is competing with world tracking for the phone. Note the phone model and `match` time. |

Thresholds and distances live in `src/lib/ar/vision/config.ts`.
