# Why earlier connection release did not reliably reduce HTTP latency

## Verdict

**The connection-occupancy improvement is real, but it does not remove most request work. In instrumented overload trials, both builds saturate the app event loop while PostgreSQL finishes statements much sooner than JavaScript observes query completion.** These results support an app-side service limit, not a database execution-time or connection-scarcity-only explanation. They do not identify a specific codec, GC, or individual function as the cause.

Twelve additional observer-disabled overload trials confirm that backlog and long HTTP tails persist without injected observation. This strengthens the conclusion that the observer is not necessary for overload symptoms, but does not establish identical CPU/ELU or precisely quantify observer overhead.

The tiny-response intervention provides evidence that the response path contributes materially, but not exclusively: five of six trials improved and all still accumulated backlog. **Observer noise alone does not explain the include tails:** patched observer-disabled include p95 was higher in all three pairs, with one pronounced outlier. A real tail regression and shared-host variation both remain possible.

Protocol: [latency-investigation.md](latency-investigation.md). Complete per-trial p50/p95/p99, hold/wait, backlog, aggregate CPU/ELU/delay, server timing and checks: [latency-results.json](latency-results.json). Raw harness/evidence: `/Users/sevinf/projects/prisma678-benchmarks/results/latency-investigation-20260911-followup`.

## 1. Low load: lower occupancy, similar completed-request work

Numbers below are repeat1 / repeat2 / repeat3. All HTTP/hold values are milliseconds. These trials use the observer, not server logging.

| Endpoint/rate | Build | HTTP p50 | HTTP p95 | Mean hold | App CPU ms/completion |
| --- | --- | --- | --- | --- | --- |
| Lists100 | Baseline | 3.02 / 3.35 / 3.14 | 4.99 / 7.14 / 4.11 | 2.05 / 2.39 / 2.20 | 2.95 / 3.51 / 2.95 |
| Lists100 | Patched | 3.52 / 3.17 / 2.95 | 8.24 / 3.87 / 3.65 | 0.95 / 0.54 / 0.45 | 3.24 / 2.99 / 2.85 |
| Includes10 | Baseline | 18.54 / 19.13 / 19.26 | 22.30 / 28.18 / 21.88 | 14.86 / 15.92 / 14.95 | 20.23 / 19.41 / 19.99 |
| Includes10 | Patched | 20.70 / 18.99 / 18.72 | 25.40 / 21.74 / 21.05 | 3.08 / 2.95 / 3.02 | 21.31 / 19.26 / 19.39 |

There was no end-of-arrivals backlog. Mean acquisition waits were 0.022–0.071ms for lists and 0.044–0.051ms for includes. HTTP bodies were identical in size across builds: 17,155 bytes/list and 248,225 bytes/include. App CPU and ELU were only approximately 0.28–0.35 for lists and 0.18–0.21 for includes. Baseline post-query hold averaged 1.53–1.75ms/list and 11.76–12.73ms/include; patched values were 0.005–0.007ms and 0.009–0.013ms. Work can move outside a lease without leaving the request's critical path. **Prediction1 supported**, within repeat variation; this is not evidence that every internal operation is identical.

## 2. Overload: app saturation, no stable throughput win

The following table describes **instrumented** trials. Lists500 uses the three matched **10-second** comparisons after the documented cap amendment. Includes80 uses three 15-second trials. Values are min–max across repeats, not confidence intervals.

| Endpoint | Build | HTTP p95 ms | Mean hold ms | Mean acquisition wait ms | Backlog | Throughput including drain/s | App CPU cores | ELU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Lists500 | Baseline | 5826–7861 | 22.13–22.68 | 352–391 | 1114–1598 | 303–393 | 1.046–1.081 | 1.000 |
| Lists500 | Patched | 5208–7110 | 21.83–22.16 | 365–400 | 1010–1388 | 331–402 | 1.052–1.085 | 1.000 |
| Includes80 | Baseline | 10790–12218 | 136.72–142.31 | 418–425 | 343–387 | 53.8–56.5 | 1.061–1.077 | 1.000 |
| Includes80 | Patched | 10926–12289 | 134.42–135.81 | 395–438 | 312–380 | 55.6–58.4 | 1.055–1.098 | 1.000 |

