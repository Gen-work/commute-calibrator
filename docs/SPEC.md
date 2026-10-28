# Specification v0.2

## First principle

Timetables are public data; the value is in each person's own measured intervals. The core of this tool is not "look up the timetable" but a self-calibration loop: **plan → tap checkpoints on the way → measured values update the constants → the next plan is more accurate**.

Every constant ("how long to walk", "how long to transfer") stores a default, the user's measurements, and a sample count. Once there are enough samples the tool *proposes* switching to the user's value; it takes effect only after the user confirms. Measurements are stored as ranges (median + low/high), grouped by context tags (alone / with someone / stopped to buy water / answering messages…).

Second: **the engine is generic, the route is replaceable.** The first route below is only the first test fixture.

## Scope

Stage 1 is the recorder: logging is the core, and real samples are time-limited. The engine can come a few weeks later.

| Stage | Do | Don't |
| --- | --- | --- |
| 1 Recorder | One-tap checkpoints with context tags; IndexedDB; export | Engine, recommendations |
| 2 Engine | Pure-function engine + tests; route config; predictions as ranges; lateness | UI, location |
| 3 PWA | Read clock and location on open (auto-detect tier 1); propose calibrated constants, write back after confirmation | Background location (optional bridges listed in Open questions) |
| 4 Timetable | Server-side scheduled scraping of the official operator site → versioned timetable file; app checks version before each query | Live delay info |
| 5 Seat reports | Self reports + summary; "share" toggle; format reserved from Stage 1 | Merging multiple users' data (needs backend + anonymization design) |
| Later | Open API, agent skill, native iOS | — |

## Terms

| Term | Definition |
| --- | --- |
| checkpoint | A recordable point on the way. Two layers: **core** checkpoints have fixed event names the engine understands (leave, enter gate, reach platform, join queue, board, seated, alight, exit gate, arrive, check in); **custom** checkpoints are the user's own life steps (take out the rubbish, buy water, tie hair, wait for the lift), each hung between two core checkpoints. The engine and the open API only know the core layer. A custom checkpoint that keeps recurring (three times) is promoted to the core layer |
| interval | Time between two adjacent checkpoints |
| constant | The interval value the engine uses: default + measurements + sample count |
| origin train | A train that starts at this station and arrives empty; people queueing can get seats |
| lead | Minutes between joining the queue at your target car and departure. Only meaningful for origin trains |
| route config | Home, workplace, commuter-pass section, deadlines, checkpoint templates. Replaced when the workplace changes |
| route knowledge | Rules learned for one specific route; not part of the engine |
| soft deadline | Used for reminders only: "you are cutting it close" (08:55 in the first fixture) |
| hard deadline | Used to judge lateness, measured at the check-in checkpoint (office sign-in), not at the building door (09:00 in the first fixture) |
| grace | Minutes after the hard deadline that the workplace still accepts. Workplaces differ, so it is a config value. First fixture: at least 1 min (1 sample: signed in 1 min after the hard deadline, not counted late) |
| tap time / reported time / inferred time | Three ways to know when a checkpoint happened. The true moment is a latent variable and can only be estimated. *Tap time*: when the button was pressed (system clock). *Reported time*: what the user says, e.g. "it was 07:43" typed later, with a precision. *Inferred time*: fitted from sensors (reserved) |
| baseline | Samples from normal days used for constants; disruption days and holidays are excluded |

## Data model

Three layers. **Raw** data is configured by the user or scraped by the server. **Observations** are produced on the way; the observer can be the user, others (rail-fan guides, commuter posts), or official statistics. **Derived** values are computed from observations and take effect only after the user confirms.

The layers are not a strict hierarchy. The same fact often has official, community and personal versions, like three partly overlapping circles: overlap means higher confidence; the more personal samples, the more the user's own weight grows. Everything is stored on the device (IndexedDB); only the timetable is downloaded.

