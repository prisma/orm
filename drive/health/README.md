# drive/health — project-context for project-health rollups

Loaded by `drive-check-health` and (via it) `drive-deliver-workflow`. Holds prisma-next's drift-signal thresholds, pick-next heuristics, throughput baselines.

> **Trial period in effect (ends 2026-06-02).** When any drive-* skill in this category produces a finding, record it in [`findings.md`](./findings.md). Quality bar, tags, and format live in [`drive/trial.md`](../trial.md).

## Drift-signal thresholds

Threshold values for the canonical drift signals (calibrate as the team gathers data). These are *signals that trigger a recheck*, not validity criteria — the validity test is INVEST at each altitude (see [`docs/drive/principles/sizing.md`](https://github.com/prisma/ignite/blob/main/docs/drive/principles/sizing.md)).

- **Dispatch failed dispatch-INVEST in flight**: had to be halted or split mid-execution because the outcome turned out fuzzier than the brief named, or scope expanded beyond the brief's `In` list.
- **Slice coherence broke down in flight**: reviewer flagged that the PR spans concerns they can't hold in one sitting; OR the dispatch sequence drifted across unrelated outcomes.
- **Slice dispatch count exceeded plan**: actual > 2× planned (likely a slice-INVEST or dispatch-INVEST miscalibration at plan time).
- **Failed-dispatch rate**: > 30% of dispatches in rolling 7d window required `ANOTHER ROUND NEEDED` or worse.
- **Long-running in-flight slice**: > 5 calendar days from first dispatch to merge.

Severity defaults:

- 1 signal of any kind: **informational** (surface but no action).
- 2 signals in the same slice OR 1 signal repeating across slices: **warning** (consider retro at next merge).
- 3+ signals OR a slice-coherence break OR dispatch-count > 3× plan: **scope-shift-candidate** (recommend `drive-start-workflow` mid-flight re-triage).

## Throughput baselines

Calibrate from operator's historic pace; defaults below are placeholders to be updated.

- **Dispatches/day** (interactive operator, full-time): _~3-5_.
- **Median dispatch wallclock**: _~45 min_.
- **Median rounds-to-satisfied**: _~1.5_ (rare 3+ should fire a retro).

## Pick-next heuristics (when multiple slices are ready)

1. **Unblocks others first.** If picking slice A unblocks slices B + C (which can then go parallel), prefer A over a leaf slice.
2. **Operator's flow state.** If the operator is mid-flow on a domain (e.g. just shipped a SQL-emitter slice), the next slice in the same domain has lower context-switching cost.
3. **Risk-reduction first.** If a slice tests a high-risk assumption (per the spec's load-bearing assumptions), prefer it — falsification cheaper now than after fan-out.
4. **Stale slices.** A ready slice that's been sitting > 3 days should go up the queue; staleness corrodes context.

## Common false-positives (signals to ignore in this repo)

- **`pnpm fixtures:check` failure on a dispatch that touched extensions**: not drift; expected; the dispatch should explicitly regenerate. Don't flag unless the regenerate step was missed.
- **A dispatch that runs a whole suite** (`pnpm test:packages`, `pnpm test:all`, integration or e2e) locally: drift. Whole suites run in CI ([`running-tests.mdc`](../../.agents/rules/running-tests.mdc)).

_(Living; add as the team accrues data.)_