Median per-second event-loop-delay p95 was 26.5–33.3ms for lists500 and 168.7–208.8ms for includes80, versus approximately 11ms and 18–20ms at low load (fixed 10ms timer resolution; these are not pure added delay or request percentiles). CPU is total process CPU divided by monotonic wall time; more than 1.0 is possible because process CPU includes threads. ELU is event-loop activity, not CPU, but here both agree on busy app service. Pool queues and HTTP backlog coexist; reducing occupancy alone did not remove the limiting app work. **Prediction2 supported at aggregate level.** The CPU source remains unidentified.

### Independent PostgreSQL duration evidence

Only eight separate diagnostic trials enabled session-only `log_min_duration_statement=0`. Every measured request logged exactly one simple-protocol `statement` duration; all eight server counts matched HTTP completions and leases (15,700 total). Startup used some extended-protocol operations, excluded by trial windows and SQL/PID filtering. A separate calibration verified one simple statement and one extended Parse/Bind/Execute sequence without triple-counting.

| Endpoint/rate | Build | Server mean / p95 ms | Client-query mean / p95 ms |
| --- | --- | --- | --- |
| Lists100 | Baseline | 0.143 / 0.203 | 0.390 / 0.525 |
| Lists100 | Patched | 0.160 / 0.221 | 0.456 / 0.800 |
| Lists500 | Baseline | 0.138 / 0.186 | 20.868 / 28.691 |
| Lists500 | Patched | 0.146 / 0.217 | 22.209 / 33.141 |
| Includes10 | Baseline | 2.367 / 2.575 | 2.734 / 3.396 |
| Includes10 | Patched | 2.400 / 2.588 | 2.933 / 4.349 |
| Includes80 | Baseline | 2.252 / 2.532 | 124.649 / 193.358 |
| Includes80 | Patched | 2.631 / 4.908 | 138.406 / 217.783 |

The server duration does not inflate remotely as much as the client interval at overload. PG activity samples were overwhelmingly idle/ClientRead; no ClientWrite was sampled in any trial. That does **not** rule out short output stalls missed by 500ms sampling, and server statement duration can include writing output. Server/client differences also include pg row parsing/type parsers, network delivery, scheduling and callback processing: they cannot isolate ORM materialization or codec cost.

Logging control: all primary/control/small-response latency trials had logging disabled. Logging diagnostics were not pooled into latency comparisons. Their CPU service and HTTP outcomes mostly overlap nonlogging ranges; patched list500 diagnostic p95 was 8579.8ms, above the nonlogging 5208–7110ms range, and baseline include10 diagnostic p95 was 29.7ms versus 21.9–28.2ms. Thus logging overhead/order effects are not proven negligible. One diagnostic per condition is enough for an order-of-magnitude server/client comparison, not a precise logging-overhead estimate or server performance regression claim.

## 3. Observer-disabled include tails: noise explanation remains incomplete

No app preload, lease probe, aggregate metrics or PG activity sampler was active in these controls. Absence of all observer files was verified for all 12 low-load controls. Same compiled app, Node, pool, data and response route were used.

| Repeat | Baseline HTTP p50 / p95 / p99 ms | Patched HTTP p50 / p95 / p99 ms |
| --- | --- | --- |
| Includes10 r1 | 19.12 / 21.31 / 23.59 | 19.77 / 22.29 / 32.34 |
| Includes10 r2 | 18.95 / 21.52 / 23.70 | 19.47 / 21.97 / 36.77 |
| Includes10 r3 | 19.37 / 23.74 / 33.17 | 19.26 / 32.35 / 140.23 |

Patched p95 remained higher in all disabled pairs: +0.97, +0.45, +8.62ms. Patched p50 was +0.65, +0.52, −0.10ms. The very large r3 tail occurred **without** the observer; conversely, observed r3 patched p95 was only 21.05ms. Observer overhead may affect timings, but cannot be the sole explanation. **Prediction3 is not established as a causal explanation.** The small p50 differences, sparse tails and order/host uncertainty prevent a firm product regression conclusion, but the persistent disabled p95 direction merits investigation rather than dismissal. Each include trial has 150 requests: p99 reflects approximately the two slowest observations and is exploratory. List100 controls also varied by repeat: baseline p95 5.22/3.70/4.20ms versus patched 9.44/3.60/3.46ms.

