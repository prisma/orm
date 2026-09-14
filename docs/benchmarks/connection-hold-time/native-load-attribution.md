# Where native-Temporal requests wait under load

## Answer

**P8 reaches the application-processing limit earlier, and time accumulates in several queues—not in a single 100 ms database operation or mutex.** Incoming HTTP requests wait before their handler runs; admitted requests wait for pool leases; queries that PostgreSQL has already finished wait for Node to process their results. Other requests' include processing, JSON serialization and protocol handling occupy most of the observed result-delivery gap.

A controlled, codec-preserving metadata-binding prototype also reduced actual under-load latency, not just replay time. In the two main observer-disabled, fixed-concurrency comparisons, P8 medians fell **423 → 337 ms** and **359 → 262 ms**. The local saving of roughly two milliseconds can therefore remove roughly 90 milliseconds of queued-request latency at concurrency 50.

These are short, shared-host results, not production capacity estimates. Detailed tracing perturbed P7 substantially, and external builds caused variation. Performance comparisons below use **observers off**; traced intervals locate where time goes rather than providing an unbiased P7/P8 CPU comparison.

## Runtime, workload and integrity

- **Node 26.7.0, native Temporal**, with polyfill imports rejected. P8 startup checks all 1,200 timestamp values against the exact native `Temporal.Instant.prototype`; P7 values are `Date` instances.
- Real HTTP requests and real PostgreSQL queries throughout. **No captured-row replay** in this study, no CPU profiles, no larger pools, and no codec implementation changes.
- Pool size **10**. One read returns **100 posts and 1,000 comments**.
- P7 is the prepared **7.10.0** application. P8 variants are prepared released **8.0.0-rc.9**, the current worktree's early-release build, and that **same current build plus a process-local metadata-binding prototype**. Released/current P8 differ in source version, so their comparison does not isolate the early-release patch's effect.
- Separate owned databases on the existing PostgreSQL 15 server at port 5433. P8 data was copied into the P7 schema, with timestamps normalized to common millisecond precision in the scratch databases. Both retain their respective schemas/indexes and normal SQL strategies: P7 uses two include queries; P8 uses correlated JSON aggregation.
- Startup responses match completely after sorting unordered parent/comment arrays, sorting object keys and normalizing timestamp representations. One canonical hash across all 54 app processes: `45d06207b99b1b854fd8764d2e1ebf7239552303fdfaab525626e4ac8d2c7dc1`.
- **54 cases, 32,433 measured HTTP requests**, all HTTP 200, all response bodies consumed. Content equality is checked at startup; timed requests check status and payload size, not every field.
- The current P8 and cached variant use the same underlying public ORM artifact hash: `34ae5be35f3fe40c9c579fd63b99481b0e8a64eb1c2be7c99a32c7d02ba508ca`. Loader transformations and their hashes are recorded separately. No production source or on-disk build was edited.

## 1. Reproducing the overload boundary

Initial open-loop runs offered **100 and 170 requests/s** for four seconds, after warmup, then drained every request. Every scheduled request was issued; no safety cap discarded requests. Versions and observer ordering were reversed in a second pass.

At **170 requests/s**, the initial observer-disabled P7 runs completed all **680 requests inside the four-second window**, with median latency **5.53 / 7.91 ms**. Released P8 completed **546 / 485**, leaving **134 / 195 outstanding** at the boundary, with medians **317 / 340 ms**. The current early-release P8 build also accumulated backlog. This is a native-Temporal overload difference, not a transfer of the older polyfill result.

The largest individual delays were often *before Prisma started*. For example, sparse-trace request `m-s-r2-p8-release-170-trace-480`:

| Milestone | Since client issued request |
| --- | ---: |
| Client TCP connection established | 0.615 ms |
| Client request flushed | 0.637 ms |
| Server HTTP request handler entered | **2,411.182 ms** |
| Pool requested / delivered | 2,411.340 / 2,411.364 ms |
| SQL submitted / Node query-ready | 2,411.590 / 2,422.210 ms |
| Include processing finished | 2,426.391 ms |
| Response end invoked | 2,428.177 ms |
| Client received full response | 2,428.691 ms |

This outlier spent **2.41 seconds before the HTTP handler**, not waiting on a Prisma SQL call. Open-loop overload creates growing inbound/outstanding queues, so these multi-second tails should not be confused with the fixed-concurrency ~100 ms gap.

