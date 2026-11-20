# Project health rollup: agent-native

**Cadence:** session-bookend (unattended session close)
**Date:** 2026-07-04 ~00:05 local (2026-07-03 22:05 UTC)

## Progress

- **Slices at DoD with PRs open:** 3 / 4 —
  S1 [#29689](https://github.com/prisma/prisma/pull/29689),
  S2 [#29690](https://github.com/prisma/prisma/pull/29690) (stacked on S1),
  S3 [#29691](https://github.com/prisma/prisma/pull/29691). None merged (human review
  pending; nothing merges unattended).
- **S4:** Half A delivered — [prisma-engines#5836](https://github.com/prisma/prisma-engines/pull/5836)
  open; Half B paused at the wasm-publish boundary (prep note in the slice
  `verification.md`; TML-2970 updated).
- **Scoreboard:** 8 PASS / 0 FAIL / 1 ACCEPTED DEFERRAL (AC-3, permission-gated external
  filings) / 1 OUT OF SCOPE (AC-10, Half B deferred by design). Findings log empty across
  all 9 dispatches and 10 review rounds.
- **Project-DoD:** conditions 1, 2 implemented pending merges; 3 fully implemented pending
  merge; 5 half-delivered (engines side); 4 (content) untouched — sibling project pending
  its own ceremony; 6 (telemetry live in PostHog) rides S2's merge + a dogfood run; 7
  (close-out) far.

## Drift signals

- **[informational]** S4 will silently stall at its publish boundary without an external
  trigger — the operator should watch engines#5836 and re-enter Half B after the dev wasm
  publishes. No unattended action available.

## Throughput (session totals)

- 9 dispatches (S1: 3, S2: 3, S3: 2, S4: 1), 10 review rounds, 0 failed dispatches,
  1 stop-condition round (I12, resolved by spec amendment D13), 1 session-limit stall
  (retried cleanly, D15). 8 commits across 4 branches in 2 repositories.

## Calibration

- Dispatch counts matched plans (3/3, 3/3, 2/2, 1+1 with D2 orchestrator-direct).
- One retro fired and landed (`drive/spec/README.md`): probe external-tool behavior at spec
  time. The rule paid for itself twice the same day (S3's probe-first found good news
  cheaply; S4's probe caught the ANSI-color snapshot trap before it burned a round).

## Recommended next (operator, Monday)

1. Review/merge #29689 → retarget #29690 to `main` → merge; merge #29691 (independent).
2. File the two external items from S1's `verification.md § Operator to-do` (tagging ask on
   prisma/skills; symlink bug on vercel-labs/skills); record URLs against AC-3.
3. Watch engines#5836; after merge + dev wasm publish, execute Half B per the S4
   `verification.md` prep note.
4. Run the sibling ceremony (drive-create-project in prisma/skills) for the content suite —
   it gates S2's stable release and project-DoD condition 4.
5. Read `unattended-decisions.md` (D1–D15) — D9 (PR-open authorization reading), D13
   (`--copy`), and D14 (AC-3 deferral) are the ones worth a deliberate nod.
