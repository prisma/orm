# Slice plan: atomic-temporal-cutover

**Slice spec:** [`spec.md`](./spec.md) · **Parent project:** [`projects/postgres-temporal-codecs/`](../../)

## At a glance

Eight dispatches, strictly sequential. The driver cutover lands first so every subsequent codec dispatch can be tested against real server text; the cost is a known-red window that must shrink monotonically and reach empty at D7.

## The known-red window

D1 changes what `pg` hands the codec layer. From that moment the four old Date-typed PostgreSQL temporal codecs receive strings they aren't typed for, and every test exercising them fails. This is the intended consequence of an atomic cutover, not a regression — but it removes "package tests green" as a usable gate for six dispatches, so it needs an explicit contract:

- **D1 produces the known-red list** — the enumerated set of test files failing because of the transport change, captured in the dispatch report.
- **Every later dispatch reports the current red set** and it must be a subset of the previous dispatch's. A dispatch that adds a new red file halts for orchestrator review.
- **D7 closes the window.** The red set is empty; the full gate set runs clean.
- **Re-adding Date construction anywhere to quiet a red is [F1](../../../../drive/calibration/failure-modes.md#f1-dual-shape-support-relocated-under-a-new-name)** — the same failure mode under a new name. Every brief from D1 onward pre-names it.

## Applicable failure modes

Threaded into the briefs that need them:

- **[F1](../../../../drive/calibration/failure-modes.md#f1-dual-shape-support-relocated-under-a-new-name)** — dual-shape support relocated under a new name. All dispatches. A helper that turns text back into a `Date`, or accepts "either a Date or a string", is this failure mode.
- **[F3](../../../../drive/calibration/failure-modes.md#f3-discovery-via-test-suite-instead-of-grep)** — discovery via test suite instead of grep. D5, D6, D7: the consumer sets are `rg`-findable, and the suites here are slow.
- **[F13](../../../../drive/calibration/failure-modes.md#f13-regression-test-for-a-boundary--scoping-property-doesnt-discriminate)** — non-discriminating regression test. D3, D4: a nested/flat agreement test whose fixture has no sub-millisecond component would pass with the old `to_char` projection intact.
- **[F14](../../../../drive/calibration/failure-modes.md#f14-dispatch-reports-validation-green-but-ci-is-red-dispatch-gates-didnt-mirror-ci)** — gates didn't mirror CI. All dispatches: `pnpm --filter <pkg> lint` is non-negotiable, typecheck must cover the `test` project, sync `origin/main` before the final push.
- **[F24](../../../../drive/calibration/failure-modes.md#f24-stale-dist-makes-a-red-gate-look-like-a-broken-base)** — stale `dist`. D5, D6: exported types change in `3-targets/postgres` and `relational-core`; downstream typecheck needs the producing package rebuilt first.
- **[F26](../../../../drive/calibration/failure-modes.md#f26-review-comment-point-fixed-the-defect-class-re-ships-in-new-places-next-round)** — defect class re-ships. Eight near-identical codecs: a review comment on one is a comment on all eight.
- **[F28](../../../../drive/calibration/failure-modes.md#f28-test-file-written-for-a-runner-no-suite-invokes--coverage-that-never-runs)** — test written for a runner no suite invokes. D3's Temporal tests need the polyfill global installed by the suite that actually runs them.

## Applicable grep gates

From [`grep-library.md`](../../../../drive/calibration/grep-library.md), plus slice-specific gates:

```bash
# Slice-specific — retired IDs (D6 gate, re-run at D7):
rg 'sql/timestamp@1|SQL_TIMESTAMP_CODEC_ID' packages/
rg "'pg/date@1'|'pg/timestamp@1'|'pg/timestamptz@1'|'pg/time@1'" packages/
rg '\bfield\.timestamp\(' packages/ examples/

# Slice-specific — no Date on a public temporal surface (D7 gate):
rg ': Date\b' packages/**/contract.d.ts test/integration/**/contract.d.ts

# Library — any/ts-expect-error/file-extension imports (all dispatches):
rg ': any\b|\bany\[\]' packages/ -g '*.ts'
rg '@ts-expect-error' packages/ -g '*.ts' -g '!*.test-d.ts'

# Library — no projects/ references in long-lived files (D8 gate):
rg 'per spec|the spec\b|sub-spec|milestone' -- ':!projects/' ':!*.generated.*'
```

## Dispatches

### D1: Driver hands temporal OIDs through as text

- **Outcome:** Every row-producing path in the PostgreSQL driver returns PostgreSQL's own text for `date`, `time`, `timestamp`, `timestamptz` and their array OIDs — buffered and cursor, named and unnamed — via per-query parser overrides. No global `pg.types` mutation; no change to user-supplied `Pool`/`Client` configuration.
- **Builds on:** The spec's chosen design; the existing `QueryConfig` construction in `executeBuffered` and the `_conf.types` forwarding already present in `named-cursor.ts`.
- **Hands to:** Server text for temporal OIDs at the codec boundary, plus the enumerated known-red list.
- **Focus:** `packages/3-targets/7-drivers/postgres/`. Driver-level tests assert the wire form directly (`typeof === 'string'`, arrays as `string[]` with element text intact) for both execution paths. Resolving open question 1 (array-OID strategy) is in scope. Codec behaviour is not — old codecs go red here and stay red.
- **Tier:** Opus (substrate change).

### D2: Four `*String` codecs

- **Outcome:** `pg/date-string@1`, `pg/timestamp-string@1`, `pg/timestamptz-string@1`, `pg/time-string@1` exist as identity codecs in both directions, declare `targetTypes = []`, carry `['equality', 'order']`, render `TimestampString<P>`-style output types, and are registered in `codec-type-map.ts` and the adapter's `descriptor-meta.ts`.
- **Builds on:** D1's server text at the codec boundary.
- **Hands to:** A working representation that needs no `Temporal` global — the escape hatch every later error message points at.
- **Focus:** Tests prove PostgreSQL-accepted input is forwarded unchanged and that `infinity`, extended ranges, session `TimeZone`, and session `DateStyle` output all remain observable as text. No Temporal anywhere in this dispatch.
- **Tier:** Sonnet (single-package new feature, pattern established).

### D3: Four Temporal codecs and the capability error

- **Outcome:** `pg/date-temporal@1`, `pg/timestamp-temporal@1`, `pg/timestamptz-temporal@1`, `pg/time-temporal@1` parse server text through the corresponding `Temporal.*.from()` and serialize via `toString()`. `RUNTIME.TEMPORAL_UNAVAILABLE` joins `PostgresTargetErrorCode`, `errorTemporalUnavailable(codecId, operation)` is its factory, and `requireTemporal()` performs the check lazily at codec invocation.
- **Builds on:** D1's server text; D2's `*String` codecs, which the boundary errors name as the lossless alternative.
- **Hands to:** Both representations working end-to-end for scalars.
- **Focus:** **Open question 2 is settled first, by test** — whether `Temporal.Instant.from()` accepts PostgreSQL's `+00` offset and space separator. The rest of the dispatch builds on that answer. Also in scope: the narrow BC / expanded-year adaptation, `infinity` and out-of-Temporal-range rejection, ISO-calendar-only writes, full-precision serialization, `temporal-polyfill` as a devDependency with global install in test setup, and a test proving the error code survives the generic decode path uncwrapped. No hand-written ISO grammar regex.
- **Tier:** Opus (the slice's judgment concentration).

### D4: JSON projections cast to text

- **Outcome:** All eight temporal descriptors project through a `text` cast, so a nested JSON-built read returns the same server text a flat read returns. `utcIsoJsonProjection` is gone.
- **Builds on:** D2 + D3 — all eight descriptors exist.
- **Hands to:** Flat/nested agreement for both representations at full precision.
- **Focus:** Per F13, the agreement fixture must carry a microsecond component that the retired `to_char(..., '.MS')` format would have truncated — otherwise the test passes with the old projection still in place. Existing tests asserting the `+00:00` suffix are rewritten, not preserved; the session-`TimeZone` dependence this introduces is the decided behaviour.
- **Tier:** Sonnet (narrow surface, decision already settled).

### D5: Authoring, PSL, and introspection select the new codecs

- **Outcome:** `temporal.timestamp/timestamptz/createdAt/updatedAt` resolve to Temporal codecs; `temporal.timestampString/timestamptzString/createdAtString/updatedAtString` exist with equivalent precision and default behaviour; PSL accepts `DateString`, `TimestampString(p)`, `TimestamptzString(p)`, `TimeString(p)`; introspection continues to emit the bare Temporal-backed names with native precision.
- **Builds on:** D2 + D3's registered descriptors.
- **Hands to:** Every authoring surface selecting a representation explicitly.
- **Focus:** The `*String` presets are **additive** factories in `@internal/family-sql/control`; SQLite calls the same module and its package tests are the gate proving it is untouched. `timestampNow` keeps its internal `Date` and its one-value-per-ORM-operation semantics. Per F24, rebuild `3-targets/postgres` before typechecking downstream consumers.
- **Tier:** Opus (multi-package, cross-family shared surface).

### D6: Delete `sql/timestamp@1` and the old PostgreSQL temporal IDs

- **Outcome:** The `sql/timestamp@1` descriptor, codec, helpers, and ID are removed from `relational-core`; `field.timestamp()` is gone; `pg/date@1`, `pg/timestamp@1`, `pg/timestamptz@1`, `pg/time@1` and their codec classes are removed; aggregate mappings, `descriptor-meta` registrations, control-plane hooks, and testkit cases follow. The slice's retired-ID greps return zero across `packages/`.
- **Builds on:** D5 — nothing authors the old IDs any more.
- **Hands to:** A source tree with exactly one temporal codec surface.
- **Focus:** Per F3, enumerate consumers with `rg` before running any suite. `pnpm lint:deps` runs here. `timetz` and `interval` are untouched — their codecs share helpers with the deleted ones and must keep working.
- **Tier:** Sonnet (mechanical migration crossing multi-system invariants).

### D7: Regenerate fixtures and close the red window

- **Outcome:** Every checked-in `contract.json` / `contract.d.ts` is regenerated; `pnpm fixtures:check` is clean; no generated declaration types a temporal field as `Date`; the known-red set is empty; `pnpm test:packages`, `pnpm test:integration`, and `pnpm test:e2e` pass.
- **Builds on:** D6's single-surface source tree.
- **Hands to:** A green workspace on the new representation model.
- **Focus:** Fixtures under `test/integration/**`, `packages/3-extensions/**` (paradedb, pgvector, postgis, supabase, sql-orm-client), and `packages/2-sql/4-lanes/sql-builder/test/fixtures/**`. Fixture drift outside the temporal surface is investigated, not committed. Integration coverage must include buffered, cursor, array, flat, and nested reads for both representations.
- **Tier:** composer-2.5-fast (fixture regen), escalating to Sonnet if a fixture diff needs judgment.

### D8: Documentation

- **Outcome:** Canonical user and architecture documentation describes the representation model, the raw-string contract, the Temporal installation expectation, the driver text boundary, unsupported values, and precision behaviour — plus a migration section covering `sql/timestamp@1`, the retired PostgreSQL IDs, and the `Time` representation change.
- **Builds on:** D7's settled behaviour.
- **Hands to:** The slice's documentation DoD condition.
- **Focus:** No ADR (operator decision — this lands within ADR 030 / ADR 202). Docs are written against shipped code, not against the spec sketch, per [`drive/spec/README.md § Grounding illustrative snippets`](../../../../drive/spec/README.md). The `projects/`-reference grep gate runs here.
- **Tier:** composer-2.5 (voice-aware doc edits).

## Handoff linearity check

D1 → D2 → D3 are linear. D4 builds on **both** D2 and D3 (it needs all eight descriptors, not just D3's). D5 likewise builds on D2 + D3, not on D4 — the projection work and the authoring work are independent given the descriptors, and D4 is sequenced first only because it keeps the codec surface settled before authoring fans out. D6 depends on D5 alone. D7 and D8 are linear.

## Completeness check against slice-DoD

| Slice-DoD condition | Closed by |
| --- | --- |
| Retired-ID greps return zero | D6, re-run at D7 |
| No `Date` in generated temporal types | D7 |
| `pnpm fixtures:check` passes, fixtures committed | D7 |
| String-only client runs with no `Temporal` global | D2, re-verified at D7 |
| `pnpm lint:deps` clean | D6 |

Plan-side overlays from [`dod.md § Slice-DoD overlay`](../../../../drive/calibration/dod.md#slice-dod-overlay): the `3-extensions` fixture step is D7; `lint:deps` is D6; the downstream typecheck-after-build is D5.

## Open items

1. Manual QA — the slice changes a user-observable generated surface (`contract.d.ts` temporal field types), so the QA-side slice-DoD items apply. `drive-qa-plan` runs after D7, once behaviour is settled.
2. **Pre-existing red, not ours** (surfaced at D1): `packages/1-framework/3-tooling/cli/test/migration-cli.test.ts` fails 9 tests with `CONFIG.FILE_NOT_FOUND`. Verified independent of this slice — `@internal/driver-postgres` is not resolvable from the CLI package at all, so it cannot be downstream of the driver change; likely fallout from `4df1c997c7`. **D7's "red set empty" gate excludes these 9 tests by name.** If they are still failing at slice close, they are called out in the PR description rather than silently absorbed.
3. **Known flake** (surfaced at D1): `test/integration/test/cli.init-skill-distribution.integration.test.ts` `afterAll` `rmSync` hook can time out at 5000 ms. No temporal surface. Excluded from red-set accounting.

## Known-red baseline (established at D1)

9 files / 15 tests, all failing in the expected shape (a string where a `Date` was asserted, or `TypeError: Cannot read properties of undefined (reading 'codecId')` from a Date-typed codec receiving text). Every later dispatch's red set must be a subset of this.

| File | Tests | Gate |
| --- | --- | --- |
| `packages/3-targets/6-adapters/postgres/test/scalar-list-codec-roundtrip.integration.test.ts` | 1 | `test:packages` |
| `test/integration/test/infer-roundtrip-runtime.integration.test.ts` | 1 | `test:integration` |
| `test/integration/test/scalar-lists/psl-list-roundtrip.integration.test.ts` | 1 | `test:integration` |
| `test/integration/test/ports/prisma/functional/create-default-date/create-default-date.test.ts` | 1 | `test:integration` |
| `test/integration/test/ports/prisma/functional/issues-14954-date-batch/issues-14954-date-batch.test.ts` | 2 | `test:integration` |
| `test/integration/test/ports/prisma/functional/issues-23902/issues-23902.test.ts` | 1 | `test:integration` |
| `test/integration/test/ports/prisma/functional/issues-28192-pg-historical-dates/issues-28192-pg-historical-dates.test.ts` | 5 | `test:integration` |
| `test/integration/test/ports/prisma/functional/multiple-types/multiple-types.test.ts` | 1 | `test:integration` |
| `test/e2e/framework/test/dml.test.ts` | 2 | `test:e2e` |

`issues-28192-pg-historical-dates` is worth D3's attention specifically — historical dates are where the BC / expanded-year adaptation gets exercised.
