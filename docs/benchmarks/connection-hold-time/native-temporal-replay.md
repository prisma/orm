# Include result processing on Node 26 with native Temporal

## Outcome

**The actionable codec-preserving optimization is to bind include-column metadata once per query and reuse it for all child rows.** A query-local cache reduced untimed replay medians from approximately **3.4 ms to 1.7–1.8 ms** in three fresh paired comparisons, saving **1.59–1.73 ms (47–50%)**. Codec implementations and per-value decoding were unchanged.

These are **Node v26.7.0, native Temporal** results. The benchmark asserts that `Temporal.Instant` is native, retains the same global Temporal object after client initialization, and rejects imports of Temporal polyfill packages. Node was selected through `nix shell nixpkgs#nodejs_26`; no global version-manager settings were changed.

Earlier investigation runs used Node 24 and a Temporal polyfill. Their roughly 10 ms include-replay cost and large Temporal category must **not** be carried into a Node 26/native-Temporal explanation. The older HTTP/concurrency numbers also remain specific to their recorded runtime; this replay does not remeasure native-Temporal HTTP throughput or P7.

## Replay boundary and validation

A live include read first captures the runtime's already-buffered, top-level-decoded parent rows. The pool is then **closed before replay**. Each replay runs the real ORM include-dispatch path against those captured rows, including plan compilation, parent mapping, child decoding/mapping and result iteration. It skips PostgreSQL, parent-row runtime decoding and HTTP serialization.

- 100 parents and 1,000 comments per replay; aggregate payloads are already-parsed arrays, so the parsing category primarily includes inspection/copying, not `JSON.parse` of a large string.
- 18 fresh processes, ten warmups and 50 measured sequential replays each: **900 measured replays**.
- All outputs were byte-for-byte identical, including across experimental variants: 248,225 bytes, SHA-256 `7e7a83272eb962cfb17252943775655d5a34a2cfcfa99a0d03158ba8499c3f15`.
- Captured input remained unchanged. The ended pool makes accidental database work fail rather than silently enter measurements.
- All processes used the same public ORM source hash. Only process-local load hooks were changed; no production source or on-disk build was edited.
- Three helper tests verify synchronous timing/return preservation, error recording and thenable identity. Every timed codec result in this fixture was synchronous, with zero recorded errors/thenables.

## Phase timings: diagnostic, not an exact decomposition

Each number is the median synchronous time per replay within one instrumented process, in milliseconds. Categories are timed at disjoint call sites; codec lookup includes its internal resolver work. Timers do not surround an `await` and then mislabel time spent elsewhere as codec execution.

| Phase | Calls/replay | Repeat 1 | Repeat 2 | Repeat 3 |
| --- | ---: | ---: | ---: | ---: |
| Plan compilation | 1 | 0.113 | 0.099 | 0.092 |
| Parent field mapping | 100 | 0.071 | 0.068 | 0.063 |
| Payload parsing/copying | 100 | 0.178 | 0.156 | 0.132 |
| Include metadata | 100 | 0.056 | 0.041 | 0.038 |
| Column metadata | 5,000 | 0.477 | 0.441 | 0.425 |
| Codec lookup (`forColumn`) | 5,000 | 1.839 | 1.659 | 1.566 |
| Explicit codec-reference lookup | 5,000 | 0.716 | 0.734 | 0.679 |
| Text codec `decodeJson` | 4,000 | 0.193 | 0.196 | 0.186 |
| Native Temporal codec `decodeJson` | 1,000 | 0.770 | 0.532 | 0.485 |
| Child field mapping | 1,000 | 0.543 | 0.400 | 0.385 |

**Instrumentation overhead is substantial.** Instrumented replay medians were **8.55 / 7.31 / 7.03 ms**, versus untimed controls **3.59 / 3.52 / 3.48 ms**. The noop timing helper cost roughly 152–174 ns/call and the fixture has 21,301 instrumented call sites per replay. Do not interpret the table as an exact partition of the untimed 3.5 ms, add independent medians into a total, or label the residual as promise overhead. Controlled untimed variants below are the stronger optimization evidence.

Native Temporal is no longer the largest measured synchronous category. Repeated codec/column resolution is a substantial, avoidable cost; text conversion and field mapping are comparatively small.

## Per-cell/per-row asynchronous bookkeeping

Two diagnostic variants retain the same codec calls but remove selected `async` wrappers and their matching `await`s. These are **sync-fixture counterfactuals, not production-safe patches**: arbitrary asynchronous JSON codec behavior is not validated by this experiment. Remaining include/generator async behavior is unchanged.

Median untimed replay milliseconds:

| Repeat | Control | Remove cell wrappers | Remove cell and row wrappers |
| --- | ---: | ---: | ---: |
| 1 | 3.594 | 3.509 | 3.146 |
| 2 | 3.518 | 3.278 | 3.041 |
| 3 | 3.479 | 3.062 | 3.055 |

