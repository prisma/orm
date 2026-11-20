# Project health rollup: agent-native

**Cadence:** session-bookend (opening rollup; unattended mode began mid-rollup)
**Date:** 2026-07-03 15:40 UTC

## Progress

- **Slices delivered:** 0 / 4
- **Slices in flight:** none
- **Slices not started:** S1 `init-skill-install` (TML-2968), S2 `generate-skill-offer`
  (TML-2971), S3 `safety-mcp-audit` (TML-2969), S4 `typed-sql-unhide` (TML-2970)
- **Direct changes / adopted work:** TML-2972 (marker refresh) **Done** — PR #29684 merged
  2026-07-03 13:48 UTC, approved. TML-2973 (mongodb-upgrade skill) not started; lands in
  prisma/skills.
- **Project-DoD coverage:** (1) init install → S1; (2) once-ever offer → S2; (3) #29684
  merged ✅ + MCP test → S3 (partially met); (4) content tasks → sibling project + TML-2973
  (not addressed); (5) typedSql visible → S4; (6) telemetry → S2; (7) close-out → end. All
  conditions reachable from the slice set + external dependencies.

## Drift signals

- **[informational]** TML-2972 read "In Progress" while its PR had already merged — status
  corrected during this rollup. No action.
- **[informational]** The project workspace lives on `agent-native-spec` (PR #29688, open);
  slice branches cut from `main` will not carry it. Handled by decision D4 (workspace stays in
  this checkout; slices in isolated worktrees). No action.

## Throughput

- **Dispatches/day:** n/a — zero dispatches so far
- **Median dispatch wallclock / rounds-to-satisfied:** n/a

## Calibration

- No prediction history yet; first data lands with S1's dispatches.

## Recommended next pick

1. **S1 `init-skill-install` (TML-2968)** — heads the stack, unlocks S2, pure prisma/prisma,
   no external dependencies.
2. _(parallel-eligible)_ **S3 `safety-mcp-audit` (TML-2969)** — newly unblocked by the #29684
   merge; small and disjoint from S1. Pick up after S1's dispatch loop is running or done.
3. _(parallel-eligible)_ **S4 `typed-sql-unhide` (TML-2970)** — requires a prisma-engines
   checkout; verify availability before starting.

## Triggers

- Proceed to `drive-specify-slice` → `drive-plan-slice` → `drive-build-workflow` for S1
  (authorized by unattended policy, decision D2).
- No scope-shift candidates; no retro triggers.
