# Direct P7/P8 comparison of loaded request time

## Finding

P8 performs more work **after PostgreSQL has returned the final result**: at concurrency one, this interval averaged **5.09–5.32 ms for P8 versus 1.83–2.07 ms for P7**. Planning before the first pool request was approximately 0.4 versus 0.3 ms. Response serialization did not show a consistent P8 penalty. P8's correlated include SQL also took more server time than P7's two simpler queries combined.

Under concurrency 50, that additional service work appears mainly as more waiting before HTTP dispatch, in pool acquisition, and for completed database results to be processed. These are the same queues in both versions, not a special P8-only 100 ms lock.

**No optimisation changes or prototypes were tested in this comparison.**

## Observer-disabled comparison

Same 100 posts/1,000 comments, pool size 10, 50 prewarmed HTTP connections, Node 26.7.0/native Temporal. P7 is 7.10.0; P8 is the current early-release build, without any experimental hooks except the explicitly enabled diagnostic observer.

| Repeat | P7 median | P8 median | Difference | P7 in-window req/s | P8 in-window req/s |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 423.5 ms | 514.2 ms | **90.7 ms** | 110.50 | 90.00 |
| 2 | 253.5 ms | 340.1 ms | **86.6 ms** | 191.75 | 141.75 |

Absolute performance varied substantially on the shared host. These are short-run observations, not capacity guarantees or confidence intervals.

## Where the additional time appears

Second-repeat diagnostic means, milliseconds **per completed request**:

| Stage | P7 | P8 | P8 minus P7 |
| --- | ---: | ---: | ---: |
| Client issue → HTTP handler | 44.83 | 109.67 | **+64.84** |
| Pool acquisition waits | 171.92 | 195.57 | **+23.65** |
| Query submission → Node query-ready | 56.61 | 81.17 | **+24.55** |
| Remaining ORM execution/continuations | 2.32 | 5.51 | **+3.19** |
| Serialization start → response-end invocation | 1.52 | 1.48 | −0.04 |
| Framework dispatch and response tail | 0.58 | 0.93 | +0.35 |
| **Total** | **277.79** | **394.33** | **+116.54** |

Pool/query values sum **two sequential SQL operations for P7 and one for P8**. They are not a misleading comparison of one P7 query against the whole P8 request. The first repeat showed the same pattern: P8 added approximately 82 ms before handler entry, 27 ms in pool waiting, 31 ms in query waiting and 3.6 ms in remaining ORM execution.

PostgreSQL's own logged processing time in the second loaded repeat was **0.95 ms per P7 request versus 2.56 ms per P8 request**. Summed completion-log-to-Node-ready intervals were approximately **56 ms versus 79 ms**. Most of the query-pending interval therefore was not SQL execution. PostgreSQL's millisecond log precision limits sub-millisecond arithmetic; signed timing differences are retained.

Both event loops were fully utilized in the loaded measurement samples. P8 services this workload more slowly, so incoming requests and ready results spend longer waiting to be handled; connections remain occupied until completion processing permits their release, increasing subsequent pool waits.

The pre-handler interval includes local transport and HTTP dispatch. It is measured on already-open sockets, but is not an exact measurement of kernel packet residence or solely JavaScript CPU time.

## Distinguishing service work from other requests' queues

Concurrency-one diagnostic means isolate a single request's post-query continuation from competition with other HTTP requests:

| Stage | P7 repeat 1 / 2 | P8 repeat 1 / 2 |
| --- | ---: | ---: |
| Before first pool request | 0.274 / 0.298 ms | 0.396 / 0.385 ms |
| Between the two P7 queries | 0.183 / 0.199 ms | n/a — one query |
| **Final query-ready → ORM result emitted** | **1.835 / 2.069 ms** | **5.323 / 5.088 ms** |

The extra P8 elapsed service time is predominantly after the final database result, not query planning or HTTP response serialization. This boundary includes driver/runtime continuation, decoding and model materialization; it is not a CPU profile identifying every contributing function. GC and host scheduling can also contribute to elapsed spans.

## Measurement method and overhead

The previous detailed tracer distorted P7 materially. This replacement uses **no AsyncLocalStorage**, no per-cell instrumentation, no socket-data interception and no modifications to ORM implementation bodies. A Nest interceptor records request-local ORM start/completion directly; HTTP response objects identify admission and serialization milestones. Pool/query durations are aggregated across the complete measurement batch rather than propagating request identity through every promise.

For this single-relation workload, every P7 request issues two dependent sequential queries and every P8 request issues one. Exact operation counts are asserted, warmup is fully drained before measurement, and all measured requests drain before recording ends. Consequently, summed pool/query durations divided by completed requests supply an additive mean partition without async-context correlation. At concurrency one, serial request windows additionally separate initial planning, intermediate work and final materialization.

PostgreSQL emits compact **duration-only** logs rather than repeating SQL text and parameters. The analyzer matches every backend PID's protocol order, asserting three duration records for unnamed extended queries and one for simple queries. Named statements are rejected by the matcher rather than guessed. Startup and warmup records are included in matching, then excluded from measurement totals.

Observer-disabled controls remain necessary. At concurrency 50:

- P7 diagnostic/control median ratios were **0.94 / 1.07**; throughput ratios **1.09 / 0.90**.
- P8 diagnostic/control median ratios were **1.02 / 1.17**; throughput ratios **0.96 / 0.84**.

The old systematic P7-only slowdown is no longer present, but overhead/order/host variation has **not** been eliminated. The diagnostic 117–143 ms mean gap must not be presented as an exact subtraction of the observer-free 87–91 ms median gap. The consistent location of additional work and waits is stronger evidence than any precise cross-run percentage.

## Validation and artifacts

- 16 completed cases, **7,145 measured HTTP requests**, all successful and fully consumed; all measured sockets prewarmed.
- Two process-order passes, concurrency 1 and 50, observer off/on; three-second warmups and four-second measurement windows, followed by complete drain.
- Native Temporal checked before startup, polyfill imports rejected, and all 1,200 P8 timestamp prototypes validated. P7 timestamps remain Date instances.
- Full normalized startup response equality across all cases, hash `45d06207b99b1b854fd8764d2e1ebf7239552303fdfaab525626e4ac8d2c7dc1`.
- **9,333 PostgreSQL queries matched**, including startup/warmup. Measured query counts match two per P7 response and one per P8 response. Pool delivery counts and additive mean accounting pass.
- Six helper tests passed on Node 26, covering protocol matching, additive/serial accounting, pg return preservation and independent load generation.
- One bootstrap syntax failure occurred before any measurements; its log is retained under `setup-failure/`.
- No CPU profiling, scheduling changes, caching interventions, codec changes or production source edits. Shared-host contention and short-duration variability remain limitations.

[Machine-readable comparison](p7-p8-direct-comparison-results.json).

Raw root: `/Users/sevinf/projects/prisma678-benchmarks/results/p7-p8-direct-20260911`. `plan.json`, per-case client/trace JSON and PG logs, source/startup metadata, process snapshots, accounting files, `summary.json` and the executed scripts are retained there. The two scratch databases were recreated from retained fixture/schema dumps, then dropped after the runs. All benchmark app children stopped; original databases and the previously running PostgreSQL server were left unchanged.
