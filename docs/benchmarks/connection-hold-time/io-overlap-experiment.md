# Is Prisma serializing database I/O across connections?

## Answer

**Not in the tested, warmed buffered path.** Raw `pg`, the Prisma driver and the Prisma runtime overlap eight 20 ms PostgreSQL queries on eight different backends. They finish in approximately one delay interval, not eight. The trace detects serialization correctly when eight queries intentionally share one pinned connection.

With the real include payload, the extra batch latency appears mainly when adding **ORM include result consumption**. Every SQL statement is already submitted before the first query-completion callback, and pool/mutex waits are negligible. This localizes the observed amplification much more narrowly than a generic CPU-saturation observation: it is not a pool-acquisition or cross-connection mutex gate delaying submission in this probe.

This does not compare P7 directly or rule out constraints in untested paths. It distinguishes admission/locking from result consumption in the P8 path used by the existing benchmark.

## 1. Deliberately slow database, negligible decoding

Exact SQL through all three layers:

```sql
SELECT 1 AS value FROM pg_sleep(0.020)
```

Fixed pool size 10, pre-opened/warmed connections, concurrency 1/2/4/8, five batches per condition. Values below are **median whole-batch completion milliseconds**, not HTTP latency or the sum of individual query durations.

| Layer | 1 concurrent | 2 concurrent | 4 concurrent | 8 concurrent |
| --- | ---: | ---: | ---: | ---: |
| Raw `pg` | 21.19 | 21.21 | 21.29 | 21.46 |
| Prisma driver | 20.96 | 21.13 | 21.59 | 21.39 |
| Prisma runtime | 21.24 | 21.23 | 21.82 | 22.05 |

Every normal batch achieved the requested client-query overlap and number of distinct PostgreSQL backend PIDs. All statements were submitted before the first completion callback. At concurrency 8, the largest observed driver/runtime mutex wait was about **0.021 ms**; maximum pool wait across the three layers was **0.510 ms**.

**Positive control:** eight driver queries sharing one caller-owned pinned connection took **168.98 ms**, with maximum query overlap 1, one backend PID and a maximum mutex wait of **147.93 ms**. This validates that the probe can expose the serialization mechanism rather than always reporting concurrency.

## 2. Real include SQL and payload

Captured the real `Post.limit(100).include('comments')` plan and SQL. Each measured operation issued exactly that SQL, returning 100 parent rows with the aggregate payload for 1,000 comments. Compared raw `pg`, driver consumption, runtime consumption of the captured plan, and the full ORM call. The runtime layer decodes top-level rows; the ORM also decodes/maps included children into model results. These outputs are different abstraction levels, deliberately not equivalent amounts of work.

Median whole-batch completion milliseconds, five batches per condition:

| Layer | 1 concurrent | 2 concurrent | 4 concurrent | 8 concurrent |
| --- | ---: | ---: | ---: | ---: |
| Raw `pg` | 2.65 | 3.33 | 3.58 | 9.15 |
| Prisma driver | 2.48 | 2.76 | 3.25 | 5.93 |
| Prisma runtime | 4.80 | 7.77 | 9.46 | 20.30 |
| Full ORM includes | 15.47 | 29.04 | 53.52 | 106.79 |

The driver being faster than raw `pg` in one median is not interpreted as an optimization win: raw `pg` and the driver use different temporal parser policies, and the short runs have outliers. Full eight-request ranges were raw `pg` **5.77–11.05 ms**, driver **5.40–7.19 ms**, runtime **17.70–29.87 ms**, ORM **101.78–124.11 ms**. That large, repeated separation is the useful signal.

For **every** eight-request ORM batch:

- Eight different backends and eight overlapping client queries.
- All SQL submitted before the first completion callback.
- Submission spread at most **0.31 ms**.
- Pool wait at most **0.120 ms**; mutex wait at most **0.031 ms**.

The median of per-batch mean time from client query-completion callback to request completion was approximately **0.04 ms** for the driver, **1.79 ms** for the runtime and **12.04 ms** for ORM includes at concurrency 8. This includes result consumption and associated asynchronous bookkeeping; it is not a CPU profile of an individual function.

### Observer-disabled confirmation

Repeated concurrency 8 with **no load hook, no pool/query instrumentation and no probe `AsyncLocalStorage`**, five batches per layer. Median batch times were raw `pg` **8.57 ms**, driver **7.61 ms**, runtime **20.61 ms**, ORM **106.95 ms**. The large separation persists without the recorder; it is not explained solely by tracing overhead. These controls have no mutex/overlap evidence of their own. All 160 additional queries passed result-shape checks; the ORM range was 98.10–172.70 ms, so short-run variability remains material.

## 3. Example timeline: final eight-request ORM batch

Times are milliseconds from the first request starting in repeat 5. Rows are sorted by observed query completion, not request creation order. All eight statements had been submitted by **1.49 ms**.

| Request | SQL submitted | Query callback observed | Pool released | Result consumption finished |
| --- | ---: | ---: | ---: | ---: |
| 3 | 1.36 | 4.00 | 4.01 | 18.50 |
| 0 | 1.20 | 18.91 | 18.92 | 30.03 |
| 1 | 1.30 | 30.38 | 30.39 | 41.20 |
| 4 | 1.39 | 41.55 | 41.56 | 52.65 |
| 2 | 1.33 | 52.81 | 52.82 | 66.51 |
| 6 | 1.44 | 67.26 | 67.27 | 78.79 |
| 7 | 1.49 | 79.50 | 79.51 | 90.68 |
| 5 | 1.42 | 91.29 | 91.30 | 101.75 |