## 2. Fixed, prewarmed connections: where the time goes

To remove newly opened HTTP connections as an explanation, the next stage used **50 concurrent request loops**, three seconds of warmup and four seconds of measurement. All measured HTTP requests were asserted to reuse existing sockets. Pool size remained 10.

The following is an **additive elapsed-time partition**, averaged over 38 systematically sampled P8 requests in `c50-r2-p8-patched-trace`. It is not a sum of independent percentiles and not per-request CPU accounting.

| Interval | Mean ms |
| --- | ---: |
| Client issue → HTTP handler entry | **98.07** |
| Waiting for pool delivery | **167.06** |
| SQL submission → Node query-ready | **70.14** |
| This request's include-processing continuation | 3.89 |
| Other application time before serialization | 0.87 |
| JSON serialization start → response-end invocation | 1.40 |
| Response-end invocation → client completion | 0.47 |
| **Total** | **341.89** |

All HTTP requests in that case, not just the sampled ones, averaged **96.57 ms before handler entry**. They used prewarmed sockets: connection establishment cannot explain this fixed-concurrency pre-handler interval.

The boundary does **not** expose the exact kernel packet-arrival timestamp. A proposed socket `data` marker was unavailable on Node's native HTTP parser path, which bypasses that ordinary event path; missing read timestamps are retained as missing. Thus the interval remains **client-to-HTTP-dispatch time**, not a claim that every millisecond is solely a JavaScript scheduling delay.

### The query is usually already finished on PostgreSQL

For the same sampled requests:

- PostgreSQL logged approximately **2.41 ms per query**, including recorded parse/bind where present.
- Its completion-log timestamp preceded Node query-ready by **68.15 ms on average**.
- The final `pg` data callback's start → query-ready segment was only **0.12 ms**. This is the final callback segment, not all protocol-parsing CPU.
- During that completion-to-ready interval, other requests' recorded include continuations overlapped **37.42 ms**, JSON serialization **14.63 ms**, and `pg` data callbacks **4.83 ms**.
- The **union**, avoiding double counting, covered **56.88 of the 68.15 ms**—about **83%**. The remaining interval is not assigned to a specific function. Continuation-span overlap is not an exact CPU profile.

The app's event-loop utilization was **100%** in the contained measurement samples; aggregate process CPU was approximately **1.13 core-equivalents**, including helper/GC threads. This supports an application service-capacity limit, not a database spending 70 ms executing each query.

This also explains why pool waits inflate: the driver cannot consider a pending query complete and release its connection until the relevant JavaScript callback/continuation runs. Releasing *before include decoding* removes one lease extension, but does not make callbacks for other already-completed queries execute sooner while the application is busy.

P7 has the same kinds of queues when saturated. It is not exempt from queueing; the observer-disabled comparisons show it serves this workload faster and reaches the overload boundary later. Its detailed trace was too intrusive to use for an exact cross-version phase subtraction.

## 3. A causal check: does a small local saving actually change loaded latency?

The query-local binding prototype resolves include-column metadata, codec instance and codec ID once per field per query, rather than for every value. It retains the original async decode calls and the same codec implementations. It neither caches returned values nor skips SQL.

Every cached-process audit verified **five bindings per include query**, with query counts exactly matching startup + warmup + measured include calls. Native timestamp and full normalized startup-response checks continued to pass.

Main fixed-concurrency comparisons, **all observers off**:

| Repeat | P7 median | Current P8 median | P8 + metadata binding | P8 reduction |
| --- | ---: | ---: | ---: | ---: |
| 1 | 246.7 ms | 423.1 ms | **337.2 ms** | **85.9 ms** |
| 2 | 238.8 ms | 359.0 ms | **262.1 ms** | **96.9 ms** |

Successful completions per second inside the measurement window:

| Repeat | P7 | Current P8 | P8 + metadata binding |
| --- | ---: | ---: | ---: |
| 1 | 195.25 | 114.25 | **140.50** |
| 2 | 207.50 | 125.75 | **164.50** |

The prototype does not completely close the P7 gap. Short-run variation is substantial; the tables are observed pairs, not confidence intervals or a universal speedup claim.

Within the second sparse P8 trace pair, the include continuation shortened **3.89 → 1.76 ms**, while pool waiting shortened **167 → 133 ms**, pre-handler time **98 → 79 ms**, and query pending time **70 → 58 ms**. SQL execution and serialization stayed approximately unchanged. Most of the elapsed-time saving appeared in queues, not in the request's own decoding interval.

