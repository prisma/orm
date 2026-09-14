# Buffered Postgres early-release benchmark

> **Runtime scope:** the HTTP, yield, and I/O-overlap results below used Node 24.19.0; the app's Temporal codecs used a polyfill. They are not Node 26/native-Temporal performance evidence. See the [Node 26/native Temporal replay](native-temporal-replay.md) for the current include-processing investigation and a codec-preserving metadata-cache candidate. That replay does not remeasure HTTP throughput.

## Native-Temporal load attribution

The [direct P7/P8 comparison](p7-p8-direct-comparison.md) measures both versions with a replacement observer that uses no AsyncLocalStorage, including serial and concurrency-50 runs. It separates ORM result processing, serialization, pool waiting and delayed query completion without testing optimisation changes. The [earlier under-load investigation](native-load-attribution.md) is retained separately with its observer limitations.

## Result

The patch substantially shortened low-load connection occupancy and removed nearly all measured post-query hold on both plain lists and includes. **These runs do not establish a throughput improvement:** both builds still accumulated substantial backlog at 500 list requests/s and 80 include requests/s, with overlapping repeat results.

Same-commit comparison on 2026-09-11: unmodified `b8f74562bd9afbdc2d583251112f54ee6824f089` versus that commit plus the buffered-driver/include-scope patch. Baseline was `/tmp/p8-connection-baseline`; patched tree was `/Users/sevinf/projects/worktrees/prisma-next/optimize-connection-pool/prisma-next`. The archived `patch.diff` identifies the source changes at build time (SHA-256 `bf3a70c291274e473c4123718da06958a427df9d39f702872bbeb9373c32cc36`). Subsequent implementation edits were comments/formatting only.

### Checkout → release

Each cell contains repeat A / repeat B **mean milliseconds per lease**. Every measured request produced exactly one lease and one query, so these are also held milliseconds per request.

| Endpoint | Requests/s | Baseline hold | Patched hold | Baseline post-query hold | Patched post-query hold |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/posts` | 100 | 1.978 / 2.183 | 0.474 / 0.578 | 1.485 / 1.601 | 0.005 / 0.005 |
| `/posts` | 300 | 2.421 / 6.635 | 1.123 / 1.058 | 1.467 / 1.674 | 0.004 / 0.005 |
| `/posts` | 500 | 22.155 / 23.022 | 21.809 / 22.666 | 1.608 / 1.667 | 0.004 / 0.005 |
| `/posts-with-comments` | 10 | 14.759 / 15.053 | 3.613 / 2.941 | 11.783 / 11.859 | 0.014 / 0.012 |
| `/posts-with-comments` | 30 | 15.054 / 14.380 | 14.984 / 3.567 | 11.647 / 11.411 | 0.013 / 0.010 |
| `/posts-with-comments` | 80 | 135.044 / 135.206 | 131.706 / 130.555 | 12.918 / 12.507 | 0.009 / 0.010 |

At low load, hold reductions were approximately 74–76% for lists and 76–80% for includes. List hold p95 fell from 2.441/3.426 ms to 0.565/0.631 ms; include hold p95 fell from 17.242/19.260 ms to 6.571/4.561 ms.

The patched 30/s include repeat A is retained: its query interval averaged 14.948 ms versus 3.537 ms in repeat B, and HTTP p95 was 262.42 versus 33.61 ms. Post-query hold remained about 0.01 ms. This variability limits capacity conclusions.

### Acquisition wait, separately from HTTP backlog

Wait cells are mean milliseconds; backlog cells count client requests outstanding when the ten-second arrival window ended. They measure different things.

| Endpoint | Requests/s | Baseline acquisition wait | Patched acquisition wait | Baseline backlog | Patched backlog |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/posts` | 100 | 0.026 / 0.026 | 0.025 / 0.024 | 0 / 0 | 0 / 0 |
| `/posts` | 300 | 0.116 / 0.254 | 0.375 / 0.044 | 0 / 0 | 0 / 1 |
| `/posts` | 500 | 388.822 / 406.140 | 414.791 / 374.393 | 1238 / 1145 | 870 / 1330 |
| `/posts-with-comments` | 10 | 0.043 / 0.048 | 0.049 / 0.045 | 0 / 0 | 0 / 0 |
| `/posts-with-comments` | 30 | 0.178 / 0.110 | 3.536 / 0.663 | 0 / 0 | 0 / 0 |
| `/posts-with-comments` | 80 | 239.367 / 244.600 | 239.650 / 225.256 | 245 / 227 | 217 / 253 |