| Layer | Contents | Source | Takes effect |
| --- | --- | --- | --- |
| Raw | Route config; train-centric timetable (every stop's arrival/departure and platform) | User / server scrape | Immediately / by version |
| Observations | Checkpoint log (optionally tagged with the train); platform & seat reports (queue length, crowding, seated or not) | Self, others, official | Stored as-is |
| Derived | Interval estimates; per-train delay distributions; car recommendations | Weighted by observer | After user confirmation |

```ts
// ── Raw ──
type RouteConfig = {
  home: { label: string; lat: number; lng: number };
  workplace: { label: string; lat: number; lng: number };
  pass: { from: string; to: string; via: string[] };   // commuter-pass section
  deadline: {
    soft: string;            // "08:55" — reminders only
    hard: string;            // "09:00" — lateness
    graceMin: number;        // minutes after `hard` still accepted
    judgedAt: string;        // checkpoint that lateness is measured at; default "CHECK_IN"
  };
  customCheckpoints: { id: string; label: string; between: [CoreEvent, CoreEvent] }[];  // records store `id`; `label` can be renamed
  templates: Record<Direction, string[]>;              // ordered checkpoint ids; drives the recorder's "next" button
  seatPriority: number;      // 0 = fastest only, 20 = almost always wait for an origin train
};

// Timetable is train-centric: one train = every stop it serves
type Train = {
  trainId: string;
  timetableVersion: string;
  dayType: "weekday" | "holiday";
  dest: string;
  express?: boolean;         // limited express; not covered by the commuter pass
  stops: { station: string; arr?: string; dep?: string; platform?: string; isOrigin?: boolean }[];
};

// ── Observations ──
type Observer = "self" | "device" | "others" | "official";   // device = a phone automation

type Observation = {
  schemaVersion: number;     // record format version; old records are upgraded on read
  observer: Observer;
  source?: { url?: string; title?: string; publishedAt?: string };  // required for others/official
};

type Direction = "outbound" | "inbound";

// Core checkpoints: fixed names, the engine knows what each one means
type CoreEvent =
  | "DEPART" | "GATE_IN" | "PLATFORM" | "QUEUE_START" | "BOARD"
  | "SEATED" | "ALIGHT" | "GATE_OUT" | "ARRIVE" | "CHECK_IN";

type TimePrecision = "exact" | "approx" | "estimated";

type CheckpointEvent = Observation & {
  id: string;                // `${sessionId}-${write time in ms}`
  sessionId: string;
  direction: Direction;
  event: CoreEvent | string; // core event, or a custom checkpoint id from RouteConfig
  tappedAt: string | null;   // when the button was pressed (system clock); was `observedAt` in v2. null = unknown
  reportedAt?: string;       // when the user says it happened (typed later, a -1 / -5 min nudge, or told to an agent)
  reportedPrecision?: TimePrecision;
  reportedSource?: "tap-adjust" | "note" | "oral-report";
  recordedBy: string | null; // who wrote the row: "self", or the agent that wrote it on the user's word (observer stays "self")
  inferredAt?: string;       // fitted from sensors — reserved, not implemented
  inferredMethod?: string;
  confidence?: number;       // 0–1, for inferredAt
  place?: string;            // station code from the route's list
  placeFree?: string;        // typed name when the station is not in the list (place keeps the nearest listed one)
  car?: string;
  trainId?: string;          // which train; enables automatic delay measurement
  context?: string[];        // tag slugs, see "Context tags"
  serviceStatus?: "normal" | "disrupted" | "holiday";   // as tapped at the time; never overwritten
  serviceStatusCorrected?: "normal" | "disrupted" | "holiday";  // later correction, see "Service status"
  correctionSource?: "self-report" | "calendar" | "delay-certificate";  // service-status corrections only; extendable
  correctedBy?: string;      // who wrote the correction (the user, or an agent on their word)
  correctedAt?: string;
  note?: string;
  updatedAt: string;         // last write to this row
  rev: number;               // incremented on every write; used to resolve sync conflicts
};

// Official delay information (delay certificates, operator notices) is its own observation
type ServiceNotice = Observation & {   // observer: "official", dated by source.publishedAt
  line: string;
  from: string; to: string;  // time band it covers
  status: "disrupted";
  delayBand?: string;        // e.g. "61+ min", as published
};

type PlatformReport = Observation & {
  tappedAt?: string;         // self reports; others/official are dated by source.publishedAt
  station: string; trainId?: string; car?: string;
  queueAhead?: number;       // people ahead at this door
  crowd?: "low" | "mid" | "high";
  leadMin?: number; seated?: boolean;
  share: boolean;            // default false
};

// ── Derived: all take effect only after user confirmation ──
type Range = { median: number; low: number; high: number };

type Derived<T> = {
  value: T;
  sampleCount: Record<Observer, number>;
  weight: Record<Observer, number>;
  confirmedAt?: string;
};

type IntervalEstimate = Derived<Range> & { id: string; context: string[] };
type TrainDelay = Derived<Range> & { trainId: string; station: string };
type CarAdvice = Derived<{ car: string; reason: string }> & { station: string; trainId?: string };
```

Every field is defined in [`FIELDS.md`](FIELDS.md), the one field dictionary shared with the temporary recorder (one dictionary, one version counter). If this section and the dictionary disagree, the dictionary wins.

TypeScript types disappear at runtime and IndexedDB does not check fields, so every observation carries `schemaVersion` and is upgraded on read. Timetable and observation formats are kept independent: switching the timetable source only touches `Train`.

**Observations, not facts.** A row records who observed what, how and when; it is not the fact itself. The effective time, lateness and service status are views derived from several observations. The same pattern repeats across fields: a raw value plus a separate corrected or inferred value with its source (`serviceStatus` + `serviceStatusCorrected`, `place` + `placeSource`, review fields). Background and the recorder's design history: [RECORDER.md](RECORDER.md).

**Which time the engine uses.** For each checkpoint the effective time is `inferredAt` (once its confidence passes a threshold), else `reportedAt`, else `tappedAt`. A tap often comes late ("seated" pressed minutes after sitting down), so a tap time only says the event happened *by then*. Lower precision means lower weight in derived values; the threshold and weights are open questions.

**Corrections never overwrite.** Raw values stay as recorded. Anything learned later goes into a new field on the same row together with where it came from: a reported time with `reportedSource`, a service-status correction with `correctionSource`, `correctedBy` and `correctedAt`. There is no second copy of the data to drift apart.

**Service status.** `serviceStatus` keeps what was tapped; `serviceStatusCorrected` says which rows a correction applies to, by kind:

- `disrupted` is an observation: corrected from the row where the user noticed or recorded the disruption onward ("from now on"), not for the whole trip. Earlier rows keep their value. The recorder's delay button means "from now on"
- `holiday` is a property of the whole day: every row of that day is corrected
- Official delay information is stored as a separate `ServiceNotice`; it can be cited as a `correctionSource` but never widens a correction beyond the rule above

**Schema evolution rules**

- If a field's meaning changes, it gets a new name; old names are never reused
- Every change bumps `schemaVersion`; old rows are upgraded on read and never rewritten
- One field dictionary lists every field with a one-line definition and a change log
- When the same kind of note shows up three times, it is promoted to a field
- Backfilled values always say where they came from (`reportedSource` or `correctionSource`)

| Version | Change | Upgrade on read |
| --- | --- | --- |
| v1 → v2 | `HOME_EXIT` renamed to `DEPART` | rename the event |
| v2 → v3 | `observedAt` replaced by `tappedAt` / `reportedAt` / `inferredAt`; core event `CHECK_IN`; `direction` values; correction fields; `updatedAt` + `rev` on every row | `observedAt` → `tappedAt`; `direction` `"AM"` → `"outbound"`, `"PM"` → `"inbound"` (the letters are also inside v2 session ids); `updatedAt` ← `tappedAt`, `rev` ← 1; rows backfilled from what the user said: the stored time moves to `reportedAt` and `tappedAt` becomes the write time (or null if unknown) — full rules in FIELDS.md |

**Context tags (first version).** Stored as slugs; the UI shows the label.

| Slug | Label | Meaning |
| --- | --- | --- |
| `alone` | 独自 | Commuting alone |
| `accompanied` | 同行 | Commuting with someone |
| `convenience-store` | 便利店 | Stopped at a convenience store on the way |
| `replying-messages` | 回消息 | Stopped to reply to messages or mail |
| `missed-full-train` | 满员没上去 | A train was too full to board |
| `unwell` | 身体不适 | Not feeling well |
| `returned-for-item` | 忘东西折返 | Went back for something forgotten |

## Engine

A pure function: same input, same output; no network, no clock, no UI. It can take the worked examples below as tests unchanged.

```ts
plan(input: {
  now: string;               // passed in by the UI
  position: string;          // current checkpoint, e.g. "HOME" / "STATION_H"
  config: RouteConfig;
  intervals: IntervalEstimate[];
  trains: Train[];
  delays: TrainDelay[];
  carAdvice: CarAdvice[];
  knowledge: RouteRule[];
}): {
  options: {
    label: string;
    checkpoints: { event: string; at: string; note?: string }[];
    arrival: string;         // time at deadline.judgedAt (check-in)
    lateMin: number;         // arrival − (hard + grace); > 0 means late; UI shows it in red
    softMarginMin: number;   // soft − arrival; < 0 means past the soft deadline (reminder)
    seat: "high" | "untested" | "low" | "standing";
    basis: { sampleCount: number; note: string };  // what the prediction rests on
  }[];
  recommended: number;
  reason: string;            // one sentence, written for the human
}
```

Ranking: drop options that would be late (if all are late, keep the least late), then maximise `-arrival + seatScore × seatPriority`. Ranking only decides `recommended`: late and tight options are still listed, each with its basis.

An option that goes back to an origin station is only generated when `config.pass` covers that station. Riding back past the edge of the pass without a ticket is fare evasion (in Japan the penalty totals about three times the fare); if the pass does not cover it, the option either includes the extra ticket or is not offered.

## Reminders

A reminder states a prediction, what it is based on, and how many samples — it never decides for the user and never blocks anything. When samples are few it says so plainly ("2 samples; may be wrong"). This tool is AI-driven and will make mistakes; the user stays the one who chooses.

## First fixture: route knowledge

Home-side stations are public: **H** = Funabashi (home station), **O** = Tsudanuma (origin station one stop back from H). The rest stay masked: **T1** / **T2** = transfer stations, **W** = workplace station. Lines: **L** = local line H↔O, **R** = rapid line O→T1→T2 (it also runs downbound H→O), **Y** = loop line T1/T2→W. The commuter pass covers O, so going back to O needs no extra ticket.

Deadlines: soft 08:55, hard 09:00 at office check-in, grace ≥ 1 min.

| Rule | Evidence (masked sample count) | Status |
| --- | --- | --- |
| Only origin trains give a realistic chance of a seat; first in line on a non-origin train still stood | 2 samples | Confirmed |
| Origin train, lead ≥ 10 min → seated | 5 of 5 (lead 10.6–14 min); later, two mornings without a seat, one of them already queueing at O by 07:35 | Confirmed (≥ 10), **under review**: if that queue was for the 07:52 it is a counterexample (see [VALIDATION.md](VALIDATION.md)) |
| Origin train, lead 5–9 min → seated so far | 2 measured, both seated (T1 evening origin, lead ≈ 9; the 07:52 from O, lead ≈ 9) + 1 inferred | Promising; needs data below 9 |
| Go back to O for the 07:37 origin train only if through the H gate by 07:18 | 3 samples | Confirmed; the rapid line may push the cutoff later |
| The 07:52 origin train from O is a tight option: rideable, check-in lands right at the hard deadline | 1 sample: T2 +1.7 min late, W gate 08:53, building 08:59, checked in 09:01, not counted late; later 3 complete days checked in 09:05–09:06 | Tight; usable as backup or even main route; needs delay samples |
| To reach the 07:52: take R downbound H→O; that train turns back at O and becomes the 07:52 upbound origin. Get off as required, then re-queue on the same platform at a less crowded door — do not stay seated | 1 sample | Seen once; whether the turn-back runs every day is to be checked. If it does, the 07:18 cutoff can move later. The 07:52 queue *felt* shorter than the 07:37's — impression only, to be measured |
| Route template: at W, record only the gate exit, not alighting | The two were often tapped in the same second | Applied to this route's template |
| The 07:37 train reaches T2 1–7 min behind schedule | 3 samples (+6.9 / +1.2 / +6.0) | Default +5 |
| At T2, if the first Y train is too full to board, the transfer takes 6.5 min | 1 sample; context tag `missed-full-train` | Needs data |
| Boarding directly at H, avoid trains terminating at T1 | Forces a loop-line transfer, ~10 min longer than via T2 | Confirmed |
| Limited expresses are not covered by the pass | Official timetable | Confirmed |
| Holidays, reduced-service, heavy-rain and disrupted days are excluded from baseline | 3 samples (one disrupted morning: T2→W took 33 min vs 20 / 24 on normal days) | Confirmed |

## Cold start: a new place

With zero personal observations the engine has nothing to work with. Start from official data and other people's experience, then let personal observations replace them.

1. The user says "I'm going to a new workplace X"
2. An agent searches official data and guides, extracting each claim as *claim + source + date* (natural-language extraction)
3. The user reviews; approved items are stored as `observer: "others"` or `"official"`
4. The engine ranks two or three candidate routes. Before suggesting any route that goes back to an origin station, check that the commuter-pass section covers it (see Engine)
5. The user tries each a few times and records
6. Watch how quickly the user's own weight overtakes the others'

**Usable official data**

| Data | Answers | Feeds |
| --- | --- | --- |
| National annual congestion rates for major sections | How crowded which line is, when | Platform crowding, car advice |
| Per-station ridership | Which stations board the most people | Platform crowding |
| Operator delay certificates (recent, by line and time band) | How late a line usually runs at peak | Delay distribution |
| Station maps, "convenient car for transfer" | Which car stops near the stairs | Car advice |
| Timetable and per-train stop lists | Origin trains, arrival times, platforms | Timetable (raw) |

**Rules for using others' observations**

- Freshness: guides may be wrong after a timetable revision; every item carries a date and decays
- Different preferences: commuter posts assume "standing an hour is fine"; reinterpret through the user's own config instead of copying conclusions
- Copyright: store facts + source links only, never copied text

## Worked examples (acceptance tests)

All three come from real logs; dates removed, stations by letter (H and O are named above). An agent rebuilding the engine from this document alone must produce the *Expected* column.

### A — plenty of time, origin train, seated

- Input: weekday, normal service, `now = 07:10`, `position = HOME`
- Expected recommendation: 07:37 origin train from O. Reason: "through the H gate before 07:18, so going back to O for the origin train works"
- Expected checkpoints: H gate 07:19 → L 07:20 → O 07:24 → join queue 07:26 (lead 11, seat high) → depart 07:37 → T2 08:22 (scheduled 08:17 + default delay 5) → Y 08:25 → W 08:38 → gate 08:41 → **building 08:48**
- Measured: T2 08:18:13, W gate 08:39:43, signed in 08:53:20 (including walk to desk)

### B — left late, board directly

- Input: weekday, `now = 07:22`, `position = HOME`
- Expected recommendation: board the 07:33 rapid at H directly (don't go back to O). Reason: "H gate at 07:31, after the 07:18 cutoff"; plus "buy a green-car ticket if you want a seat"
- Expected checkpoints: H gate 07:31 → depart 07:33 → T2 08:08 → Y 08:11 → W 08:24 → gate 08:27 → **building 08:34**; seat: standing
- Measured: gate 07:31, seated after T1, W exit 08:31

### C — already too late to go back to O for the 07:37 (regression test)

- Input: weekday, `now = 07:26`, `position = STATION_H`
- Expected: both options listed
    1. **Recommended**: board the 07:30 or 07:33 rapid at H + green car, **building ≈ 08:31–08:34**, check-in with margin
    2. **Tight**: go back to O for the 07:52 origin train; seat high; check-in ≈ 09:00–09:01, right at the hard deadline + grace, `softMarginMin < 0`. Basis: 2 samples, one good and one bad (one about 5 min past the soft deadline; one checked in at 09:01, not counted late)
- `reason`: "07:37 is no longer reachable (L arrives O at 07:35, only 2 min); the 07:52 gives a seat but is tight — 2 samples, one good, one bad"
- Measured: went back to O, sat on the 07:52, about 5 min past the soft deadline
- The point: **a tight option is always listed with its risk and sample count, never hidden; when its margin is within the grace, it is never silently ranked above an option that has margin.** The user decides

## Architecture and tech

The recorder writes checkpoints to local storage; measured constants feed the engine; the engine produces the next recommendation. The server does one thing: scrape the timetable monthly and publish a versioned file.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript | One engine runs on the phone, the server, and for agents |
| Front end | React + Vite | Widely used; decided |
| Form | PWA | No store release, one codebase; cannot do background location |
| Local storage | IndexedDB | Large enough, stays on the device. Not cookies: ~4 KB, sent with every request |
| Timetable | Server-side scheduled scrape → versioned file | Browsers can't read the operator site directly (CORS); the app only compares version numbers |
| Hosting | Cloudflare Pages or GitHub Pages; Supabase at Stage 5 | Free static hosting is enough for Stages 1–4 |
| Tests | Vitest; the worked examples are the test cases | Same toolchain as Vite |

## Later features

**log your life, trick your life.** Rehearse the morning from the user's own commute log plus wake-up times (imported from a wearable through a bridge; this data stays on the device), then show a leave-by deadline slightly *earlier* than the real one, so the body starts moving sooner. For people who find time hard to sense, small tricks like this can help.

- A fake deadline stops working once it is seen through, like a clock set fast. Ideas: a random offset within bounds, or not showing how big the offset is. This is an untested hunch, not a research finding
- Reminders inform, never forbid (see Reminders)

## Open questions

- [x] Front-end framework: React
- [ ] Grace at the first workplace: the 07:52 route later checked in at 09:05–09:06 on 3 days — were those counted late? This sets `graceMin`
- [ ] Lead ≥ 10 min rule: possible counterexample (see VALIDATION.md)
- [ ] How constants are computed: draft = per context, median and range of the last 10 baseline samples; propose after 3 samples, apply after confirmation
- [ ] Effective time: confidence threshold for `inferredAt`, and weights by precision
- [ ] Cross-device sync (Stage 5): rows already carry `updatedAt` + `rev`; design the merge rule
- [ ] Station picker must accept stations outside the route's list (a nearby station was once recorded as O because it was not in the list)
- [ ] Context tags: first version above; review and merge after two weeks of use
- [ ] Automatic gate timestamps: wallet transaction trigger (does a transit-card tap fire it immediately? to be tested); joining station Wi-Fi (coarse, early); geofence (coarse); sound recognition of the gate beep (other gates interfere). Weight by precision
- [ ] Location precision: GPS can tell "home" from "near station H", not inside vs outside the gate or which platform
- [ ] Whether the rapid line from H to O moves the 07:18 cutoff later
- [ ] Lead 5–9 min: 2 measured seated so far; needs samples below 9
- [ ] Timetable redistribution: before any public data release, switch to ODPT or publish only the scraper
- [ ] License
