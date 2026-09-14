# One event-loop yield after buffered pool release

## Result and recommendation

**The yield enables the intended scheduling opportunity, but is not a reliable general latency fix in this bounded test.** Overloaded includes improved in both repeats; overloaded lists regressed in one repeat and improved slightly in the other. Keep it experimental rather than shipping an unconditional yield on this evidence.

The comparison is **the current early-release patch versus that same build plus one yield**, not the unmodified Prisma baseline. No production source or on-disk production build was changed. A process-local Node load hook inserted only:

```js
if (this instanceof PostgresPoolDriverImpl) await new Promise(setImmediate);
```

The insertion is after the buffered fetch's `finally` releases the client and before the first buffered row is yielded. Caller-owned queryables do not take this branch, and real cursor streams return before it. This tests one scheduling opportunity per buffered query, not chunked decoding or codec changes.

## Mechanism check

A real size-1 pool test queues a `setImmediate` callback on release to initiate another query. It records both query initiation and the second query's call to the underlying socket's `write` method:

- Control: **release → first row → second query socket write**.
- Yield: **release → second query socket write → first row**.

The latter is a socket-write invocation, not proof of packet delivery or PostgreSQL execution. Both cases returned the expected rows, released exactly once per pool lease, and retained the caller-owned transaction lease until explicitly released. See `check-wire-{control,yield}.json` in the raw artifacts. Earlier `check-{control,yield}.json` checks recorded API initiation only.

## HTTP results

Each row is one matched repeat. Durations are milliseconds. Backlog is client requests outstanding at the end of arrivals, not pool queue depth. Throughput includes drain.

| Endpoint/rate | Repeat | HTTP p50 control → yield | HTTP p95 control → yield | Backlog control → yield | Completed/s control → yield |
| --- | ---: | ---: | ---: | ---: | ---: |
| Lists 100/s | 1 | 3.77 → 2.80 | 10.79 → 4.17 | 0 → 0 | 100.0 → 100.0 |
| Lists 100/s | 2 | 3.66 → 2.77 | 5.65 → 3.36 | 0 → 0 | 100.0 → 100.0 |
| Lists 500/s | 1 | 481.91 → 549.85 | 3307.25 → 4176.58 | 626 → 916 | 417.3 → 394.3 |
| Lists 500/s | 2 | 379.17 → 376.66 | 2668.99 → 2533.75 | 611 → 563 | 427.4 → 433.1 |
| Includes 10/s | 1 | 22.69 → 21.69 | 26.62 → 25.54 | 0 → 0 | 10.0 → 10.0 |
| Includes 10/s | 2 | 20.43 → 21.31 | 38.02 → 26.44 | 0 → 0 | 10.0 → 10.0 |
| Includes 80/s | 1 | 752.01 → 643.47 | 5693.64 → 4652.91 | 171 → 149 | 58.7 → 62.4 |
| Includes 80/s | 2 | 680.23 → 625.11 | 5071.60 → 4949.70 | 143 → 134 | 60.7 → 62.3 |

Overloaded include p95 improved approximately **18% / 2%**, backlog fell **13% / 6%**, and throughput rose **6% / 3%**. Overloaded list p95 worsened **26%** in repeat 1 and improved **5%** in repeat 2. There was no consistent low-load latency penalty: list p50/p95 improved in both repeats; include p50 moved in opposite directions while p95 improved in both.

The low-load list CPU difference was also large (approximately 0.36 cores control versus 0.26 yield). This was not investigated; it must not be attributed to removed decoding work, JIT, or GC without evidence. Short-run/runtime/host variation remains an alternative explanation for some differences.

## Hold time and acquisition wait remain distinct

Mean milliseconds, repeat 1 / repeat 2:

