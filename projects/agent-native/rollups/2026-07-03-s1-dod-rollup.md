# Project health rollup: agent-native

**Cadence:** per-slice (S1 at DoD, PR open — converted from per-merge by decision D6)
**Date:** 2026-07-03 ~16:50 UTC

## Progress

- **Slices delivered:** 0 / 4 merged; **1 / 4 at DoD with PR open** — S1 `init-skill-install`
  ([PR #29689](https://github.com/prisma/prisma/pull/29689), TML-2968 In Review; 4 commits,
  scoreboard 2 PASS + 1 ACCEPTED DEFERRAL, findings log empty).
- **Slices in flight:** none (S1 awaiting human review; nothing merges unattended).
- **Slices not started:** S2 `generate-skill-offer` (TML-2971), S3 `safety-mcp-audit`
  (TML-2969, now unblocked — #29684 merged), S4 `typed-sql-unhide` (TML-2970).
- **Adopted work:** TML-2972 Done. TML-2973 (mongodb skill) untouched — sibling-repo work.
- **Project-DoD coverage:** condition 1 (init install) — implemented, pending merge;
  condition 3 — half met (#29684 merged; MCP test = S3); others unchanged.

## Drift signals

- **[informational]** S1 took 4 rounds across 3 dispatches (plan predicted 3); the extra
  round was the I12 stop on the skills-CLI symlink no-op — resolved by spec amendment
  (D13), not scope drift. No action.
- **[informational]** AC-3 externalities are permission-gated (D14) — operator filings
  pending Monday. No action available unattended.

## Throughput

- **Dispatches:** 3 dispatched, 3 completed, 0 failed; rounds-to-satisfied: 1, 1, 2.
- **Wall-clock:** ~1h05m from slice-started to PR-open (including one full monorepo
  dependency build and live network verification runs).

## Calibration

- Dispatch count matched plan (3/3); one unplanned round from an external-tool behavior the
  spec assumed from its documentation — **retro trigger** (falsified assumption, I12).
- Sizes: M/M/S predictions held; no time-box overruns.

## Recommended next pick

1. **S2 `generate-skill-offer` (TML-2971)** — stacked on S1's branch per D5 (PR base =
   S1's branch, retarget after merge). Maximum continuity: same implementer, same worktree,
   runner interface fresh in transcript.
2. Then **S3 `safety-mcp-audit`** (independent, branches from main).
3. Then **S4 `typed-sql-unhide`** — engines PR can be authored, but the prisma/prisma half
   needs a published schema-wasm, so S4 can only reach "engines PR open" unattended.

## Triggers

- **Retro trigger (I12 falsified assumption)** → `drive-run-retro` (unattended auto-invoke
  permitted) — lesson candidate: external-CLI behavior must be probed empirically at
  spec time, not assumed from its documentation.
- Proceed to S2 via specify → plan → build (unattended policy D2).
