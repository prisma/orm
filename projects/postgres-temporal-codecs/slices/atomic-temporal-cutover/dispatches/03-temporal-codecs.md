# Brief: D3 — Four Temporal codecs and the capability error

## Task

Add the four Temporal-backed codecs — `pg/date-temporal@1`, `pg/timestamp-temporal@1`, `pg/timestamptz-temporal@1`, `pg/time-temporal@1` — carrying `Temporal.PlainDate`, `Temporal.PlainDateTime`, `Temporal.Instant`, and `Temporal.PlainTime` as their application values. Reads parse PostgreSQL's server text through the corresponding `Temporal.*.from()`; writes serialise through the value's `toString()`. `Temporal.*.from()` is the authoritative parser **and** the authoritative range validator — this dispatch does not hand-roll an ISO grammar, a regex, or a range check. Alongside them, add the target-owned capability error: `RUNTIME.TEMPORAL_UNAVAILABLE` on `PostgresTargetErrorCode`, an internal `errorTemporalUnavailable(codecId, operation)` factory in `core/errors.ts`, and a `requireTemporal()` helper in `core/codec-helpers.ts` that performs the check lazily, at codec invocation.

## Task zero — settle the parse assumption before building on it

**Do this first, in isolation, and report the result before the rest of the dispatch.**

D1 established that PGlite renders `timestamptz` as `2026-01-02 03:04:05.123456+00` — space separator, two-digit offset, microseconds intact. The entire `timestamptz` read path assumes `Temporal.Instant.from()` accepts that spelling. **That assumption is unproven.** Prove it with a test, for all four types against the real spellings PostgreSQL emits, before you write a single codec.

If any of the four spellings does not parse, **halt and surface** with the exact input and the exact error. Do not reach for a regex, a pre-normalisation step, or a string rewrite to make it fit — that decision is mine to route, because it changes what the slice spec claims about Temporal being the authoritative parser.

Two things you already know that bear on this: the D1 review established that `time` (1083) and `time[]` (1183) were **already** string-producing in `pg-types`, so the transport-layer tests do not discriminate a `time` regression. Discrimination for `time` has to happen here, at the codec layer. And your own `DateStyle` finding — `German, DMY` yields `02.01.2026 03:04:05.123456 UTC` — is a spelling no `Temporal.*.from()` will accept, which is the read-side error path this dispatch owes.

## Scope

**In:**

- `packages/3-targets/3-targets/postgres/package.json` — `temporal-polyfill` as a **devDependency**. Operator decision, settled: it supplies ambient global types only and is **never imported at runtime**. Add it via `pnpm add -D`; never hand-edit the lockfile.
- `packages/3-targets/3-targets/postgres/src/core/errors.ts` — `RUNTIME.TEMPORAL_UNAVAILABLE` on the code union, plus `errorTemporalUnavailable(codecId, operation)`.
- `packages/3-targets/3-targets/postgres/src/core/codec-helpers.ts` — `requireTemporal()`, plus whatever narrow read-side adaptation the BC / expanded-year cases need.
- `packages/3-targets/3-targets/postgres/src/core/codec-ids.ts`, `codecs.ts`, `codec-type-map.ts` — the four IDs, codec classes, descriptors, column helpers, registrations.
- `packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts` — `controlPlaneHooks`, `storage`, `typeImports` as the shape requires.
- `packages/3-targets/6-adapters/postgres-codec-testkit/` — conformance and aggregate fixtures for the four new IDs, mirroring what you did for the string codecs in D2. This is in scope from the outset this time; do not halt on it.
- Tests, including a Temporal-absent test that proves the error path.

**Out — do not touch:**

- The four old Date-typed codecs. Still broken, still untouched, still D6's to delete.
- The four `*String` codecs from D2. Done and reviewed.
- `jsonProjection` bodies — **all eight are D4's**, changed together. Give the new descriptors the same identity projection the `*String` ones carry.
- Authoring helpers, PSL spellings, introspection — D5.
- `timetz`, `interval`.

## Behaviour this dispatch owes

- **Reads** parse via `Temporal.*.from()`. The only read-side handling beyond that is PostgreSQL-specific `infinity` / `-infinity` detection and the narrow BC / expanded-year adaptation Temporal's grammar requires (PostgreSQL writes `0044-03-15 BC`; Temporal expects a proleptic `-000043-03-15`, note the off-by-one year). That adaptation is narrow and named — it is not a general grammar.
- **Writes** serialise via `toString()` at full available precision. PostgreSQL rounds to the column's declared precision, including carries into the next second. Do not truncate, do not reject sub-microsecond input, and do not reverse-convert Temporal's year numbering — PostgreSQL is authoritative and may reject values, which surfaces as a database error.
- **Calendars:** only `iso8601` is accepted on write. A non-ISO authored calendar is rejected, never silently discarded. Database reads construct ISO-calendar values.
- **Rejection:** `infinity`, `-infinity`, finite values outside Temporal's range, and any PostgreSQL text Temporal cannot represent produce an error that names the codec and the value boundary, and recommends the corresponding `*String` type as the lossless alternative. That recommendation is the whole reason the D2 codecs exist — make the message actually name the type.
- **Missing Temporal** produces `RUNTIME.TEMPORAL_UNAVAILABLE` **lazily** — only when a Temporal codec is invoked. Never while assembling descriptors, validating a contract, or creating a runtime. Constructing a client must not require Temporal.

