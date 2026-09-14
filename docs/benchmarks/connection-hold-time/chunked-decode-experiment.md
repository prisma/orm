# Yielding between include-decoding chunks

## Conclusion

**The 2 ms checkpoint strategy improves access to connections, but is not a net HTTP-latency improvement for this workload.** Median latency increased in all three overloaded pairs; p95 decreased, but the cleanest pair's improvement was small and throughput was unchanged. Do not enable it by default on this evidence.

In the final 80 requests/s pair, with no competing build/test in either before/after process snapshot:

| Metric | Current early-release patch | With child checkpoints |
| --- | ---: | ---: |
| Mean connection hold | 127.24 ms | 101.55 ms |
| Mean acquisition wait | 158.21 ms | 54.34 ms |
| HTTP p50 | 703.63 ms | 936.63 ms |
| HTTP p95 | 5895.14 ms | 5723.15 ms |
| Backlog at end of arrivals | 189 | 190 |
| Throughput including drain | 57.37/s | 57.13/s |
| App process CPU | 1.08 cores | 1.09 cores |
| Event-loop utilization | 1.00 | 1.00 |

This is consistent with servicing I/O sooner while spreading the same decoding work across more event-loop turns. Lower acquisition wait did not translate into lower typical request latency or increased service capacity. The metrics use different windows/distributions, so they must not be subtracted to claim an exact amount of queueing moved between phases.

## What was tested

Compared the **current early-release patch** against the same public build with one shared, per-query deadline passed through include decoding, nested includes, and combine row branches. Before each included child is decoded:

1. Read the monotonic clock.
2. If less than 2 ms has elapsed since this query's last resumption, continue synchronously without creating/awaiting another promise.
3. Otherwise, await `setImmediate`, then reset the deadline to 2 ms after resumption.

The deadline spans all parents' include children in that query; it is not reset for each parent. This is an elapsed-time budget, not a measurement of CPU time. It is cooperative, not preemptive: one slow child/codec can exceed the budget, and synchronous JSON parsing, parent-row decoding/mapping and HTTP serialization are not interrupted. Plain list decoding is unchanged. The prior single post-release yield is **not** combined with this strategy.

A Node `registerHooks` loader changed only the in-process public ORM module (`packages/9-public/@prisma/orm-family-sql/dist/orm-client.mjs`). No production source, codecs, on-disk builds or pool sizes were changed. The benchmark remains a standalone buffered include read, not a validation of a production scheduler API.

## Correctness and mechanism checks

- Four helper tests passed: no promise/yield below the budget, yield at the deadline, deadline reset after resumption rather than before waiting, per-query budget independence, and scheduler error propagation (the deadline test covers two assertions).
- Full HTTP include response was byte-for-byte equal between control and prototype: 100 parents, 1,000 comments, 248,225 bytes.
- An audit-only calibration observed exactly 1,000 child checkpoints and **10 actual yields** in one query. Audit collection was disabled during timing trials; this is not a measured average yield count under load.
- Every accepted trial verified the loaded module before warmup/load. All original module hashes match; only the checkpoint variant has a changed loaded hash.
- Twelve trials completed **4,320 requests**, with zero HTTP errors/capped arrivals, one lease/query/acquisition per completion and no incomplete/invalid releases. Every response had the expected byte count.

## All paired HTTP results

Each cell is **control → chunked**. HTTP durations are milliseconds; throughput includes drain. Values are descriptive, not confidence intervals.

| Includes/s | Repeat | HTTP p50 | HTTP p95 | Backlog | Completed/s |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10 | 1 | 19.30 → 19.18 | 21.91 → 23.38 | 0 → 0 | 10.0 → 10.0 |
| 10 | 2 | 19.55 → 18.74 | 469.31 → 24.71 | 0 → 0 | 10.0 → 10.0 |
| 10 | 3 | 18.98 → 19.95 | 23.17 → 22.72 | 0 → 0 | 10.0 → 10.0 |
| 80 | 1 | 750.92 → 984.27 | 6591.70 → 6100.65 | 196 → 219 | 54.5 → 56.2 |
| 80 | 2 | 794.28 → 940.24 | 7485.39 → 6047.87 | 265 → 198 | 50.7 → 55.8 |
| 80 | 3 | 703.63 → 936.63 | 5895.14 → 5723.15 | 189 → 190 | 57.4 → 57.1 |