This pattern is consistent with one request's result-consumption work delaying processing of other ready I/O callbacks. It is **not** a series of late submissions caused by the driver mutex. The early-release patch releases promptly once JavaScript observes completion, but cannot release a client's connection before the `pg` completion callback itself is serviced.

These timestamps are JavaScript observations. They do not prove the precise PostgreSQL finish time or packet arrival time of each query. The separate raw/driver controls, identical SQL assertions and earlier independent PostgreSQL timings support the interpretation without treating callback time as server execution time.

## What this changes about the next step

Do not relax the pool limit or remove the per-connection mutex: this experiment provides no evidence that either explains this amplification, and the pinned control shows the mutex protects intentional single-connection serialization.

The next narrow target is the include-result pipeline in `packages/3-extensions/sql-orm-client/src/collection-dispatch.ts`, especially `decodeIncludePayload` and `decodeIncludedStorageRow`. A replay of captured rows separating metadata/codec lookup, codec invocation, per-cell asynchronous bookkeeping and model mapping would identify which work to optimize. This experiment does **not** identify a specific codec, GC event or function as the dominant CPU consumer, and makes no codec changes.

## Method, integrity and limits

- Same current early-release build at commit `b8f74562bd9afbdc2d583251112f54ee6824f089`, Node v24.19.0, native PostgreSQL 15, fixed pool 10. No single-yield or chunked-decoding hooks were loaded.
- 60 tiny-result batches plus one pinned positive control: **233 queries**. 80 full-payload batches: **300 queries**. Every normal request had one acquisition, release, submission and successful completion. All expected row-count/tiny-value/ORM-child-count assertions passed.
- All three normal layers use the same pool. Connections, runtime binding and paths were warmed before measurement. Marker verification was disabled to isolate warmed request execution, not first-use initialization. Five repeats alternate layer order forward/reverse. The full ORM rebuilds its query plan; the runtime control reuses a captured plan. Submission timestamps show planning did not serialize I/O in the measured ORM batches.
- Traces record request start/end, pool request/acquired/release, mutex request/acquired/released and `pg.Client.query` submit/completion. `AsyncLocalStorage` preserves request identity across callbacks. Pool and callback instrumentation preserves callback/promise entry points used here.
- A process-local loader wraps only the existing per-client mutex acquisition to record its boundaries; it does not change the mutex's queue or release behavior. The same driver module source hash was verified in both probes. Two helper tests and the real pinned positive control validate the recorder/overlap calculation.
- Row assertions and JSONL writes happen after each measured batch, not inside request timings. No HTTP, response serialization, open-loop arrivals or CPU profiling are included. These results cannot be numerically substituted for prior HTTP p95 or P7/P8 comparisons.
- Process snapshots showed no recognized build/test command before or after either probe, but do not establish continuous host isolation. Outliers remain in raw results, including a 52.94 ms driver batch at concurrency 2 and a 26.05 ms runtime batch at concurrency 1. Medians are descriptive, not confidence intervals.
- The first full-payload setup attempt failed before timing because the standalone process lacked the app's Temporal global. Importing the existing `temporal-polyfill/full/global` dependency, exactly as the benchmark app does, fixed setup. The failed log is retained; no failed timed sample was discarded. No polyfill or codec implementation was changed.
- Caller-owned transactions, prepared-statement contention, cursor streaming, cold connection creation, first-use marker gates and mixed workloads are not comprehensively tested by this probe.

## Evidence and reproduction

[Machine-readable summary](io-overlap-results.json).

Raw root: `/Users/sevinf/projects/prisma678-benchmarks/results/io-overlap-20260911`.

- `scripts/trace.mjs`, `scripts/trace.test.mjs`, `trace-tests.log`: boundary recorder and tests.
- `scripts/mutex-hook.cjs`, `*-proof.json`: exact process-local wrapper and public driver hashes.
- `scripts/run.mjs`, `*-sql.txt`, `*-run.log`: executable probes and exact SQL.
- `tiny-events.jsonl`, `full-events.jsonl`: individual timestamped events with request/backend identity.
- `tiny-summary.json`, `full-summary.json`: all per-batch/per-request timings, including outliers.
- `scripts/check-uninstrumented.mjs`, `uninstrumented-summary.json`, `uninstrumented-run.log`: 20 observer-disabled eight-request batches.
- `scripts/summarize.mjs`, `summary.json`: grouped medians/ranges, observer-disabled results and the example timeline.
- `*-processes-*.txt`, `full-setup-failure.log`: host/setup evidence.

Use a fresh artifact directory and update absolute module/app paths before reproducing; summary overwrite is refused. With `ROOT` set to that directory:

```bash
node --test "$ROOT/scripts/trace.test.mjs"
NODE_OPTIONS='' OVERLAP_PROOF="$ROOT/tiny-proof.json" SCENARIO=tiny \
  node --require "$ROOT/scripts/mutex-hook.cjs" "$ROOT/scripts/run.mjs"
NODE_OPTIONS='' OVERLAP_PROOF="$ROOT/full-proof.json" SCENARIO=full \
  node --require "$ROOT/scripts/mutex-hook.cjs" "$ROOT/scripts/run.mjs"
NODE_OPTIONS='' node "$ROOT/scripts/check-uninstrumented.mjs"
node "$ROOT/scripts/summarize.mjs"
```

The existing native PostgreSQL instance was reused. If it needs management, use `nix shell nixpkgs#postgresql_15`; no native dependency was installed through npm. No production source or on-disk production build was modified.
