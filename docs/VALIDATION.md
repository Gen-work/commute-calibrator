# Validation log

Every time the tool (or an agent standing in for the engine) makes a prediction, the prediction and what actually happened go here. The point is to accumulate prediction error, not to collect wins.

Stations are masked as in [`SPEC.md`](SPEC.md): **H** home station, **O** origin station one stop back, **T2** transfer station, **W** workplace station. Dates are removed; times are local.

## PoC: data → prediction (passed)

**Question asked:** "If I leave at this time, which way should I go, and when will I check in?"

Two agents answered from the recorded data alone. The engine (`plan()`) is not built yet, so this tests whether the *data* is enough to plan from, not the code.

| Run | Context the agent had | Prediction | Actual |
| --- | --- | --- | --- |
| 1 | **Weak:** never saw the conversation; read only the exported samples and their notes (Gemini) | Leave 07:27, go back to O for the 07:52 origin train → check in 08:58–09:05 | Seated 07:43, checked in 09:03 |
| 2 | **Strong:** took part in the whole project (Claude) | Already at H by 07:37, take the rapid straight to T2, standing → check in around 08:55 | Checked in 08:49 |

Both picked the route the owner actually wanted, and both check-in windows contained (run 1) or were close to (run 2) the real time.

**What this does and does not show**

- One run each: it shows the data *can* support a plan, not that the plan is *reliable*
- The two errors lean in opposite directions. The weak-context agent overstated a fact ("seat rate 100%" — the data has two mornings without a seat). The strong-context agent was conservative on time (it planned from the slowest days)
- Side result: with similar departure times, going back to O for a seat checked in about 14 min later than standing on the direct rapid from H

**Background samples** (complete records only; some check-in times were reported afterwards rather than tapped)

| Route | Days | Check-in |
| --- | --- | --- |
| Back to O, 07:52 origin train, seated | 3 | 09:05–09:06 |
| Direct rapid from H, standing | 2 | 08:59, 09:01 |

**Checked:** on one of the no-seat mornings the owner was already at O by 07:35. The record does not name the train, but the queue started at 07:35:40 and "no seat" came at 07:36 — boarding within a minute, which fits a train already waiting, not a 17-minute queue. The owner confirmed it was the 07:37 (lead ≈ 1.5 min) — not a counterexample to "origin train, lead ≥ 10 min → seated". The 09:05–09:06 check-ins were not treated as late at the first workplace (grace ≥ 6 min there).

## Next

1. Repeat the same question with other agents that only read the data, and log prediction vs actual here
2. Before the next workplace (**W2**, from next month) starts, make recording more passive: recorder v7 plus phone automations that tap checkpoints automatically (see [`RECORDER.md`](RECORDER.md)). W2 starts from a cold start (official timetables + other people's experience) and is handed over to the owner's own data as it accumulates
3. After every recommendation, record the outcome, so prediction error accumulates