## 4. Tiny-response diagnostic: response path contributes, not proven dominant

Scratch-only controller method awaits the identical full `.limit(100).include("comments").all()`, then checks all 100 parents and sums all 1000 child-array lengths before returning `{ parents: 100, comments: 1000 }`. Full ORM materialization is retained; no SQL projection, codec, or production change. Startup validates the counts and every diagnostic request repeats the assertion. All six trials had 1200 queries/leases/completions and zero errors. Bytes/request fell from 248,225 to **31**. This changes JSON serialization, HTTP transfer/client body consumption and scheduling, plus adds a small count traversal; it does not isolate stringify alone.

| Build/repeat | Full → small CPU ms/completion | Full → small HTTP p95 ms | Full → small backlog |
| --- | --- | --- | --- |
| Baseline r1 | 18.99 → 15.45 | 11028 → 3112 | 362 → 137 |
| Baseline r2 | 19.46 → 15.24 | 12218 → 2976 | 387 → 134 |
| Baseline r3 | 18.73 → 16.32 | 10790 → 8418 | 343 → 220 |
| Patched r1 | 19.35 → 14.81 | 12289 → 1452 | 380 → 111 |
| Patched r2 | 19.76 → 19.14 | 10926 → 13586 | 364 → 525 |
| Patched r3 | 18.22 → 14.65 | 11306 → 1833 | 312 → 106 |

Five pairs reduced both backlog and p95, with app CPU/completion reductions of roughly 13–23%; the sixth had worse latency/backlog despite a small CPU/completion decrease. Patched r2 small-response averaged only 0.843 CPU cores while ELU remained 1.000. That is consistent with scheduling or non-CPU blocking variation, but no direct measurement identifies its cause. Every small-response trial still had backlog and ELU1.0. **Prediction4 partially supported:** response-path cost is material, not shown to be the sole or dominant bottleneck. Full always preceded small within each build/repeat, so warmup/time drift is an additional confounder.

## 5. Observer-disabled overload: backlog persists

Phase3 added exactly12 sequential trials, lists500 for10s and includes80 for15s × both builds × three alternating-order repeats. No app preload, aggregate/lease metrics, PG sampler or server logging was enabled. All12 verified expected arrivals/completions and body bytes, zero HTTP errors/caps, no observer files and no PG samples; public-package resolutions matched the intended builds. Each list trial completed5000 responses at17,155 bytes each; each include trial completed1200 responses at248,225 bytes each. CPU, ELU, hold, wait and pool occupancy are **unmeasured**, not assumed equal to instrumented values.

| Endpoint/build/repeat | HTTP p50 / p95 / p99 ms | Backlog | Throughput including drain/s |
| --- | --- | --- | --- |
| Lists500 baseline r1 | 675 / 6010 / 6977 | 1136 | 390.4 |
| Lists500 patched r1 | 679 / 5884 / 6806 | 1203 | 385.0 |
| Lists500 baseline r2 | 714 / 6196 / 6992 | 1220 | 381.0 |
| Lists500 patched r2 | 734 / 6544 / 7402 | 1307 | 368.3 |
| Lists500 baseline r3 | 755 / 6507 / 7431 | 1306 | 346.8 |
| Lists500 patched r3 | 654 / 5333 / 6287 | 1112 | 389.3 |
| Includes80 baseline r1 | 1243 / 10501 / 11942 | 333 | 57.9 |
| Includes80 patched r1 | 1228 / 10961 / 12345 | 328 | 58.6 |
| Includes80 baseline r2 | 1267 / 11372 / 11981 | 367 | 56.1 |
| Includes80 patched r2 | 1147 / 10191 / 11656 | 304 | 59.8 |
| Includes80 baseline r3 | 1251 / 10055 / 11648 | 324 | 58.1 |
| Includes80 patched r3 | 1350 / 12737 / 13528 | 436 | 50.7 |