Removing both saved about **0.42–0.48 ms (12–14%)**. This is useful but smaller than the metadata-binding opportunity, and the change also affects V8 optimization/scheduling rather than providing a pure accounting identity for promises. No codec implementation was modified.

## Query-local metadata reuse: stronger candidate

The current include loop in `collection-dispatch.ts` resolves column metadata, calls `contractCodecs.forColumn(...)`, then separately resolves the codec reference again to obtain the error-reporting codec ID, for every non-null cell.

`buildContractCodecRegistry` in `packages/2-sql/5-runtime/src/sql-context.ts` confirms that codec instances are already cached by canonical codec reference. Its `forColumn` delegate still performs column-reference lookup and resolver/cache-key work on every call. **This is repeated binding work, not repeated creation of 5,000 new codec instances.**

The prototype creates a fresh cache per query, keyed by include descriptor and field name. It caches `{ column reference, codec instance, codec ID }`, retaining the existing per-cell async decode call and calling the same codec for every value. It does not cache decoded data or add a global cache. In this fixture, it resolves **five bindings per query instead of 5,000**, verified in every cache replay.

Fresh untimed pairs, with pair order reversed in the middle repeat:

| Pair | Control median | Metadata-cache median | Saved | Reduction |
| --- | ---: | ---: | ---: | ---: |
| 1 | 3.444 ms | 1.774 ms | 1.670 ms | 48.5% |
| 2 | 3.388 ms | 1.801 ms | 1.587 ms | 46.8% |
| 3 | 3.441 ms | 1.706 ms | 1.735 ms | 50.4% |

These variants have no per-phase timers. The cache variant retains a five-increment cache-miss counter as a correctness guard. Full output checksums match the controls and original capture.

## Recommended implementation target

Implement a typed, query-local include-column binding cache in `packages/3-extensions/sql-orm-client/src/collection-dispatch.ts`, keeping codecs and async semantics unchanged. Cover selected/unknown columns, null values, nested/combine includes, polymorphic column aliases, array-valued columns and decode errors with existing full-shape tests before considering it production-ready.

Then compare the implementation against its parent build using **Node 26/native Temporal** for end-to-end latency. The replay improvement is not a claim of 50% lower HTTP latency or doubled throughput, and it does not by itself explain the P7/P8 difference. No production implementation or new HTTP sweep was performed here.

## Limits and reproducibility

- Same commit `b8f74562bd9afbdc2d583251112f54ee6824f089` plus the existing early-release patch; the replay uses its already-built public packages.
- Native controls and variants all use Node 26.7.0. Comparing the earlier Node 24/polyfill replay with these results changes both the JavaScript engine and Temporal implementation, so not every difference can be attributed exclusively to the polyfill.
- Single captured, flat include shape, sequential replay, hot metadata/strings and no network contention. Results need validation on other projections/types and real requests. Three process repeats and medians over 50 replays are descriptive, not confidence intervals.
- Process CPU and wall time were recorded per replay; validation/JSON serialization and result-file writes happen outside the timed span. There are no stack samples, CPU profiles or flamegraphs.
- The first control/timed runs served as calibration and were retained in the initial three-repeat matrix. After that matrix identified repeated resolution, three fresh cache/control pairs tested the candidate. This was a staged investigation, not a preregistered statistical trial.
- Per-process snapshots are retained where recorded; the first calibration pair has none. No recognized build/test process appeared in the fresh cache/control snapshots, but this is not continuous host isolation. Outliers remain in the raw samples.
- Prior Node 24/polyfill replay artifacts remain separately under `/Users/sevinf/projects/prisma678-benchmarks/results/include-replay-20260911`; they are not pooled into the native results.

[Machine-readable native summary](native-temporal-replay-results.json).

Native raw root: `/Users/sevinf/projects/prisma678-benchmarks/results/include-replay-node26-20260911`.

Key files: `scripts/meter*.mjs`, `scripts/replay-hook.cjs`, `scripts/cache-transform.cjs`, `scripts/run-replay.mjs`, `scripts/run-matrix.mjs`, `scripts/run-cache-pairs.mjs`, `scripts/summarize.mjs`, `*-samples.json`, `*-proof.json`, `plan.json`, `cache-plan.json`, and process/log files.

Run in a fresh artifact directory with paths updated; outputs are overwrite-protected. Start through `nix shell nixpkgs#nodejs_26`. Each subprocess uses `process.execPath`, asserts Node major 26 and a native `Temporal.Instant`, and blocks Temporal-polyfill module imports. Run the helper tests, the initial `r1-control`/`r1-timed` calibration pair with `replay-hook.cjs`, then the matrix, cache-pair and summary scripts. The scratch runner scripts retain the exact environment variables and artifact naming.

The actual ORM package typecheck also passed under Node 26. No production TypeScript code was changed during this investigation.