At 500 list requests/s, baseline drain was 3.149/3.984 seconds versus patched 2.087/4.245 seconds. Throughput including drain was 380.3/357.6 versus 413.7/351.0 requests/s. At 80 include requests/s, baseline drain was 4.478/4.007 seconds versus patched 4.117/4.696 seconds. These overlap and do not support a stable throughput win.

## Method and validation

- 24 trials, **40,800 completed HTTP requests**, no HTTP errors, no omitted arrivals from the safety cap. Leases and successful acquisition records each matched completions exactly; zero invalid releases, pending-at-release, unsupported query interfaces, release errors or acquisition errors.
- Fixed pool size 10; sequential fresh app processes in order **baseline A → patched A → patched B → baseline B**. Each process ran three rates for one endpoint. Ten seconds of open-loop arrivals per rate, followed by drain; each endpoint had a two-second concurrency-10 warmup. Warmup records were excluded.
- `/posts` returns 100 posts; `/posts-with-comments` returns 100 parents with comments. Database counts were verified before and after: 100 posts, 1,000 comments. No measured writes.
- Node v24.19.0 meets both `>=24` engines. Linux aarch64, six logical CPUs, PostgreSQL 15.19. Pool, database, load generator and app shared the host. Other builds/tests were paused during final trials.
- Hold: pool `acquire` event → `release` event. Acquisition wait: `pool.connect()` invocation → callback/promise completion, including connection creation/delivery, not exclusively queueing. Query interval: query invocation → JavaScript-observed completion, not PostgreSQL server time alone. Post-query hold: final observed query completion → release.
- Pool waiting and server HTTP active counts sampled every 200 ms; PostgreSQL activity every 500 ms. Client backlog comes from the independent HTTP load generator, not from pool queue samples. Sample maxima are lower bounds.
- Timed leases were acquired inside each trial and released by its end, including drain. Wait records are selected by completion timestamp. One-to-one counts guard against missing final buffered log records.
- Real-Postgres calibration passed: two-connection pool, deliberate 20 ms query and 30 ms post-query delay, callback and promise APIs, queued acquisition checks. See `calibration-final.json`.
- All trials used query instrumentation; no new observer-disabled control was run. Instrumentation overhead, short duration, order effects and shared-host scheduling remain limitations. Maximum trial scheduler-lag p99 was 58.44 ms. This is not a production capacity estimate or a statistical confidence interval.
- The HTTP runner checks status and consumes full bodies, and validates the startup list length. This is not an exhaustive equality assertion over response contents; implementation tests own semantic correctness.

Full per-trial distributions, HTTP latency, scheduler lag, drain, sampled occupancy and count checks are in [results.json](results.json).

## Latency follow-up

See the [latency investigation results](latency-verdicts.md) for independent PostgreSQL timings, aggregate event-loop/CPU measurements, observer-disabled controls, and a small-response diagnostic. The [pre-experiment protocol](latency-investigation.md) records the hypotheses and limitations; [latency-results.json](latency-results.json) retains individual trials, including adverse results.

The subsequent [single-yield experiment](yield-experiment.md) compares the early-release patch with one event-loop yield before decoding, including verified socket-write ordering and paired latency/backlog measurements.

The [I/O overlap experiment](io-overlap-experiment.md) tests raw `pg`, driver and runtime concurrency with a forced database delay, then traces the real include payload through the ORM result pipeline.

## Implementation validation

Passed:

- `pnpm --filter @internal/driver-postgres test` — 159 tests, including size-one pool reuse during buffered consumption (plain and prepared), exact-once cleanup, caller-owned connections/transactions, and real cursor retention.
- `pnpm --filter @internal/sql-orm-client test` — 801 tests.
- `pnpm --filter @internal/sql-runtime test` — 343 tests, including existing abort/decoding cleanup coverage.
- `pnpm --filter integration-tests test test/sql-orm-client/connection-release.test.ts` — three real size-one pool tests: paused include parent decoder, paused include consumer, and decoder failure cleanup.
- `pnpm --filter @internal/driver-postgres typecheck`, `pnpm --filter @internal/sql-orm-client typecheck`, and `pnpm --filter integration-tests typecheck`.

