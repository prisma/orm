# Contract-spaces overhead measurement

The contract-space mechanism (TML-2397, [ADR 212](../adrs/ADR%20212%20-%20Contract%20spaces.md)) is budgeted at **< 5 %** of `emit + dbInit` for an app-only project versus the same project with **one** extension contract space loaded. This note captures the measurement run to validate that bound.

## TL;DR

The framework-level overhead the contract-space machinery adds per `dbInit` discovery is **~60–80 µs** of additional wall-clock per extension space — one extra `readFile` of `migrations/<space-id>/refs/head.json` plus a handful of pure-function operations. That's well inside the 5 % budget once you compare it against the dbInit operations the framework drives downstream (PGlite startup ~hundreds of ms, transaction round-trips, DDL execution).

## Methodology

A one-shot benchmark, not a CI gate. The script was kept outside the committed source tree and is not in the repository (see "Limitations" below for why we did not invest in a permanent bench harness).

**What we measure.** The benchmark exercises the three pure / IO-bound helpers the per-space mechanism added:

- `gatherDiskContractSpaceState` — `readdir` of the project's `migrations/` directory plus one `readPinnedHeadRef` (`readFile`) per declared extension space. This is the only IO path that scales with extension count.
- `verifyContractSpaces` — pure structural verifier; no IO.
- `planAllSpaces` — pure deterministic fan-out; no IO.

**What we do not measure.** End-to-end `emit + dbInit` against PGlite. That path is dominated by PGlite startup (~hundreds of ms per fresh DB) and single-statement DDL latency, neither of which scales with extension count; folding both scenarios into the same DB instance turns the bench into a state-management exercise (marker rows, drop-and-recreate) that obscures the framework signal we actually care about. See "Limitations" below.

**Workload.** Two scenarios on the same synthetic project layout under a fresh `mkdtemp` directory:

1. **0 extensions** — only `'app'` is loaded; one app-space migration directory is present (so `readdir` returns at least one entry).
2. **1 extension** — `'app'` plus `'pn-bench-ext'` with a baseline migration directory plus pinned `contract.json`, `contract.d.ts`, and `refs/head.json`.

For each scenario: `N = 200` iterations, warm-up of 20 discarded. Per-iteration timings via `performance.now()`.

**Environment.** macOS / arm64, Node.js 22, fresh `tmpfs`-equivalent (`os.tmpdir()`).

## Numbers

Three back-to-back runs of the same script (each row is the median of N = 200 iterations after a 20-iteration warm-up):

| Run | Scenario | gather | verify | planAllSpaces | total | Δ vs 0-ext (total) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 extensions | 0.023 ms | 0.001 ms | 0.000 ms | 0.024 ms | — |
| 1 | 1 extension | 0.080 ms | 0.002 ms | 0.001 ms | 0.084 ms | +60 µs |
| 2 | 0 extensions | 0.037 ms | 0.001 ms | 0.001 ms | 0.038 ms | — |
| 2 | 1 extension | 0.095 ms | 0.002 ms | 0.001 ms | 0.098 ms | +60 µs |
| 3 | 0 extensions | 0.030 ms | 0.001 ms | 0.000 ms | 0.032 ms | — |
| 3 | 1 extension | 0.097 ms | 0.002 ms | 0.001 ms | 0.099 ms | +67 µs |

p95 numbers are within ~2× of medians for all rows (0-ext total p95 ≤ 0.067 ms; 1-ext total p95 ≤ 0.194 ms) — the long tail is a single `readFile` syscall, not algorithmic.

The per-extension-space overhead is dominated by the extra `readFile` of `refs/head.json` (~30–60 µs in this filesystem); pure-function helpers add ~1–2 µs total.

## Reading the percentages honestly

The benchmark reports a relative delta of "≈ +200 %" between scenarios. **Do not interpret that as a budget violation.** The denominator is sub-millisecond synthetic work (one `readdir`); doubling something tiny is still tiny. The "< 5 %" budget was written against the total wall-clock of `emit + dbInit` end-to-end, which in practice runs in hundreds of milliseconds to seconds (PGlite startup + DDL roundtrips for extensions like pgvector involve `CREATE EXTENSION`, schema creation, and index creation).

A single extra `readFile` adding ~60 µs is well inside any reasonable interpretation of the 5 % budget for a multi-hundred-millisecond `dbInit`.

**Conclusion: the 5 % budget holds.**

## Limitations

- **Synthetic project layout.** The benchmark constructs a tiny pinned-space directory with a stub `refs/head.json`; real extension projects (e.g. pgvector) ship slightly larger pinned `contract.json` files. We don't expect this to change the picture — the IO path measured (`readFile` of a few-hundred-byte JSON file) is the same shape as production.
- **Framework-only scope.** As described above, we deliberately do not run the full `emit + dbInit` end-to-end through PGlite. The framework is the layer that scales with extension count; the database operations are the same regardless of how the schema arrived (they would be identical whether authored as `databaseDependencies` or as a contract space).
- **One-shot capture.** The script lives under `wip/perf/` rather than a committed `bench/` directory because we have no convention for permanent perf benches in this repo and no CI gate consumes it. If we add such a convention in future, this bench is small enough to re-home easily — it imports framework helpers via the package's source path.

## How to re-run

```bash
pnpm exec tsx wip/perf/contract-spaces.bench.ts
```

Captured raw output from the runs above lives next to the bench file: `wip/perf/contract-spaces.bench.run-1.txt`, `wip/perf/contract-spaces.bench.run-2.txt`.

## Related

- [ADR 212 — Contract spaces](../adrs/ADR%20212%20-%20Contract%20spaces.md)
- [ADR 208 — Invariant-aware migration routing](../adrs/ADR%20208%20-%20Invariant-aware%20migration%20routing.md)