That is why a roughly two-millisecond local saving can matter to a roughly 100-millisecond loaded gap. At concurrency 50, requests repeatedly wait for other requests' work; **50 × 1.7 ms ≈ 85 ms** is a useful steady-state intuition, not an exact general latency formula. The HTTP experiment, rather than that arithmetic alone, supplies the evidence here.

## Observer and shared-host limitations

The study deliberately retained adverse controls rather than hiding them:

1. **24 initial cases:** full request correlation, pool/query milestones, sparse coarse ORM milestones, independent PG logs and observer-disabled comparisons. Full tracing materially worsened P8, particularly near the overload boundary.
2. **12 open-loop follow-ups:** one-in-16 request correlation, retaining full HTTP/SQL timestamps and uniquely identified include spans. P8 throughput was generally closer to adjacent controls, but P7 and host variation remained visible.
3. **12 fixed-concurrency cases:** prewarmed sockets, current P8 versus P7, and the metadata-binding intervention. Sparse P7 tracing still reduced observed throughput by roughly 30%; it is not an unbiased P7 performance measurement.
4. **Six HTTP-only checks:** no AsyncLocalStorage propagation, ORM/pg instrumentation or PG duration logging. These still observed substantial pre-handler time on prewarmed sockets: mean **40 ms for P7**, **124 ms for current P8**, and **99 ms for cached P8** in that later cohort. This confirms that pre-handler delay does not require the detailed tracer. These are a separate, variable cohort—not values to splice into the detailed partition. Its observer-disabled P8/cache medians were **551 / 356 ms**; all these later results remain in the machine summary.

All app/database/generator processes shared a six-CPU host. Other worktrees ran builds/tests during parts of the study; process snapshots are retained. There are no confidence intervals, CPU isolation or claims of precise production capacity. Aggregate process CPU includes multiple threads; event-loop utilization does not identify a specific function. PG log timestamps have millisecond resolution and are logging-time proxies for completion; negative sub-millisecond differences remain visible rather than being silently clamped.

The timestamped phase accounting and actual under-load intervention support the **queueing mechanism and optimization direction**, not an exhaustive attribution of every CPU cycle or every millisecond of network delay.

## Validation, artifacts and cleanup

- **21 harness/analysis tests passed** on Node 26: open-loop independence/draining, pg result/ownership preservation, strict SQL-log matching, additive partitions, interval-union accounting, sparse selection and transport-boundary handling.
- All **27 trace cases** parsed and matched their submitted queries to PostgreSQL duration records. Every selected request had a valid nonoverlapping additive partition; no missing markers or accounting errors were silently omitted.
- Raw recordings retain every request, warmup/setup SQL, individual events, per-second bins, observer-disabled outcomes and source proofs. Summary percentiles use nearest rank; runner progress logs used an upper-middle median, so a few displayed medians differ slightly.
- All app children stopped. The two owned `native_attr_v7_20260911` / `native_attr_v8_20260911` databases were dropped after checking for remaining connections. Original databases and the already-running PostgreSQL server at 5433 were left alone.
- No production metadata cache was installed. General nested/combine/polymorphic/array/error behavior still needs regression coverage before adopting the prototype.

[Machine-readable results](native-load-attribution-results.json).

Raw root: `/Users/sevinf/projects/prisma678-benchmarks/results/native-load-attribution-20260911`.

Plans: `plan.json`, `sparse-plan.json`, `fixed-plan.json`, `http-plan.json`. Code: `scripts/bootstrap.mjs`, `pg-trace.cjs`, `observer*.cjs`, `load.mjs`, `run*.mjs`, `cache-hook.cjs`, and `scripts/analysis/`. Per-case files include client/trace JSON, PostgreSQL logs, startup metadata, process snapshots and cache proofs/audits. `attribution-summary.json` and per-request analysis retain the detailed partitions; `compact-summary.json` is copied into this repository.

Reproduction requires fresh output labels/directories and recreating the two scratch databases from the retained schema/data dumps. Run through `nix shell nixpkgs#nodejs_26`; child processes use `process.execPath` and enforce native Temporal. The metadata prototype reuses the preserved `include-replay-node26-20260911/scripts/cache-transform.cjs`, but **not** that experiment's replay substitution hook.
