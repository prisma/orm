# Slice plan: atomic-temporal-cutover

**Slice spec:** [`spec.md`](./spec.md) · **Parent project:** [`projects/postgres-temporal-codecs/`](../../)

## At a glance

Eight dispatches, strictly sequential. The driver cutover lands first so every subsequent codec dispatch can be tested against real server text; the cost is a known-red window that must shrink monotonically and reach empty at D7.

## The known-red window

D1 changes what `pg` hands the codec layer. From that moment the four old Date-typed PostgreSQL temporal codecs receive strings they aren't typed for, and every test exercising them fails. This is the intended consequence of an atomic cutover, not a regression — but it removes "package tests green" as a usable gate for six dispatches, so it needs an explicit contract:

- **D1 produces the known-red list** — the enumerated set of test files failing because of the transport change, captured in the dispatch report.
- **Every later dispatch reports the current red set** and it must be a subset of the previous dispatch's. A dispatch that adds a new red file halts for orchestrator review.
- **D7 closes the window.** The red set is empty; the full gate set runs clean.
- **Amendment (D4).** The subset rule admits one class of growth: a dispatch may add a red file when the cause is an **old Date-typed codec path that this slice is retiring and D6 deletes**. That is the same structural event the window exists to hold, arriving on a path a later dispatch reaches. Each such addition is recorded below with its cause and its resolving dispatch. Growth from any other cause still halts. The rule this preserves is "no red is ever unexplained"; the rule it drops is "the count never rises", which was a proxy for it and turned out to be the wrong proxy for an atomic cutover that breaks the old surface path by path.
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

## Standing validation gate for D3–D8 (added after D2 review)

Every remaining dispatch runs **`pnpm lint:casts`** in addition to its per-package gates.

The per-package `lint` gate structurally cannot catch cast-ratchet regressions: the `no-bare-cast` Biome plugin's severity is `info`, so `biome check --error-on-warnings` stays green while `scripts/lint-casts.mjs` — a separate CI job at `ci.yml:118` — fails on any increase. D2 added three `params as Record<string, unknown>` casts in `codecs.ts` by copying the pattern the existing temporal descriptors already use, taking the count from 17 to 20 and turning the branch CI-red while every reported gate was green.