Overloaded p50 worsened approximately **31%, 18%, 33%**. The final pair's p95 improved approximately **3%** while throughput remained flat. The apparent larger throughput/p95 gains in repeats 1/2 are not reliable causal estimates because of host interference described below. The 469 ms low-load control p95 is retained as an unexplained outlier, not evidence of a repeatable 95% improvement.

## Acquisition wait and hold, separately

Mean milliseconds; each cell is **control → chunked**.

| Includes/s | Repeat | Connection hold | Acquisition wait |
| --- | ---: | ---: | ---: |
| 10 | 1 | 3.003 → 2.819 | 0.044 → 0.044 |
| 10 | 2 | 4.645 → 2.676 | 0.044 → 0.042 |
| 10 | 3 | 3.130 → 2.879 | 0.042 → 0.041 |
| 80 | 1 | 132.486 → 95.379 | 156.753 → 36.671 |
| 80 | 2 | 125.259 → 99.824 | 115.773 → 44.412 |
| 80 | 3 | 127.235 → 101.547 | 158.205 → 54.344 |

All overloaded variants had ELU 1.0. Most consumed approximately 1.08–1.10 process CPU cores; repeat 2's control used 0.93 cores, consistent with—but not proof of—the competing-host-work confounder. Low-load CPU stayed about 0.19–0.20 cores.

## Protocol and host interference

- Same commit `b8f74562bd9afbdc2d583251112f54ee6824f089` plus existing early-release patch, Node v24.19.0, pool 10, existing PostgreSQL dataset. No additional post-release yield, profiles, builds, codec changes, query projection changes or response-size changes.
- Three paired repeats at 10 and 80 include requests/s, eight seconds of arrivals each, fresh app and two-second concurrency-10 warmup, full drain. Order control/chunk, chunk/control, control/chunk. No additional rate or budget sweep.
- Observation identical in both variants: hold/wait probes, aggregate CPU/ELU, pool/HTTP counters and PostgreSQL activity sampling. No statement-duration logging. CPU summaries select whole intervals during arrivals; HTTP/lease distributions include drain. No observer-disabled comparison was added.
- A separate worktree's Vitest run appeared before trial 9, causing a stop after eight trials. Its overlap with the preceding trial is unknown. A subsequent TypeScript job blocked immediate resumption. Resumption preserved prior results, waited for a bounded quiet window, and ran only unattempted planned labels.
- A TypeScript process was present in trial 10's after-snapshot, so repeat 2 is also potentially contaminated. Trials 11/12 had no matching build/test processes in before/after snapshots. These snapshots are **not continuous host isolation**, so even the final pair remains preliminary.
- All interruptions/snapshots are retained; no completed trial was retried or dropped. Low-load includes has only 80 samples/trial, making p99 especially unstable. The full p99/CPU/ELU/query/hold/wait distributions remain in JSON.

The narrow takeaway is a **fairness trade-off, not a faster decoder**. A mixed workload could value freeing connections for unrelated short requests, but this homogeneous workload does not test that benefit. Neither other budgets nor a production implementation were attempted.

## Evidence and reproduction

[Machine-readable results](chunked-decode-results.json).

Raw artifacts: `/Users/sevinf/projects/prisma678-benchmarks/results/chunked-decode-20260911`.

- `scripts/chunk-budget.test.mjs`, `scripts/chunk-budget.mjs`, `budget-tests.log`: scheduler helper and tests.
- `scripts/check-app.mjs`, `check-app-result.json`, `check-*-response.json`, `check-chunk-audit.json`: complete response equality and yield/checkpoint counts.
- `scripts/chunk-hook.cjs`, `chunk-*-proof.json`: exact transformations and loaded source hashes.
- `plan.json`, `manifest.jsonl`, `scripts/run-chunk-phase1.mjs`, `scripts/run-chunk.mjs`, `execution*.log`: planned and executed conditions.
- `scripts/resume-when-quiet.mjs`, `quiet-window.jsonl`, `busy-before-resume.txt`, `chunk-*-processes*.txt`: pauses and host evidence.
- `scripts/summarize.mjs`, `summary.json`, `results/concurrency/chunk-*`: raw samples and aggregation.

For a new run, copy the scratch harness to a fresh directory, update absolute public-module paths and preserve the app's intended workspace symlink. Run `node --test scripts/chunk-budget.test.mjs`, `node scripts/check-app.mjs`, `node scripts/run-chunk.mjs`, then `node scripts/summarize.mjs`. The original run used `RESUME_FROM` only after documented host-activity stops. Existing planned/result files are overwrite-protected. Do not reinstall or rebuild during a comparison.