## Completed when

- [ ] Task zero is answered and reported, with the exact spellings tested.
- [ ] All four codecs exist, are registered, carry `Temporal.*` in `TInput`, and have testkit fixtures.
- [ ] `pnpm --filter @internal/target-postgres typecheck` passes with `Temporal` resolving as an ambient global, and **no runtime import of `temporal-polyfill` exists in `src/**`**. Prove the second with a grep in your report.
- [ ] A test proves `RUNTIME.TEMPORAL_UNAVAILABLE` reaches the caller **with its code intact** through the generic decode path — not re-wrapped as `RUNTIME.DECODE_FAILED`. The passthrough already exists (`packages/2-sql/5-runtime/src/codecs/decoding.ts:243` passes anything satisfying `isStructuredError`), so this test pins behaviour you inherit rather than behaviour you build. It must fail if the error stops being structured.
- [ ] A test proves a client constructs and a contract validates with **no global `Temporal`**, and that the failure arrives only on codec invocation.
- [ ] Round-trip coverage spans: ordinary values, a nanosecond write that PostgreSQL rounds (including a carry into the next second), `timestamptz` offsets, ISO-calendar enforcement on write, BC and expanded-year reads, `infinity` / `-infinity`, out-of-Temporal-range values, and a non-ISO `DateStyle` rendering.
- [ ] `time` discrimination happens at the codec layer — a test that fails if `pg/time-temporal@1` stopped parsing, given the transport tests cannot catch it.
- [ ] Gate set green apart from known-red: `@internal/target-postgres`, `@internal/adapter-postgres`, `@internal/postgres-codec-testkit` — `typecheck` / `test` / `lint` each.
- [ ] Known-red set has not grown beyond the D2 close state. **Serial runs only**; state in your report that they were serial, and give the durations.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note. Anything that pulls you off the goal halts and surfaces.

## Halt conditions

- Task zero fails for any of the four types.
- You find yourself writing a regex, an ISO grammar, or a normalisation pass beyond the named BC / expanded-year adaptation.
- Making `Temporal` types resolve requires a runtime import, a bundled polyfill, or a change outside `@internal/target-postgres`'s own config.
- The lazy-check requirement cannot be met — i.e. something forces a Temporal reference during descriptor assembly, contract validation, or runtime construction.
- Adding the error code requires touching `packages/1-framework/**` or the generic SQL runtime. The passthrough is supposed to make that unnecessary; if it does not, the spec's central claim is wrong and I need to know.
- Diff exceeds ~20 files.

## References

- Slice spec § Chosen design › Temporal capability check; § Pre-investigated edge cases — the table is your test matrix, not background reading.
- `projects/postgres-temporal-codecs/learnings.md` — read all of it. "`renderOutputType` only fires when type params are non-empty" is why `TInput` carries the app type; "Nothing validates the renderer/typeImports join" is why a typo in a rendered type name will not be caught by anything except `contract-imports.test.ts`.
- D2's four `*String` codecs in `codecs.ts` — your structural model for descriptor shape and registration.
- Failure modes: [F1](../../../../drive/calibration/failure-modes.md#f1-dual-shape-support-relocated-under-a-new-name) (no `Date` reconstruction, no "either a Date or a string"), [F13](../../../../drive/calibration/failure-modes.md#f13-regression-test-for-a-boundary--scoping-property-doesnt-discriminate) (every rejection test must fail if the rejection is removed), [F28](../../../../drive/calibration/failure-modes.md#f28-test-file-written-for-a-runner-no-suite-invokes--coverage-that-never-runs) (the polyfill global must be installed by the suite that actually runs your tests).

## Operational metadata

- **Model tier:** orchestrator — this is the slice's judgment concentration.
- **Time-box:** none fixed; this is the largest dispatch in the slice. Report progress by heartbeat, and surface if task zero alone consumes more than ~30 minutes.
- **Validation gate:** the three packages above, `typecheck` / `test` / `lint`; **plus `pnpm lint:casts`**; plus serial workspace suites for red-set accounting.

> **`pnpm lint:casts` is non-negotiable and the per-package `lint` gate cannot substitute for it.** The `no-bare-cast` plugin's severity is `info`, so `biome check --error-on-warnings` passes while the ratchet at `scripts/lint-casts.mjs` (CI job `ci.yml:118`) fails on any increase. D2 turned the branch CI-red this exact way, by copying the `params as Record<string, unknown>` pattern the existing temporal descriptors use. You are adding four more descriptors of that shape — write them without the cast from the start. Prefer eliminating the need for it (type `renderPrecision`'s parameter properly) over laundering it through `blindCast`.
