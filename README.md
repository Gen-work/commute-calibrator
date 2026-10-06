# Commute Calibrator (working title)

A personal commute planner that gets more accurate the more you use it.

Timetables are public data — anyone can scrape them. What nobody else has is *your* numbers: how long it really takes you to get from your door to the ticket gate, how often the 07:37 actually runs late, which car you can still get a seat in if you join the queue ten minutes early. This project is built around collecting those numbers and feeding them back into the plan.

> **Status:** design phase. The specification is written; implementation starts with the recorder (Stage 1). See [`docs/SPEC.md`](docs/SPEC.md).

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

| Stage | Scope |
| --- | --- |
| 1 Recorder | One-tap checkpoint logging with context tags; local storage; export |
| 2 Engine | Pure-function planner + tests; route config; predictions as ranges; lateness check |
| 3 PWA | Reads clock and location on open; proposes calibrated constants for confirmation |
| 4 Timetable | Scheduled scraping → versioned timetable file; app compares versions before each query |
| 5 Seat reports | Self reports + summary; opt-in sharing |
| Later | Open API, agent skill, native iOS |

## Tech

TypeScript · React (tentative) + Vite · PWA · IndexedDB · Vitest

## Data and privacy

- Personal commute logs are **not** committed to this repository. The examples in the spec are masked (stations replaced with letters, dates removed, workplace unnamed).
- Timetable data is not committed. Before any public data release the source will move to a redistributable one (e.g. ODPT).
