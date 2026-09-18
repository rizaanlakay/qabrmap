# Spoken turn-by-turn guidance while driving

Date: 2026-09-17
Status: designed, not built

## Problem

The driving screen shows the next turn, the distance to it and the one after. A driver has to look at the phone to use any of it. Google Maps and a Garmin say it out loud, and say it early enough to change lanes.

Everything the speaking needs is already computed. `computeRouteProgress` returns `stepIndex` and a continuously updating `distanceToNextManeuverMeters` on every GPS fix, and `RouteStep` carries `type`, `modifier`, `streetName` and a ready-made `instruction` string.

## Decisions

| Topic | Decision |
|---|---|
| Scope | Driving only, from the first fix to arrival at the entrance. The walking and AR screens stay silent; they have no turn-by-turn steps, only a bearing. |
| Voice | The phone's own, through `speechSynthesis`. Free, no network, works in a dead spot. No cloud call, nothing leaves the phone. |
| Voice choice | First an `en-ZA` voice (Tessa on iOS), then `en-GB`, then any English, and within each a female voice matched by name. No female voice on the device means it speaks in whatever is there rather than staying silent. |
| Default | Off. Remembered per device in `localStorage` under `qabrmap_voice_guidance`. |
| Toggle | A speaker button in the turn card's top right, left of the step pager, in the same black pill. `Volume2` and `VolumeX` from lucide. |
| Unlocking audio | iOS only speaks after something was spoken inside a real tap, so switching the toggle on says "Voice guidance on". That unlocks the audio and confirms it works. |
| Which turn is announced | `turnIndex = stepIndex + 1`. That is the maneuver `distanceToNextManeuverMeters` counts down to. `steps[stepIndex]` is the leg being driven now, and supplies only the heads-up line's road name and length. |
| Interruptions | A new announcement cancels whatever is still speaking. Nothing queues. A stale "in 400 metres" arriving at 80 m is worse than silence. |
| Manual preview | Scrubbing steps with the pager speaks nothing. The voice follows the live step index, never `previewStepIndex`. |
| Cost | None. |

## When it speaks

Trigger distances come from speed, so the same ladder works at 50 km/h and on the N2.

| Tier | Fires when | Says |
|---|---|---|
| `depart` | guidance starts, once per route | `steps[0].instruction` |
| `headsUp` | on entering a leg whose `steps[stepIndex].distanceMeters` exceeds `HEADS_UP_MIN_STEP_M` | "Continue on {`steps[stepIndex].streetName`} for {distance}." |
| `warning` | distance to turn drops to `clamp(speed × 30, 200, 800)` m | "In {distance}, {instruction at turnIndex}." |
| `turn` | distance to turn drops to `clamp(speed × 4, 30, 120)` m | "{instruction at turnIndex}." |
| `arrive` | `remainingMeters` under 40, or arrival latches | "You have arrived at {entrance name}." |
| `reroute` | a new route replaces one the driver left | "Rerouting." |

Constants: `HEADS_UP_MIN_STEP_M = 1500`, `WARNING_SECONDS = 30`, `WARNING_MIN_M = 200`, `WARNING_MAX_M = 800`, `TURN_SECONDS = 4`, `TURN_MIN_M = 30`, `TURN_MAX_M = 120`, `ARRIVAL_M = 40`, `DEFAULT_SPEED_MPS = 13.9` (50 km/h).

At 50 km/h the warning lands near 420 m and the turn near 55 m. At 120 km/h they stretch to 800 m and 120 m on their own.

Speed comes from `pos.coords.speed` when the device reports a finite value of zero or more, else from the change in `remainingMeters` over time, else `DEFAULT_SPEED_MPS`.

## Rules that keep it from misbehaving

A fix arrives every second and the distance jitters, so each of these is a rule the engine enforces and a test.

