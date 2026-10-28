# Commute Calibrator (working title)

A personal commute planner that gets more accurate the more you use it.

Timetables are public data — anyone can scrape them. What nobody else has is *your* numbers: how long it really takes you to get from your door to the ticket gate, how often the 07:37 actually runs late, which car you can still get a seat in if you join the queue ten minutes early. This project is built around collecting those numbers and feeding them back into the plan.

> **Status:** the data → prediction proof of concept has passed (two agents planned real mornings from the recorded data alone; see [`docs/VALIDATION.md`](docs/VALIDATION.md)). In this repository: spec v0.2, the shared field dictionary, the app scaffold and the data layer (types, read-time migration, append-only IndexedDB store, 41 tests). Next: the recorder UI, importing the temporary recorder's data, then the engine.

## What has been validated

| What | Result | Where |
| --- | --- | --- |
| Can someone plan a morning from this data alone? | Yes, twice: one agent with no project context, one with full context; both chose the route the owner wanted and got check-in time within a few minutes | [`docs/VALIDATION.md`](docs/VALIDATION.md) |
| Is it reliable? | Not yet shown: one run each, and the two erred in opposite directions | same |
| Can the recording be done on a crowded train? | It took three redesigns of the temporary recorder (thumb-zone buttons, press-and-slide time nudge, next step chosen from what just happened) | [`docs/RECORDER.md`](docs/RECORDER.md) |

## Documents

| File | What it holds |
| --- | --- |
| [`docs/SPEC.md`](docs/SPEC.md) | Specification: data model, engine contract, route knowledge, worked examples (acceptance tests) |
| [`docs/FIELDS.md`](docs/FIELDS.md) | Field dictionary shared with the temporary recorder (one schema, one version counter) |
| [`docs/VALIDATION.md`](docs/VALIDATION.md) | Every prediction and what actually happened |
| [`docs/RECORDER.md`](docs/RECORDER.md) | How the recorder was designed, phone automations, the "observations, not facts" principle |

## Core idea: a self-calibration loop

```
plan → tap checkpoints on the way → measured intervals update the model → next plan is more accurate
```

- Every interval in the engine ("door → gate", "transfer at Station T2") stores a **default**, **your measurements**, and a **sample count**.
- Measurements are kept as **ranges grouped by context** (alone / with someone / stopped at a convenience store…), not single numbers.
- New values are **proposed, never applied silently** — you confirm before the model changes.
- The engine is generic; the route is just configuration. Moving to a new workplace means swapping one config file.

## Three layers of data

| Layer | Contents | Source |
| --- | --- | --- |
| Raw | Route config; train-centric timetable (every stop's arrival/departure and platform) | You / scheduled scraper |
| Observations | Checkpoint log (optionally tagged with the train you rode); platform & seat reports | **You, others, official statistics** |
| Derived | Interval estimates; per-train delay distributions; car recommendations | Weighted from observations, applied only after you confirm |

Observations have an **observer**: yourself, other people (rail-fan guides, commuter posts), or official statistics. The three overlap like circles rather than stacking — where they agree, confidence goes up; as your own samples grow, your weight grows and others' voices fade out.

## Cold start

When you move somewhere new you have zero personal data. An agent searches official data and community guides, extracts each useful claim as *claim + source + date*, and you approve what goes in. The engine ranks two or three candidate routes from that; you try them and your own observations gradually take over.

## How this project is being built

The specification is the source of truth. It includes worked examples taken from real (masked) commute logs, written as *given this input → expect this output*. They double as acceptance tests: another agent rebuilding the engine from the spec alone must reproduce them.

## Roadmap

**Near term**

1. Repeat the prediction test with other agents that only read the data, and log every prediction against what happened
2. Before the next workplace starts, make recording more passive (recorder v7 + phone automations), then run the cold start there: official timetables and other people's experience first, the owner's own data taking over as it accumulates
3. Build the production recorder UI, import the temporary recorder's data, then the engine — the worked examples in the spec become its first failing tests

**Stages**

| Stage | Scope |
| --- | --- |
| 1 Recorder | One-tap checkpoint logging with context tags; local storage; export |
| 2 Engine | Pure-function planner + tests; route config; predictions as ranges; lateness check |
| 3 PWA | Reads clock and location on open; proposes calibrated constants for confirmation |
| 4 Timetable | Scheduled scraping → versioned timetable file; app compares versions before each query |
| 5 Seat reports | Self reports + summary; opt-in sharing |
| Later | Open API, agent skill, native iOS |

## Tech

TypeScript · React + Vite · PWA · IndexedDB · Vitest

## Development

Requires Node.js 22.12 or later.

```sh
npm install
npm test          # Vitest, run once
npm run dev       # local dev server
npm run build     # typecheck + production build into dist/
```

## Data and privacy

- Personal commute logs are **not** committed to this repository. The examples in the spec come from real logs with dates removed. The home-side stations are named (Funabashi and Tsudanuma, on the JR Sobu line); transfer stations and the workplace stay masked.
- Timetable data is not committed. Before any public data release the source will move to a redistributable one (e.g. ODPT).
