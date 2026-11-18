# Retros — Migration statements

## 2026-10-08 — Slice 2 (TML-3476, prisma/orm#30648) and the engine change (prisma/prisma-cli#337)

Run after the merge by gauss-84, from beowulf-40's transcript and the committed dispatch briefs and QA report. Slice 1 had no retro either; its lessons that recur here are folded into F46.

| Trigger | What happened | Root cause | Landed in |
| --- | --- | --- | --- |
| Dispatch failure | Three engine reworks after review: verbs registered for the whole family, statement values the ORM could not read, `:` refused in subjects. | The engine spec described the API from the engine's side, with no ORM call sites. | `drive/calibration/failure-modes.md` F43 |
| Scope-shift escapee | The merge queue ejected #30648 on two integration tests it never touched. | The gate ran only touched journeys; PR CI skips integration tests by design. | F44; `drive/calibration/dod.md` conditional gate |
| Dispatch failure (caught in review) | Recorded extension migrations left `dataLoss` empty, so their destructive operations would have run without consent. | The brief named the new mechanism but not every path the old consent check covered. | F45 |
| Operator-flagged surprise (recurring since slice 1) | Advice texts that lost data or failed when followed; found only by executed probes and manual QA. | Advice was reviewed as copy, not run. | F46 |
| Operator-flagged surprise | The operator stopped the slice 2 spec until the architecture docs and ADRs were read; the reading changed the design. | Spec authoring grounded in code only. | `drive/spec/README.md` § Read the architecture before writing a spec |

What worked: per-command statement declarations (the operator's correction) gave one consent mechanism for flags and prompts; executed probes against PGlite, SQLite and MongoDB found every advice defect before users did; halting dispatches on named conditions surfaced the engine gaps before code was written around them.
