# How the recorder was designed

The recorder is the entry point of the calibration loop: if tapping a checkpoint is awkward, there is no data. A temporary web recorder has been in daily use since the start of this project; each version below came from how it was actually used on crowded trains. The production recorder in this repository will carry these lessons over.

## Iterations

| Version | What changed | Why |
| --- | --- | --- |
| v5 | Buttons moved to a bottom bar in the thumb zone. "Seated" became a three-way choice: got a seat / no seat / sat down partway. After each tap, the five tags the owner uses most pop up. Tapping any row lets you fix its actual time | An analysis of 100 rows and 48 free-text notes: most notes were time corrections or the same few situations typed again and again. Earlier feedback: a palm resting on the lower screen while reaching for top buttons caused mis-taps |
| v6 | Trackpad-style time nudge: press and hold a button, then slide sideways without lifting; each small step moves one notch (−10 min … −30 s, *just now*, +30 s, +1 min, *pick a time*). Sliding up or down cancels | Taps often come late ("seated" pressed minutes after sitting down). Inspired by the iPhone 6s 3D Touch keyboard cursor. Concepts: relative pointing, control-display gain, scrubbing |
| v7 (in trial) | The next button is chosen from what just happened, not from a fixed route (after boarding: got a seat / no seat / alight; after alighting: transfer / exit gate). Station names are inferred: certain ones are filled in, guesses from history are marked as guesses. At the end of a trip, a self-check card asks about anything unclear: which train, whether a seat was found, an unresolved station, three or more taps within two minutes (probably catch-up taps), check-in or arrival time | A fixed route template broke whenever the day deviated; catch-up taps and unknown stations were the most common data problems |

## Phone automations (not yet field-tested)

Location automations on the phone open the recorder with a fragment that records one checkpoint automatically:

| Trigger | Fragment |
| --- | --- |
| Leave home | `#auto-leave-home` |
| Arrive at the office | `#auto-office` |
| Leave the office | `#auto-leave-office` |
| Arrive home | `#auto-home` |

Such rows are written with `observer: "device"` and `recordedBy` naming the automation; the same fragment counts only once within 3 hours. Still to test: whether the OS runs the automation without asking for confirmation, and whether the link opens in the signed-in environment or records only on the device.

## Principle: observations, not facts

- A row records *who observed what, how, and when* — not the fact itself. The effective time, whether the owner was late, and the service status are views derived from several observations
- What was tapped or typed at the time is never rewritten. Corrections, inferences and reviews go into separate fields, each with its source
- Three kinds of time: `tappedAt` (button), `reportedAt` (said by the owner, with precision and source), `inferredAt` (reserved for sensors)
- Observers are kept apart: `observer` is `self`, `device` (an automation) or `official` (a `ServiceNotice`, which never changes the owner's rows); `recordedBy` says who wrote the row
- The same pattern repeats: `serviceStatus` + `serviceStatusCorrected`; `place` + `placeSource`; review notes in `reviewNote` and friends. Field definitions: [`FIELDS.md`](FIELDS.md)