All12 accumulated substantial backlog. Drain-inclusive throughput remained below offered500/s or80/s. Disabled list throughput ranged346.8–390.4/s baseline and368.3–389.3/s patched, overlapping the instrumented303–393/s and331–402/s ranges. Disabled includes ranged56.1–58.1/s baseline and50.7–59.8/s patched, versus instrumented53.8–56.5/s and55.6–58.4/s. Patch effects still change direction between repeats; there is no stable throughput win. Patched includes r3 is slower and retained.

**Phase3 prediction supported:** overload symptoms are not solely caused by injected observation. Combined with the instrumented CPU/ELU/server evidence, this increases confidence in an app-side service constraint. However, HTTP-only controls do not directly prove CPU saturation without the observer, rule out shared-host/network/client limits, or prove instrumentation has negligible overhead. Phase3 ran later rather than interleaving observer states, so time/host drift remains confounded with observer cost. No additional experiments or retries were run.

## Integrity, uncertainty and remaining alternatives

- 66 trials; 146,434 HTTP requests reached the runner's completion/error handler, of which 31 were errors, leaving 146,403 successful responses. Phase3 added37,200 successful responses; the original54 per-trial summary records are unchanged and archived separately. 666 offered arrivals were omitted by the safety cap in two explicitly retained baseline15s list500 trials (171/495). Their labels are `lat-05` and `lat-28`; neither enters the matched10s table. The latter has 6974 leases/queries/waits, equal to successful responses rather than all7005 completion handlers. No HTTP error reason was recorded by the inherited runner; do not infer timeout, reset or application error from aggregate counts. All other trials had zero HTTP errors; instrumented trials had matching request/lease/wait counts, no invalid releases, pending queries at release, unsupported interfaces or acquisition errors. Observer-disabled trials have no lease/wait evidence.
- Fresh app per trial; 2-second concurrency10 warmup; sequential arrivals and complete drain. Pool10 and existing100/1000 data verified before/after. Runtime contract JSON hashes match the original scratch app. No build/install, reseed, profiling, flamegraphs, production edits or commits were performed for this follow-up. Earlier comparison files were not modified.
- Preflight waited for an unrelated Turbo validation workload to finish. Each trial checked for known Turbo/tsc/Vitest activity, with process snapshots; resumed trials also captured after snapshots. This is not continuous host isolation, and external/VM/editor/OS activity may still vary during a trial. No simultaneous benchmark workload was launched by this harness. Record-level scheduling lag is retained in JSON.
- Aggregate calibration: CPU busy interval produced 0.670 process CPU and 0.668 ELU; synchronous child sleep produced 0.006 parent CPU but 0.852 ELU. Max event-loop-delay was approximately508/535ms respectively, confirming ns→ms conversion and why ELU cannot be treated as CPU.
- CPU summaries use whole per-second intervals inside the arrival window, avoiding warmup/drain contamination. CPU/completion is interval CPU divided by app finishes in those intervals, not per-request tracing. Lease/client-query/wait and HTTP distributions include drain. JSON byte totals count consumed response bodies; sampled app byte counts use declared Content-Length. These windows/definitions must not be naively subtracted as if all metrics partition one request.
- Three repeats support descriptive ranges only. There is no stable capacity win and no confidence interval. Possible remaining causes include ordinary app query-building/pg parsing/materialization/response work, network/client backpressure, HTTP connection scheduling, OS/VM scheduling, logging overhead in diagnostics, observer overhead in observed runs, JIT/warmup/order effects and a real patch-induced scheduling/tail regression. No evidence here identifies GC or codec-specific causes.

For exact execution order, labels, timings, process evidence, PG log byte ranges and per-trial resolution checks, use `manifest.jsonl`, `manifest-phase3.jsonl`, `plan-phase1.json`, `plan.json`, `plan-phase3.json`, `execution*.log` and the scratch README. Official metric interpretation sources are linked in the protocol; pg8.22 parsing/readiness semantics were independently inspected during this investigation.