- **One tier, one maneuver, once.** Announcements are latched by `${turnIndex}:${tier}`. Crossing a threshold back and forth says nothing the second time.
- **Stale tiers are dropped, not spoken late.** If two tiers come due between fixes, only the most urgent speaks (`turn` over `warning` over `headsUp`). The others are marked said.
- **Close turns chain.** When the `turn` tier fires for `turnIndex`, the leg that follows it is `steps[turnIndex].distanceMeters`. If that leg is shorter than the current warning distance, the phrase becomes "{instruction at turnIndex}, then {instruction at turnIndex + 1}" and the `warning` tier for `turnIndex + 1` is marked said. This is why a short leg never announces itself from a standing start. A maneuver of type `arrive` is never chained onto, because the arrival line follows seconds later and would say it twice.
- **The destination is not a turn.** The `warning` and `turn` tiers skip a maneuver of type `arrive` and leave it to the `arrive` tier. Without this the drive ends with "Arrive at Johnstone Road Gate" at 50 m and "You have arrived at Johnstone Road Gate" at 40 m. The heads-up tier is unaffected, so a long final leg still gets its "continue on" line.
- **A reroute clears everything.** New steps mean the memory is emptied, otherwise the new step 2 inherits the old step 2's history. A route replacing an existing one also says "Rerouting"; the first route of a drive does not.
- **Depart and warning can share a breath.** If both are due on the same fix, they speak as one utterance: "Head out onto Lawrence Road. In 100 metres, turn right onto Aden Avenue." That is what Google does on a short first step.

## How distances and names are spoken

Spoken distances round differently from the ones on screen, which step in 10 m. `speakDistance`:

- 1000 m and over: nearest 500 m, as "1 kilometre", "1.5 kilometres", "2 kilometres"
- 100 m and over: nearest 100 m, as "400 metres"
- under 100 m: nearest 50 m with a floor of 50, as "50 metres"

Street names get common abbreviations expanded at word boundaries before speaking, so a name straight out of OpenStreetMap reads properly: Rd, Ave, St, Dr, Ln, Cres, Blvd, Hwy, Pl, Sq.

## Modules

New code lives under `src/lib/navigation/`. The engine is pure and unit tested.

- `voiceGuidance.ts` (pure): the constants above, `speakDistance`, `expandStreetName`, and `nextAnnouncement(input, memory)` returning `{ phrase: string | null, memory }`. A whole drive is a list of numbers in and sentences out, with no audio, GPS or React anywhere in it.
- `voiceSpeaker.ts`: a `VoiceSpeaker` class wrapping `speechSynthesis`. Picks the voice (`getVoices` fills in late, so it also listens for `voiceschanged`), speaks, cancels, and reports whether the device can talk at all. The synth and the utterance factory are injected, so it tests without a DOM, the same way `wakeLockService.ts` sits under `useWakeLock`.
- `useVoiceGuidance.ts`: the hook joining the two. Holds the memory, the enabled flag and its `localStorage` line, and the speed estimate.
- `src/components/screens/NavigationScreen.tsx`: the toggle button and one call to the hook. That file is already 1632 lines, so it gains as little as possible.

## Testing

`tests/voice_guidance.test.ts` runs the engine through a simulated version of the 3 km drive to Johnson Road and asserts the exact sentences, in order, once each. Then the cases that break naive versions: jitter across a threshold, two thresholds crossed between fixes, a reroute mid-drive, chained short turns, the pager suppressing speech, arrival firing once, a device reporting no speed.

`tests/voice_speaker.test.ts` covers voice picking against a fake voice list, including a list with no female voice and an empty list, and checks that speaking cancels whatever is still talking.

The project has no jsdom or testing-library, so tests run in node against injected fakes. `useVoiceGuidance.ts` stays thin enough not to need its own test.

## Out of scope

A cloud voice, speech while walking to the grave or in AR, lane guidance, speed limits, traffic, and audio while the phone is locked. The screen already holds a wake lock, so the last one only matters if a real drive shows it does.

## Noted, not changed

The turn card pairs `distanceToNextManeuverMeters`, which counts to the next maneuver, with `activeStep.instruction`, which describes the maneuver already made. In the screenshot that reads "600 m / Head out onto Lawrence Road" where Google would say "600 m / Turn right onto Aden Avenue". The "Then..." line underneath carries the real next turn. The voice announces `steps[stepIndex + 1]` and is unaffected. Worth fixing separately.
