# Specification v0.1

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
| checkpoint | A recordable point on the way: leave home, enter gate, reach platform, board, seated, alight, arrive. Each has a fixed event name |
| interval | Time between two adjacent checkpoints |
| constant | The interval value the engine uses: default + measurements + sample count |
| origin train | A train that starts at this station and arrives empty; people queueing can get seats |
| lead | Minutes between joining the queue at your target car and departure. Only meaningful for origin trains |
| route config | Home, workplace, commuter-pass section, sign-in deadline. Replaced when the workplace changes |
| route knowledge | Rules learned for one specific route; not part of the engine |
| deadline | When you must be inside the building (08:55 in the first fixture) |
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
  deadline: string;          // "08:55"
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
type Observer = "self" | "others" | "official";

type Observation = {
  schemaVersion: number;     // record format version; old records are upgraded on read
  observer: Observer;
  source?: { url?: string; title?: string; publishedAt?: string };  // required for others/official
  observedAt: string;
};

type CheckpointEvent = Observation & {
  sessionId: string;
  event: string;             // "HOME_EXIT" | "GATE_IN" | "SEATED" | ...
  place?: string; car?: string;
  trainId?: string;          // which train; enables automatic delay measurement
  context?: string[];        // e.g. ["with-someone", "convenience-store"]
  serviceStatus?: "normal" | "disrupted" | "holiday";
  note?: string;
};

type PlatformReport = Observation & {
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

TypeScript types disappear at runtime and IndexedDB does not check fields, so every observation carries `schemaVersion` and is upgraded on read. Timetable and observation formats are kept independent: switching the timetable source only touches `Train`.

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
    arrival: string;
    lateMin: number;         // > 0 means late; UI shows it in red
    seat: "high" | "untested" | "low" | "standing";
  }[];
  recommended: number;
  reason: string;            // one sentence, written for the human
}
```

Ranking: drop options that would be late (if all are late, keep the least late), then maximise `-arrival + seatScore × seatPriority`.

## First fixture: route knowledge (masked)

Stations are masked: **H** = home station, **O** = origin station one stop back from H, **T1** / **T2** = transfer stations, **W** = workplace station. Lines: **L** = local line H↔O, **R** = rapid line O→T1→T2, **Y** = loop line T1/T2→W.

| Rule | Evidence (masked sample count) | Status |
| --- | --- | --- |
| Only origin trains give a realistic chance of a seat; first in line on a non-origin train still stood | 2 samples | Confirmed |
| Origin train, lead ≥ 10 min → seated | 5 of 5 (lead 10.6–14 min) | Confirmed (≥ 10) |
| Lead 5–9 min → unknown | 1 inferred sample | Needs data |
| Go back to O for the 07:37 origin train only if through the H gate by 07:18 | 3 samples | Confirmed; the rapid line may push the cutoff later |
| The 07:52 origin train is never an on-time option | Scheduled T2 arrival + measured delay → past deadline | Confirmed |
| The 07:37 train reaches T2 1–7 min behind schedule | 3 samples (+6.9 / +1.2 / +6.0) | Default +5 |
| Boarding directly at H, avoid trains terminating at T1 | Forces a loop-line transfer, ~10 min longer than via T2 | Confirmed |
| Limited expresses are not covered by the pass | Official timetable | Confirmed |
| Holidays, reduced-service and heavy-rain days are excluded from baseline | 2 samples | Confirmed |

## Cold start: a new place

With zero personal observations the engine has nothing to work with. Start from official data and other people's experience, then let personal observations replace them.

1. The user says "I'm going to a new workplace X"
2. An agent searches official data and guides, extracting each claim as *claim + source + date* (natural-language extraction)
3. The user reviews; approved items are stored as `observer: "others"` or `"official"`
4. The engine ranks two or three candidate routes
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

All three come from real logs, masked. An agent rebuilding the engine from this document alone must produce the *Expected* column.

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

### C — already too late to go back to O (regression test)

- Input: weekday, `now = 07:26`, `position = STATION_H`
- Expected recommendation: board the 07:30 or 07:33 rapid at H + green car, **building ≈ 08:31–08:34**
- Expected **not** recommended: the 07:52 origin train from O — even if the user asked for a seat, `lateMin > 0` (building ≥ 08:57); must be shown in red, with `reason` explaining "07:37 is no longer reachable (L arrives O at 07:35, only 2 min); 07:52 would be late"
- Measured: went back to O, sat on the 07:52, about 5 min late. The point: **a seat request must not override the deadline** when an on-time seated option (direct + green car) exists

## Architecture and tech

The recorder writes checkpoints to local storage; measured constants feed the engine; the engine produces the next recommendation. The server does one thing: scrape the timetable monthly and publish a versioned file.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript | One engine runs on the phone, the server, and for agents |
| Front end | React (tentative) + Vite | Widely used; to be confirmed |
| Form | PWA | No store release, one codebase; cannot do background location |
| Local storage | IndexedDB | Large enough, stays on the device. Not cookies: ~4 KB, sent with every request |
| Timetable | Server-side scheduled scrape → versioned file | Browsers can't read the operator site directly (CORS); the app only compares version numbers |
| Hosting | Cloudflare Pages or GitHub Pages; Supabase at Stage 5 | Free static hosting is enough for Stages 1–4 |
| Tests | Vitest; the worked examples are the test cases | Same toolchain as Vite |

## Open questions

- [ ] Front-end framework: React tentative, Vue is gentler to learn
- [ ] How constants are computed: draft = per context, median and range of the last 10 baseline samples; propose after 3 samples, apply after confirmation
- [ ] Fixed list of context tags: draft a first version, merge after two weeks of use
- [ ] Automatic gate timestamps: wallet transaction trigger (does a transit-card tap fire it immediately? to be tested); joining station Wi-Fi (coarse, early); geofence (coarse); sound recognition of the gate beep (other gates interfere). Weight by precision
- [ ] Location precision: GPS can tell "home" from "near station H", not inside vs outside the gate or which platform
- [ ] Whether the rapid line from H to O moves the 07:18 cutoff later
- [ ] Lead 5–9 min: needs samples
- [ ] Timetable redistribution: before any public data release, switch to ODPT or publish only the scraper
- [ ] License