The driver regression failed before the implementation change: the paused consumer left `pool.idleCount` at zero. The end-to-end tests were also run against the baseline ORM with **only the driver fix applied**: both paused include cases failed with `pool.idleCount === 0`. With both changes applied, they pass. This confirms the ORM scope removal is necessary independently of the driver fix. The temporary baseline source and build were restored after this negative control; no timing trials used that driver-only build.

## Reproduction and artifacts

Raw artifacts and the isolated harness are retained at:

`/Users/sevinf/projects/prisma678-benchmarks/results/connection-compare-20260911T092504Z`

This directory contains `build-baseline.log`, `build-patched.log`, `patch.diff`, `calibration-final.json`, `run-comparison.sh`, `summarize.mjs`, per-pass resolution paths, and `results/concurrency/{baseline-a,patched-a,patched-b,baseline-b}-{posts,includes}*` HTTP/occupancy/lease files. Only those eight labels enter the summary. Earlier `baseline-r1-posts` was an accidental registry-RC.9 diagnostic run after pnpm replaced the link; it and `smoke-baseline` are explicitly excluded.

The prepared app was copied with `cp -a --reflink=auto` into the isolated harness's `results/concurrency/app-prisma8`; the four harness scripts were copied into its `scripts/`. Running from this scratch root satisfied hardcoded runner paths without modifying the original prepared app or prior artifacts.

Both builds used:

```bash
cd /tmp/p8-connection-baseline
pnpm build --filter='@prisma/orm-postgres...'
cd /Users/sevinf/projects/worktrees/prisma-next/optimize-connection-pool/prisma-next
pnpm build --filter='@prisma/orm-postgres...'
```

Proactive LSP checks were attempted first. Package-file LSP checks reported module-resolution/target configuration errors, including ES5-target errors on existing private fields; baseline checks were inconclusive. These were not treated as clean validation. Both actual public builds completed successfully, and the actual package TypeScript scripts passed (see validation below).

Scratch-only compatibility adaptations:

1. Added `"packageManager": "pnpm@10.27.0"` to scratch app metadata. Otherwise its shell pnpm 11 performed an automatic install, restored the registry dependency and failed on ignored build scripts. Workspace builds used pnpm 10.27.0.
2. Added `readonly nullable: false` to the generated `Comment.post` relation declaration in scratch `contract.d.ts`, matching the required non-null `postId` relation. The older released declaration lacks the now-required field. Runtime contract JSON and database were unchanged. `pnpm build` then succeeded.
3. Switched only the scratch `node_modules/@prisma/orm-postgres` symlink between public workspace builds; checked `import.meta.resolve('@prisma/orm-postgres/runtime')` for every pass. Scratch package metadata still names registry RC.9, so do not reinstall between switching and execution. The same compiled app was used for both builds.

Native PostgreSQL was started through Nix, not installed through npm:

```bash
nix shell nixpkgs#postgresql_15 -c pg_ctl -D /tmp/prisma-concurrency-pg \
  -l /tmp/prisma-concurrency-pg.log -o '-p 5433 -k /tmp -h 127.0.0.1' start
```

The exact complete run is `bash "$RAW/run-comparison.sh"`, with `RAW` set to the artifact directory above. It uses the following commands per variant, after linking the intended build:

```bash
cd "$RAW"
export DATABASE_URL=postgresql://postgres@127.0.0.1:5433/app_prisma8
export PG_POOL_MAX=10 VERSIONS=8 HOLD_TIMING=1 SECONDS_PER_TEST=10
node scripts/connection-timing-check.cjs > calibration-final.json
ENDPOINTS=/posts RATES=100,300,500 \
  node scripts/concurrency-probe.mjs open "$variant-posts"
ENDPOINTS=/posts-with-comments RATES=10,30,80 \
  node scripts/concurrency-probe.mjs open "$variant-includes"
node summarize.mjs
```

For a new execution, copy the scratch harness to a new root and update its absolute paths or choose new labels and update the summarizer: output is append-only. Neither the original benchmark app nor its dependency metadata was changed. PostgreSQL was left running at port 5433.