Per [F26](../../../../drive/calibration/failure-modes.md#f26-review-comment-point-fixed-the-defect-class-re-ships-in-new-places-next-round), this is a defect *class*: D3 adds four more descriptors of exactly the same shape, and D5 touches the same file again. Fixing only D2's three instances would reproduce it next dispatch.

Note that D6 deletes the old Date-typed descriptors, which carry several of the pre-existing casts — the count should fall, not merely hold, by slice close.

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

**Scope corrected at D6 R2** — a repo-wide sweep found generated contract artefacts in two directories this Focus never named:

- **`apps/`** — 6 files. `telemetry-backend/src/prisma/contract.{json,d.ts}` plus two `migrations/snapshots/<hash>/` pairs. This is also the true cause of the `cli-telemetry` failures, which were previously misclassified (including by the orchestrator) as "the package cannot resolve `target-postgres`, not ours". The real stack is `Column 'telemetry_event.ingestedAt' references codec 'pg/timestamptz@1'` at `apps/telemetry-backend/src/db.ts:8`; the harness reports "backend exited early" only because the backend is a child process. **`cli-telemetry` resolves at D7.**
- **`examples/`** — 27 files across `prisma-8-demo`, `prisma-8-cloudflare-worker`, `react-router-demo`, `paradedb-demo`, `prisma-8-postgis-demo`, `supabase`, `multi-extension-monorepo`, `bundle-size`.

`packages/` is down to 11 generated files; `test/` holds 130. Outside the three hand-written files named below, nothing hand-written still names a retired id — F36's 24 are gone.

### D7 open question — hash-addressed migration snapshots

**20 of the 33 `apps/` + `examples/` files sit under `migrations/snapshots/<64-hex>/`.** The directory name is a content hash, so regenerating a contract inside one is not a like-for-like fixture refresh: it either invalidates the hash or requires the snapshot chain to be re-derived. `apps/telemetry-backend` has 2 such pairs; `examples/prisma-8-demo` has 7.

**Settled at D6 R2 review, by investigation: regenerating a snapshot in place is structurally impossible.**

The directory name **is** the `storageHash` of the contract inside it, and the CLI actively verifies that identity — `migration-check.ts:137-143` reads `storage.storageHash` out of the snapshot and errors when it differs from the migration's `to=` metadata (*"declares to=X but its contract snapshot has storageHash=Y"*), and `contract-snapshot-resolution.ts` checks the same field when resolving hash → snapshot dir → `contract.json`. So regenerating a snapshot's contract changes its codec ids → changes the emitted contract → changes `storageHash` → breaks both the directory name and every migration's back-reference. Making it consistent would mean re-deriving `to=` / `from=` across the chain and renaming every snapshot directory in eight example projects.

Two corrections to the framing that produced this question. The **"falsifies history" argument does not apply** — unlike a CHANGELOG or an ADR, these have machine consumers, so they are not the prose-historical group. And **inertness never needed deciding**: the hash-identity property settles it first, because the files are immutable by construction regardless of whether anything reads them.

**Resolution:** snapshots naming retired ids stay as they are, and the retired-ID grep gate gains an explicit `**/migrations/snapshots/**` exclusion **with the reason recorded** — the same treatment the CLI flake gets, excluded by name with a rationale rather than silently.

### The one test that could overturn this, and D7 runs it first

Does any path **load a snapshot and resolve its codecs**? `migration check` only compares hashes and structure, so a stale id is inert there. But `db update --to <hash>` goes through `contract-snapshot-resolution.ts`, and if that builds an execution context, a deleted codec id is a hard runtime error.

Cheap to settle: run it against one `examples/prisma-8-demo` snapshot that names `pg/timestamptz@1` — four do.

**If it errors, this slice has broken backward migration for existing projects.** That is a finding for the project spec and a user-facing decision, not something a fixture sweep resolves. The `cli-telemetry` correction is the evidence that makes it worth running rather than assuming: a generated contract naming a deleted codec **does** fail at runtime, with the harness reporting a misleading child-process message on top of it.

### `types.test-d.ts:596` is on D7's explicit worklist, not the self-resolving bucket

The D6 R2 review accepted the deferral for `contract-builder.types.test-d.ts:117` — it compares a builder-derived row type against a *fixture*-derived one, so both sides converge when D7 regenerates and editing it now would be churn.

It **rejected** the deferral for `:596`. That line is `expectTypeOf<Row['createdAt']>().toEqualTypeOf<Date>()`, and `Row` derives from `enumDb = sql({…})` at `:566` — a **builder**-constructed contract, not a fixture. Regeneration provably cannot touch it. It is a hand-written assertion that a temporal field is `Date`, which is precisely what this project exists to remove, and the deferral's stated rationale ("reads through a fixture D7 regenerates") does not apply to it.

`:227` and `:411` are hand-written `new Date(...)` literals whose fate depends on whether their `Row` is fixture- or builder-derived — D7 checks rather than assumes.

### D7 must also hand-fix three files a regeneration cannot reach

`test/integration/test/contract-builder.test.ts`, `contract-builder.types.test-d.ts`, and `infer-roundtrip-runtime.integration.test.ts` assert the `Date` representation in **hand-written** code. Same species as F36. Two of them change shape once fixtures regenerate — `types.test-d.ts:117` should resolve on its own, `:596` flips from wrong-in-one-direction to wrong-in-the-other — so they need a hand pass **after** regeneration, not before. `pnpm --filter integration-tests typecheck` is the only gate that sees `:117` at all.
- **Tier:** composer-2.5-fast (fixture regen), escalating to Sonnet if a fixture diff needs judgment.

### D7 and D8 merged (operator decision, taken after D6)

The operator called the run too slow and was right. **D8 folds into D7 as one dispatch with one review**, and the gate cadence drops: `pnpm fixtures:check` plus targeted suites during iteration, **one** full serial workspace pass at the end rather than a pass per round.

**Low-severity findings no longer block.** Anything cosmetic — comment placement, prose wording, a fixture's reason string — is batched into the PR-open commit instead of costing an implement-plus-review cycle. `must-fix` still blocks.

The three choices that made the run slow, recorded so the retro has them rather than reconstructing them:

1. **F30 (JSDoc placement) and F34 (a fixture's reason string) each blocked a dispatch.** The findings discipline says every severity blocks `SATISFIED` and it was followed literally. Two full round-trips for cosmetics.
2. **All three workspace suites ran at nearly every dispatch.** The red set moved meaningfully only at D1, D4 and D6; `packages` alone was sufficient signal most rounds. One serial pass is 20-25 minutes and it ran eight-plus times.
3. **Eight dispatches was about two too many.** D2 and D3 were the same surface with the same shape, and D4's projection change could have folded into D3. Split for reviewability, paid for in round-trips.

The verification itself earned its keep — F31 caught a CI-red every reported gate showed green, F36 caught 24 tests passing because their assertions had become unreachable, the D6 comparison caught an entire missing search axis. That is an argument for the checks, not for their cadence.

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

### Admitted growth

| File | Tests | Added at | Cause | Resolved by |
| --- | --- | --- | --- | --- |
| `test/integration/test/sql-orm-client/include-codecs.test.ts` | 1 | D4 | The old `pg/timestamptz@1` codec's `decodeJson` gates on `ISO_8601_TIMESTAMPTZ.test(json)` (`codec-helpers.ts:296`) and the new projection hands it a space separator and `+00`, which cannot match. It throws by construction, so an `include` through it fails. D1 broke that codec's flat path; D4 breaks its nested one. | D6 (codec deleted, fixture migrated) |

Blast radius verified independently at D4 review: only `pg/timestamptz@1`'s projection changed among the old codecs. `pg/date@1`, `pg/timestamp@1`, `pg/time@1` and `pg/timetz@1` keep identity projections, so their `decodeJson`s receive exactly what they received before D4 and cannot newly break.

**Framing correction (D4 review).** Changing the ninth site was **not forced**. Keeping `utcIsoJsonProjection` for its single remaining consumer and adding `serverTextJsonProjection` only for the eight new descriptors was available, and would have cost neither this red nor the amendment above. What happened was a deliberate choice to retire a lossy policy one dispatch early — correct on the merits, since `pg/timestamptz@1` was already dead on the flat path from D1 and leaving its nested path alive would have left a known-lossy `.MS` path in the tree under a comment asserting an abandoned policy. The amendment stands on its own reasoning and does not rest on the change having been unavoidable.

**Conditions on the amendment** (D4 review, accepted):

- **Re-attribute per dispatch.** D5 and D6 restate this file's cause and resolving dispatch rather than inheriting "admitted" status.
- **It resolves by migration, not deletion.** D6 removes the codec; the fixture must move to a representation-explicit one, after which the test exercises the new nested path — strictly more coverage than before.
- **It must appear in D7's *red* accounting until it goes green, never in an exclusion list.** D7's exclusions stay limited to the CLI flake named in Open item 2. If this file ever appears as an exclusion, the amendment has been used to hide something and it is withdrawn.
