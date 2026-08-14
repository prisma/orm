# Brief: D1 — Driver hands temporal OIDs through as text

## Task

Make every row-producing path in `@internal/driver-postgres` return PostgreSQL's own text for the temporal OIDs instead of letting `pg` construct JavaScript `Date` objects. This covers `date` (1082), `time` (1083), `timestamp` (1114), and `timestamptz` (1184), plus their array OIDs (1182, 1183, 1115, 1185), on both the buffered path (`executeBuffered`) and the cursor path (`executeWithCursor`, named and unnamed). Use `pg`'s **per-query** type-parser mechanism — the `types` field on the query config object. Do not call `pg.types.setTypeParser`, do not mutate any global registry, and do not alter the configuration a user supplied to their own `Pool` or `Client`. For scalar OIDs the parser returns the server's text unchanged. For array OIDs the result must still be a JavaScript array whose *elements* are untouched server text.

## Scope

**In:**

- `packages/3-targets/7-drivers/postgres/src/postgres-driver.ts` — the `QueryConfig` built in `executeBuffered`, and the `Cursor` / `NamedCursor` construction in `executeWithCursor`.
- `packages/3-targets/7-drivers/postgres/src/named-cursor.ts` — `NamedCursorOptions.config` already exists and `_conf.types` is already forwarded onto `_result._getTypeParser`. Thread the config through; do not invent a second mechanism.
- New driver-level tests asserting the wire form directly.
- Resolving the array-OID strategy (see § Judgment call below).

**Out — do not touch, even though adjacent and tempting:**

- Any codec. `packages/3-targets/3-targets/postgres/src/core/codecs.ts` is D2/D3's surface. The existing `PgTimestampCodec` etc. are typed `Date → Date` and will now receive strings. **Leave them broken.**
- Any test outside the driver package. Codec and integration tests going red is the expected outcome of this dispatch, not a thing to fix.
- `timetz` (1266) and `interval` (1186) OIDs — unchanged behaviour, explicitly out of project scope.
- `runExecute` (returns only `affectedRows`) and `explain` (`EXPLAIN (FORMAT JSON)`, no temporal columns).

## Judgment call in scope

Array OIDs need a decision. Overriding an array OID with a plain identity parser yields the raw PostgreSQL array literal string rather than a JS array, which breaks the `many`-flagged decode path in `packages/2-sql/5-runtime/src/codecs/decoding.ts` that expects the driver to have already parsed the array.

**Working position:** delegate temporal array OIDs to `pg`'s own `text[]` parser (OID 1009), which parses the array structure while leaving elements as text. Confirm `pg-types`' `getTypeParser` is reachable by OID lookup for this. If it is not, fall back to `postgres-array` with an identity element parser. Document which you chose and why in your report.

## Completed when

- [ ] Driver tests prove, for **both** the buffered and the cursor path (named and unnamed cursors), that a selected `date` / `time` / `timestamp` / `timestamptz` column arrives as a `string` whose value is PostgreSQL's own rendering — not a `Date`, and not a re-formatted string.
- [ ] A driver test proves an array of each of the four types arrives as a JS array of strings with element text intact.
- [ ] A driver test proves the override is per-query: a `Pool`/`Client` the driver did not create, or a query issued outside the driver, still uses `pg`'s default parsers. Global state is untouched.
- [ ] `pnpm --filter @internal/driver-postgres typecheck`, `test`, and `lint` all pass.
- [ ] You have produced the **known-red list**: the enumerated set of test files elsewhere in the workspace that now fail because of this transport change. Obtain it with a targeted run, name the files in your report, and do not fix any of them.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal — even if it looks useful — halts and surfaces.

## Halt conditions

- **F1 — dual-shape support under a new name.** If you find yourself writing anything that turns text back into a `Date`, or that accepts "either a Date or a string", stop and surface. That is the exact failure mode this project exists to eliminate, and it is a `must-fix` finding at review.
- `pg` turns out not to support per-query parser overrides on one of the two paths without mutating shared state. Surface with evidence; do not reach for a global `setTypeParser` as a workaround.
- Completing the dispatch requires touching a codec or a non-driver test.
- Diff exceeds ~10 files.

## References

- Slice spec: `projects/postgres-temporal-codecs/slices/atomic-temporal-cutover/spec.md` — § Chosen design › "Driver: text in, text out".
- Slice plan: `projects/postgres-temporal-codecs/slices/atomic-temporal-cutover/plan.md` § D1 and § The known-red window.
- Project spec: `projects/postgres-temporal-codecs/spec.md` — the driver is described there as "the lossless transport boundary".
- Failure modes that apply: [F1](../../../../drive/calibration/failure-modes.md#f1-dual-shape-support-relocated-under-a-new-name) (dual-shape under a new name), [F14](../../../../drive/calibration/failure-modes.md#f14-dispatch-reports-validation-green-but-ci-is-red-dispatch-gates-didnt-mirror-ci) (biome lint is a separate CI job; typecheck must cover the `test` project).
- [`node-postgres` type parsing](https://node-postgres.com/features/types).

## Operational metadata

- **Model tier:** orchestrator (Opus) — substrate change at a transport boundary, with one genuine design judgment (array OIDs) inside it.
- **Time-box:** 90 minutes. Overrun → halt and surface; do not extend.
- **Validation gate:** `pnpm --filter @internal/driver-postgres typecheck && pnpm --filter @internal/driver-postgres test && pnpm --filter @internal/driver-postgres lint`. Per F14, `lint` is a separate CI job and is non-negotiable; if the package's `typecheck` script does not cover `test/**`, compile the test tsconfig too.