| Endpoint/rate | Control hold | Yield hold | Control acquisition wait | Yield acquisition wait |
| --- | ---: | ---: | ---: | ---: |
| Lists 100/s | 1.003 / 0.861 | 0.463 / 0.461 | 0.021 / 0.020 | 0.021 / 0.020 |
| Lists 500/s | 21.274 / 20.581 | 21.814 / 20.914 | 307.514 / 277.934 | 324.526 / 289.738 |
| Includes 10/s | 3.725 / 3.232 | 3.683 / 3.454 | 0.042 / 0.049 | 0.041 / 0.046 |
| Includes 80/s | 128.382 / 124.414 | 126.776 / 129.828 | 177.210 / 169.457 | 199.661 / 207.623 |

The include HTTP improvement was **not** accompanied by lower acquisition waits: those increased in both overloaded include repeats. All overloaded conditions still showed ELU approximately 1.0 and process CPU approximately 1.08–1.10 cores. One yield does not interrupt the remaining full decode/materialization span, and the experiment does not demonstrate removal of the app-side service limit.

If investigating further, the next distinct candidate is a bounded decoding chunk with an event-loop yield between chunks, rather than another unconditional post-release yield. That candidate was **not** part of this experiment; see the subsequent [2 ms child-decoding checkpoint experiment](chunked-decode-experiment.md).

## Validation and limitations

- 16 verified trials, **22,080 completed requests**, no HTTP errors or capped arrivals. Every completion matched one lease, one query and one acquisition record; no incomplete or invalid release records. Response sizes were 17,155 bytes/list and 248,225 bytes/include.
- Same commit `b8f74562bd9afbdc2d583251112f54ee6824f089` plus existing early-release changes, same public build, Node v24.19.0, pool size 10 and existing PostgreSQL database. No installs, builds, codec edits, CPU profiles, server statement logging or extra load variants.
- Eight seconds of arrivals per trial, existing two-second concurrency-10 warmup, fresh app process and complete drain. Pair order control/yield then yield/control. Two short repeats are descriptive, not confidence intervals. Includes 10/s has only 80 responses per trial, making p99 particularly weak; full p99 values remain in JSON.
- Lease/HTTP statistics include drain; CPU/ELU use whole per-second intervals inside arrivals. These are not interchangeable timing partitions. Original observation and aggregate metrics were enabled identically in both variants. No observer-disabled yield comparison was run.
- Process snapshots checked for competing builds/tests before each trial; the host was not isolated from all external activity. The experiment demonstrates a scheduling mechanism, not a guaranteed production gain.
- An initial control attempt targeted the internal driver module, which the public facade does not load. Its missing proof stopped the attempt; it is excluded and retained as `unverified-attempt-{report.md,summary.json}`. The hook was then targeted at the actual public driver chunk and checked before any measured load. All 16 accepted trials have the same original source hash, unchanged loaded hash for control, and a distinct loaded hash for yield. Both public variants also passed the mechanism check.

## Reproduction and evidence

[Machine-readable results](yield-results.json) include per-repeat HTTP, hold, acquisition wait, query timing, CPU/ELU, scheduler lag and source hashes.

Raw artifacts: `/Users/sevinf/projects/prisma678-benchmarks/results/yield-after-release-20260911`.

- `scripts/yield-hook.cjs`: exact process-local transformation.
- `scripts/check-yield.cjs`, `check-wire-*.json`: mechanism/ownership checks against the public driver.
- `scripts/run-verified.mjs`, `verified-plan.json`, `verified-manifest.jsonl`, `verified-execution.log`: accepted run protocol/order.
- `verified-*-proof.json`: loaded public driver identity for every trial. Actual target: `packages/9-public/@prisma/orm-target-postgres/dist/runtime-Di_BFzUC.mjs`; source hash is in every proof.
- `scripts/summarize-verified.mjs`, `verified-summary.json`, `results/concurrency/verified-*`: raw evidence and aggregation.

Use a new scratch directory and update paths/hashes for another run; accepted labels are overwrite-protected. From that new directory, run `node scripts/run-verified.mjs`, then `node scripts/summarize-verified.mjs`. The scratch app's public-package symlink must resolve to the intended patched workspace, and the load target must match the public driver chunk in that build. The HTTP runner rejects missing or incorrect proof before warmup/load. Do not reinstall after setting the link.
