# port-all-tests

Port every in-scope functional/integration test from `prisma/prisma` and `prisma/prisma-engines` into prisma-next, faithfully, with per-test accounting for everything that cannot be ported or does not pass.

## Purpose

Give prisma-next a behavioral-compatibility corpus derived from the two upstream Prisma test suites, so that "does prisma-next cover Prisma's behavior?" stops being a guess and becomes a measurable ledger: every upstream test either runs (green) against prisma-next's public API, runs as a documented expected-failure, or has an individually recorded reason it cannot be expressed. The resulting corpus doubles as a permanent regression net and as a precise, test-granular map of prisma-next's remaining feature gaps.

## At a glance

Two source corpora, pinned at the SHAs investigated for this spec, are ported into a new corpus inside the existing integration-test package:

| Source | Pinned SHA | In-scope surface | Approx. volume | Target directory |
| --- | --- | --- | --- | --- |
| `prisma/prisma` | `a6d0155` | Generated-client ORM API (queries, writes, regressions), `prisma migrate`/`db` workflows, CLI commands | ~740 client-functional files (218 suites + 92 issue-regression dirs), 34 migrate test files, 21 CLI test files, 23 legacy integration files | `test/integration/test/ports/prisma/` |
| `prisma/prisma-engines` | `e922089` | Query-engine JSON/GraphQL protocol tests, schema-engine JSON-RPC behavior (createMigration/applyMigrations/diff/schemaPush/introspect/…), schema-engine CLI black-box tests | ~1,672 `connector_test` fns + 185 `relation_link_test` fns (query engine), 775 migration + 584 introspection + 116 mongo-schema + 25 CLI-JSON-RPC test fns | `test/integration/test/ports/engines/` |

The full suite-level enumeration — every source directory, its file/test counts, and its in/out-of-scope verdict with reason — lives in [`inventory.md`](./inventory.md). That inventory is the scope contract for this project: a suite not listed there as in-scope is not silently in play.

Each ported test lands in exactly one of three buckets, and every in-scope source test lands in exactly one bucket (the accounting invariant):

1. **Ported and passing** — a vitest test under `test/integration/test/ports/{prisma,engines}/` that uses the same database schema (translated to prisma-next contract authoring), performs logically the same query through prisma-next's nearest public API, and asserts the same assertions.
2. **Ported and failing** — a faithful port that does not pass against today's prisma-next: converted to `test.fails`, with an entry in `failing.md` naming its location and the reason for failure.
3. **Non-portable** — an individual entry in `non-ported.md` naming the exact source location, what the test verifies, and the specific reason it cannot be faithfully expressed. One line per test; no generalized "and similar" entries.

A non-portable entry whose reason Prisma 8 has since removed keeps its place and starts its reason with **Not yet ported** (the test can now be expressed, and the entry names the API) or **Needs re-examination** (the old reason no longer holds and the new answer is not settled). Both still count as non-portable until the test is ported or a reason that holds is written; [`test/integration/test/ports/README.md`](../../test/integration/test/ports/README.md) gives the command that counts them, and their checklist lines are unchecked and marked with the same status.

Worked example of a faithful port (prisma/prisma functional test → prisma-next):

```ts
// upstream: packages/client/tests/functional/distinct/tests.ts (postgres matrix entry)
const users = await prisma.user.findMany({ distinct: ['name'], orderBy: { name: 'asc' } })
expect(users).toEqual([{ id: expect.any(String), name: 'a' }, { id: expect.any(String), name: 'b' }])

// port: test/integration/test/ports/prisma/functional/distinct/distinct.test.ts (test + its _fixture/ co-located)
// same table shape authored via contract builders; same rows seeded; same assertion
const users = await db.public.User.orderBy((u) => u.name).distinctOn('name').select('id', 'name').all()
expect(users).toEqual([{ id: expect.any(String), name: 'a' }, { id: expect.any(String), name: 'b' }])
```

Porting is executed by fleets of implementer sub-agents (≤10 source files per batch), each batch gated by a reviewer sub-agent that judges faithfulness against the criteria above and loops the implementer until satisfied (see Cross-cutting requirements § Execution process).

## Non-goals

- **No production-code changes.** Gaps discovered by ported tests are recorded (`test.fails` + `failing.md`, or `non-ported.md`) — never worked around in the test and never fixed in framework code inside this project. Feature work that failing ports reveal is future, separate projects.
- **No emulation of unsupported databases.** MySQL-, MariaDB-, SQL Server-, CockroachDB-, Vitess/PlanetScale-, and D1-only tests are not approximated on Postgres; each gets its `non-ported.md` line.
- **No SQLite corpus.** prisma-next's SQLite target is pre-GA with no self-contained integration harness in `test/integration`; SQLite-only source tests are recorded as non-ported (revisit as a follow-up project when SQLite matures — Open question 6).
- **No wire-protocol emulation.** The query-engine JSON/GraphQL protocol and schema-engine JSON-RPC stdio transport are not re-implemented; engine tests are re-expressed through prisma-next's public surfaces (see Place in the larger world § Surface mapping).
- **Out-of-scope upstream suites stay out**: bundler/packaging e2e (`packages/client/tests/e2e`), type-level tests, benchmarks, memory tests, and internal-API unit tests (e.g. `sql-schema-describer`) — per-suite verdicts in `inventory.md`.
- **No re-creation of upstream harnesses.** No provider-matrix generator, no schema templating engine, no insta-snapshot runner; each ported test is a plain vitest test using the repo's existing PGlite/Mongo helpers.

## Place in the larger world

- **Sources**: `/tmp/prisma` (SHA `a6d01554528e016bea1467a072776b0e2b94dcba`) and `/tmp/prisma-engines` (SHA `e922089b7d7502aff4249d5da3420f6fa55fc6ad`). Shallow clones; if a checkout is recreated, it must be pinned to the same SHA so the accounting ledger stays stable.
- **Target package**: `integration-tests` (`test/integration/`), whose vitest config includes `test/**/*.test.ts` and already carries the two self-contained DB harnesses this project relies on: PGlite via `@repo/test-utils` (`withDevDatabase`, `withClient`, single-connection constraint, `retry: 2` CI flakiness policy) and MongoDB via `mongodb-memory-server` (`MongoMemoryReplSet`, `fileParallelism: false`, `timeouts.spinUpMongoMemoryServer`).
- **Surface mapping** (which prisma-next public API each upstream surface ports onto):

  | Upstream surface | prisma-next target surface |
  | --- | --- |
  | Prisma Client queries/writes (`findMany`, `create`, `$transaction`, …) | `orm()` / `Collection` API from `@internal/sql-orm-client` (`where/include/select/orderBy/groupBy/aggregate/create/update/delete/…`), `withTransaction` from `@internal/sql-runtime`; mongo equivalents from the mongo family packages |
  | Prisma Client raw queries (`$queryRaw` / `$executeRaw`) | `sql()` builder raw-SQL path (`param()`, raw expression) |
  | Query-engine `connector_test` (GraphQL/JSON protocol request → JSON response snapshot) | ORM/`sql()` query producing equivalent result data; snapshot assertions translated to explicit `toEqual` on the equivalent result (Open question 7) |
  | Schema-engine JSON-RPC (`createMigration`, `applyMigrations`, `diff`, `schemaPush`, `evaluateDataLoss`, `introspect`, `dbExecute`, …) and `prisma migrate`/`db` CLI tests | prisma-next CLI commands (`migration-new`, `migration-plan`, `migrate`, `migration-status`, `db-init`, `db-update`, `db-verify`, `db-schema`, …) and the CLI's programmatic Control API; existing patterns in `test/integration/test/cli-journeys/` |
  | `prisma` CLI (validate/format/generate/init/version) | prisma-next CLI equivalents (`format`, `contract-emit`, …) where an equivalent command exists; otherwise non-ported |
  | Schema definitions (`schema.prisma` fragments) | prisma-next PSL (`.prisma`) or TS contract builders (`defineContract`, `field`, `model`, `rel`) — whichever expresses the source schema faithfully; PSL preferred when the source schema translates 1:1 |

- **Known-gap references that predict `non-ported.md`/`failing.md` density**: `packages/2-sql/4-lanes/sql-builder/STATUS.md` (no CTEs, set ops, window functions, `CASE`, arithmetic, `IS NULL`/`LIKE`/`BETWEEN`, JSON/array operators, …), `docs/reference/framework-gaps.md`, `docs/reference/mongodb-feature-support-priorities.md`, and API-shape mismatches (no `$extends`/`$use`, no array-form `$transaction`, `Numeric` branded string instead of `Prisma.Decimal`, `Uint8Array` instead of `Buffer`).
- **Repo boundaries the corpus must respect**: `test/integration/test/contract-imports.test.ts` enforces the allowed public-import boundary; ported tests import only public package exports (which is also this project's faithfulness premise).

## Cross-cutting requirements

### Faithfulness (the porting contract)

Every ported test must satisfy all three, and the reviewer gate judges exactly these:

1. **Same database schema** — the source test's models/tables, columns, types, constraints, and relations, translated to prisma-next contract authoring (PSL). No simplifying the schema to dodge an unsupported construct.
2. **Logically the same query** — the same operation with the same inputs through prisma-next's nearest public API per the surface mapping. API-shape translation (`findMany` → `.where().all()`) is expected; changing what the query does is not.
3. **The same assertions** — the same expected data, ordering, counts, and error conditions. Error-code assertions map to prisma-next's equivalent error condition (Open question 4); snapshot assertions become explicit equality assertions on the equivalent payload.

### No workarounds — THE hard gate (read this before porting anything)

**A ported test must exercise the same thing the upstream test exists to verify. If it cannot, it is NOT ported — it is `non-ported` (can't be expressed) or `test.fails` (expressed faithfully but fails today). Producing a green test that verifies something *different* is strictly worse than an honest `non-ported.md` line: it is a false positive that corrupts the ledger and lies about prisma-next's coverage.**

**The subject test.** Before porting, name the test's SUBJECT in one phrase — the specific behaviour/feature/input/mechanism it exists to prove (not "it returns some rows"). Then ask: *does prisma-next's public API let me exercise that exact subject?*
- **Yes** → port it (passing, or `test.fails` if it runs but the result diverges).
- **No** → `non-ported.md`. Do **NOT** reach for a different mechanism that happens to produce a passing assertion.

**Allowed — API-shape translation** (syntax changes that preserve the subject):
- `findMany({ where })` → `.where().all()`; `findUnique({ where: pk })` → `.where(pk).all()` then the single row; `updateMany(data)` → `.updateAll(data)`; `count` → `.aggregate(a => ({ n: a.count() }))`.
- Snapshot/inline-snapshot → explicit `toEqual` on the same payload. Prisma error code → the equivalent prisma-next error *condition* on the same operation.
- Result-type shape that prisma-next genuinely uses (Numeric branded string vs `Prisma.Decimal`, `Uint8Array` vs `Buffer`) — assert prisma-next's real shape of the *same value*.

**FORBIDDEN — feature substitution (this is a workaround; the test becomes `non-ported`/`test.fails` instead):**
- Swapping the **mechanism under test** for a different supported one — e.g. a `$queryRaw`/`$executeRaw` raw-SQL test rewritten as an ORM `.where().all()` query. Raw-SQL execution is the subject; the ORM is a different feature. → `non-ported`.
- Swapping the **input under test** — e.g. a "Decimal.js instance input" test rewritten to pass a string; a `Prisma.skip` sentinel test rewritten without it. The input form is the subject. → `non-ported`.
- Replacing an **unsupported operation** with a hand-rolled emulation — atomic `{ increment: 1 }` → read-modify-write; nested relation `create`/`update`/`updateMany` → manually inserting join/child rows; `_count`-in-`include` → a separate `aggregate` query. → `non-ported`, or `test.fails` if you write the faithful (unsupported) call and it throws.
- Silently accepting **different semantics** — inclusive cursor asserted against prisma-next's exclusive cursor and "fixed" by changing the expected rows. Write the faithful cursor call and mark `test.fails`.
- **Weakening the assertion** to pass — dropping the count/ordering/exact-value the upstream test asserts, or asserting only "does not throw" when upstream checks a value. If prisma-next can't produce the asserted result, that's `test.fails`, not a weaker green.
- **Under-porting a matrix** — porting 4 of 63 cases and checking the rest off. Port every in-scope case, or, if the whole phenomenon doesn't exist in prisma-next (e.g. client-codegen name collisions), `non-ported` the suite with that reason — don't ship a green that tests nothing.
- **Dropping type-level assertions** — see below. `expectTypeOf`/`@ts-expect-error` assertions are part of what the test verifies and prisma-next CAN express them; silently deleting them (keeping only the runtime half) is weakening the port.
- **In-memory post-processing to satisfy an assertion** — sorting, filtering, grouping, or aggregating the ORM result in JS (`result.sort(...)`, `.filter(...)`, a hand-rolled sum/count) to reproduce what the upstream query asked the *database* to do. The database does the work through the ORM, or the test is `test.fails`/`non-ported`. (Mirroring an in-JS post-step the upstream test itself performs — e.g. upstream also calls `result.sort()` — is fine; substituting a query-level `orderBy`/`where`/aggregate with a JS one is not. A `groupBy` whose `orderBy` prisma-next cannot express is `non-ported`, not a JS `.sort()`.)
- **`_count: true` all-relations shorthand** — Prisma's `select: { _count: true }` returns a count of *every* relation; prisma-next has no all-relations-count surface → `non-ported`. (This is the ONLY `_count` case that's non-portable: a *specific* relation count — `_count: { select: { posts: true } }` — IS faithfully ported via `include('posts', p => p.count())`, which is the correct mechanism, not a substitution.)
- **Explicit `undefined` / sentinel inputs replaced by omission** — `select: undefined` / `include: undefined` / `Prisma.skip` / `Prisma.JsonNull` test how the API treats a *passed* value; *omitting* the argument tests something different → `non-ported`.
- **Prisma string operators mapped to `LIKE`** — `startsWith` / `endsWith` / `contains` / `mode: 'insensitive'` are not `.like()` / `.ilike()`: they are distinct operators with their own metacharacter escaping. prisma-next has no `startsWith`/`endsWith`/`contains`, so mapping them to `like`/`ilike` is feature-substitution → `non-ported`.

**Before writing a "not supported" `non-ported` reason, verify it against the public exports — a non-port that names a capability prisma-next actually has is a false negative that hides real coverage.** Confirmed-supported surfaces that must NOT be non-ported for "unsupported": **interactive transactions** — the high-level facade method `postgres({ contract, pg }).transaction(async tx => { … tx.orm.<ns>.<Model> … })` (this is the idiomatic API a user writes; `withTransaction` from `@internal/sql-runtime` is the low-level primitive it wraps — prefer the facade). A callback `$transaction(async tx => …)` ports to it; only the *array/batch* `$transaction([...])` form is genuinely absent, **`ilike`** (case-insensitive LIKE), **nested M:N create/connect through an explicit junction**, and **inline type assertions** (a type-only upstream test — `@ts-expect-error`/`expectTypeOf` with no runtime half — ports to an inline type assertion; "type-only" / "type-check-only" is NEVER by itself a non-port reason). Grep the package exports before asserting absence.

**Naming.** Ports use clear, descriptive names — fixtures, `with<Suite>` harness wrappers, and locals. No cutesy or opaque abbreviations (`withCMaR`); a reader should know what a helper is from its name.

**Type-level assertions are ported, not dropped, and NOT split into a separate file.** prisma-next has a typed public surface (the emitted `contract.d.ts` + the ORM's inferred result/where/create types) and first-class type-test infrastructure: `expectTypeOf` / `@ts-expect-error` are available (negative type tests are explicitly sanctioned by CLAUDE.md). So an upstream test's type assertions have a faithful home:
- Put the type assertions **INLINE in the same `it()`** as the runtime `expect(...)`, exactly as upstream keeps both in one `tests.ts`. `expectTypeOf(...)` / `@ts-expect-error` work in a `.test.ts` and are gated by `pnpm typecheck` (`tsc --noEmit` over `test/**/*`; vitest's esbuild silently strips type errors, so typecheck is the real gate). Do **not** create sibling `.test-d.ts` files — that splits a single upstream test across two files and drops the co-located runtime+type coupling. An upstream test asserting BOTH a type error and a runtime throw ports with both inline; if prisma-next type-rejects but does not throw at runtime, mark the test `it.fails`.
- `expectTypeOf(result).toMatchTypeOf<{ id: string; name: string }>()` / `.not.toBeAny()` → assert the prisma-next ORM's inferred row type the same way (see `test/integration/test/dsl-type-inference.test-d.ts` for the assertion vocabulary: `expectTypeOf<Row>().toHaveProperty(...)`, `.toEqualTypeOf<...>()`).
- Upstream `@ts-expect-error` on an invalid query (wrong field, wrong operator, wrong type) → `@ts-expect-error` on the equivalent invalid prisma-next ORM call, inline in the same `it()`. A whole `query-validation`-style suite of `@ts-expect-error` cases ports to inline `@ts-expect-error` assertions on the equivalent invalid ORM calls — it is **portable**, not "type-only → non-ported".
- **When a type assertion IS non-portable:** only when it names a *Prisma-generated* type that has no prisma-next equivalent (`Prisma.UuidFilter`, `Prisma.AtLeast<…>`, generated `PrismaClient` shapes) AND the underlying constraint cannot be re-expressed against a prisma-next type. Then that individual assertion is `non-ported` with that precise reason — but first check whether the constraint (e.g. "`contains` is not allowed on a UUID filter") can be re-expressed as `@ts-expect-error` on the prisma-next filter type; if it can, port it.
- Out of scope remains only the *dedicated* upstream type-test directories called out in `inventory.md` (`packages/client/src/__tests__/types/**`), not the type assertions embedded in in-scope functional suites.

**Litmus for the reviewer (reject the port if any is "yes"):** Did the port change the *mechanism*, the *input*, or the *asserted result* relative to upstream, in order to pass? Would this test still pass if prisma-next's missing feature were suddenly added and behaved like Prisma's? (A faithful `test.fails` would flip to green; a workaround wouldn't change.)

Faithfulness takes precedence over local test-style rules (e.g. the sql-orm-client whole-shape-assertion rule) inside `test/ports/**`; repo-wide mechanical rules (no `should` in titles, no `any`, lint) still apply. When in doubt, `non-ported` with a precise reason beats a clever green.

### Accounting

- The ledger is the checklist corpus at [`checklists/`](./checklists/): one checkbox line per in-scope source test function/case (not per file), enumerated **up-front by Opus enumeration sub-agents before any porting batch runs** — one checklist file per corpus segment, each line carrying the source test identifier, a one-line description, and its connector/provider applicability tags parsed from source.
- **Checkbox protocol**: boxes start `[ ]`. The Opus reviewer sub-agent — and only the reviewer — checks `[x]`, and only once satisfied that the test is (a) faithfully ported and passing, (b) faithfully ported as `test.fails` with a `failing.md` entry, or (c) covered by a justified individual `non-ported.md` entry. Implementer sub-agents never check boxes. Roll-up totals live in `test/integration/test/ports/README.md`.
- `non-ported.md` — one entry per test: exact source location (file path + test name), a one-line description of what it tests, and the specific reason it cannot be ported. No grouped or generalized entries.
- `failing.md` — one entry per `test.fails` test: ported-test location and the reason for the failure (what prisma-next does instead / which gap it hits).
- Locations: `non-ported` entries live one file per suite at `test/integration/test/ports/prisma/non-ported/functional/<suite>/<suite>.md` (mirroring `functional/<suite>/`); `test.fails` entries live in the single `test/integration/test/ports/prisma/failing.md`. The engines corpus mirrors this under `test/integration/test/ports/engines/` (Open question 2).

### Corpus mechanics

- Target tree: `test/integration/test/ports/{prisma,engines}/`, mirroring source-suite structure beneath (e.g. `ports/prisma/functional/…`, `ports/prisma/issues/…`, `ports/engines/queries/…`). Each ported suite is its OWN directory `ports/prisma/functional/<suite>/` holding the `<suite>.test.ts` next to its co-located `_fixture/` (`contract.prisma` + `prisma-next.config.ts` + `generated/`); the test imports the contract from `./_fixture/generated/…` and the harness from `../../../_harness/…`. The extra `test/` path segment vs. the originally stated `test/integration/ports/` is deliberate — it is what the package's vitest `include` picks up (Open question 1).
- Ported tests run under `pnpm test:integration`; given corpus scale, a dedicated vitest project/script (`pnpm test:ports`) may be split out for CI sharding, but the corpus must stay in CI either way.
- Databases: Postgres tests run on PGlite, Mongo tests on `MongoMemoryReplSet`. For upstream provider-matrix suites, port the postgres entry (and the mongo entry when the suite's matrix includes mongo); provider-exclusive suites for unsupported databases go to `non-ported.md`.
- Fixtures are **co-located** with their test at `ports/prisma/functional/<suite>/_fixture/` (a suite needing several schemas nests them under `_fixture/<variant>/`). A schema genuinely shared by two suites is **duplicated** into each suite's `_fixture/` so every suite directory is self-contained — cross-suite fixture imports are avoided.

### Execution process (operator-mandated)

- **Mandatory sub-agent briefs.** For prisma/prisma batches, the orchestrator MUST dispatch every implementer with [`briefs/implementer.md`](./briefs/implementer.md) verbatim (filling only `<<BATCH LABEL>>` / `<<SUITE LIST>>`) and every reviewer with [`briefs/reviewer.md`](./briefs/reviewer.md) verbatim. For prisma-engines query batches, the orchestrator MUST instead use [`briefs/engine-implementer.md`](./briefs/engine-implementer.md) and [`briefs/engine-reviewer.md`](./briefs/engine-reviewer.md) verbatim, filling only their documented placeholders. Do NOT weaken, paraphrase, or drop clauses from these briefs — earlier ad-hoc briefs that omitted the no-workarounds gate, the type-assertion rule, and the `pnpm typecheck` gate are exactly what let bent-to-pass ports, dropped assertions, and hidden type errors into the corpus. Improvements go INTO the corpus-specific brief files (single source of truth), not into a one-off dispatch. The orchestrator independently re-runs `pnpm test` + `pnpm typecheck` + `pnpm lint` on every batch before trusting an agent's report (agents have fabricated "done" reports).
- **Enumeration precedes porting**: parallel **Opus enumeration sub-agents** produce the full per-test checklist corpus (`checklists/*.md`) before the first porting batch is dispatched; the checklists are the work-list every batch draws from.
- Porting is done by parallel **Sonnet 5 implementer sub-agents**, each given **at most 10 source files** per batch, dispatched with the corpus-specific implementer brief (which carries the faithfulness contract, the no-workarounds gate, the type-assertions-inline rule, the PSL + contract-push pattern, the connector pattern, and the `pnpm typecheck` gate).
- When several tests depend on a fixture that does not yet exist, a **fixture sub-agent** implements the fixture first; dependent batches dispatch only after it lands.
- After each implementer batch, an **Opus reviewer sub-agent** — dispatched with `briefs/reviewer.md` — evaluates every ported test against the faithfulness criteria (assertion-by-assertion diff against the upstream source, per the reviewer litmus). If unsatisfied, the itemized fix list is forwarded to the implementer; the loop repeats until the reviewer is satisfied. A batch is done only on reviewer satisfaction.
- Reviewer satisfaction covers all three buckets: ported tests are faithful, `test.fails` entries are genuinely faithful-but-failing (not botched ports), and `non-ported.md` reasons are real (the API truly cannot express the test).

## Transitional-shape constraints

- Every merged batch leaves CI green: ported tests pass or carry `test.fails`, and the batch's `non-ported.md`/`failing.md`/ledger updates land in the same PR as its tests.
- The accounting invariant holds at every merge for all suites processed so far — no "port now, account later" gaps between batches.
- Source checkouts stay pinned at the SHAs above for the project's lifetime.

## Contract-impact

N/A — test-only project. No changes to `packages/0-shared/contract/**` or `packages/1-framework-core/**`. Ported fixtures author contracts exclusively through public authoring surfaces.

## Adapter-impact

Exercises (read-only) the postgres adapter/driver stack via PGlite and the mongo family via mongodb-memory-server. No adapter code changes are in scope; adapter gaps surfaced by ports are recorded in `failing.md`/`non-ported.md`.

## ADR pointer

N/A — no architectural shift. The corpus location, accounting convention, and faithfulness contract are documented in `test/integration/test/ports/README.md` as part of close-out.

## Project Definition of Done

- [ ] Team-DoD floor items (inherited; see [`drive/calibration/dod.md`](../../drive/calibration/dod.md)).
- [ ] Every in-scope source test enumerated in [`inventory.md`](./inventory.md) has a checklist line in [`checklists/`](./checklists/), and every checklist box is checked `[x]` by the reviewer: ported-passing, `test.fails` + `failing.md` entry, or `non-ported.md` entry.
- [ ] `test/integration/test/ports/{prisma,engines}/` exist, are included in CI (`pnpm test:integration` or a wired `pnpm test:ports`), and the full corpus is green (with `test.fails` markers counting as green).
- [ ] Every batch in the project history carries a satisfied Opus-reviewer verdict; no batch merged on an unsatisfied review.
- [ ] `non-ported.md` files contain only individual per-test entries (source location + description + reason); spot-audit confirms no generalized/grouped entries.
- [ ] `failing.md` entries each name the ported-test location and failure reason, and match the set of `test.fails` markers in the corpus one-to-one.
- [ ] `test/integration/test/ports/README.md` publishes the final roll-up: per-corpus totals of ported / failing / non-ported, with links to the ledgers.

## Open Questions

1. **Corpus path.** The request said `test/integration/ports/{prisma,engines}`; the package's vitest `include` is `test/**/*.test.ts`. Working position: `test/integration/test/ports/{prisma,engines}` so the corpus runs under the existing config without vitest changes.
2. **Ledger file placement.** "`non-ported.md`" was stated as a single file. Resolved: `non-ported` entries are split one file per suite at `ports/{prisma,engines}/non-ported/functional/<suite>/<suite>.md` (mirroring the co-located `functional/<suite>/` tree, so a suite's non-portable tests sit beside — or in place of — its port); `test.fails` entries stay in a single `ports/{prisma,engines}/failing.md`. Totals roll up in `ports/README.md`.
3. **Unsupported-database-only tests.** Individually listing every MySQL/MSSQL/CockroachDB/Vitess/SQLite-only test will produce thousands of `non-ported.md` lines. Working position: yes, individual lines as instructed — generated per batch from the source's own connector tags (`_matrix.ts` entries, `only(...)`/`exclude(...)` attributes), which make the per-test reason precise.
4. **Error assertions.** Upstream asserts Prisma error codes (`P2002`, `P4001`, …) prisma-next does not emit. Working position: assert the logically equivalent prisma-next error condition (e.g. unique-constraint violation error on the same operation); when no equivalent error surface exists, the test goes to `non-ported.md`.
5. **Ordering of corpora.** Working position (final say in `plan.md`): highest-signal-first — prisma client functional (postgres) → engines query-engine `queries`/`writes`/`regressions` → migrations/JSON-RPC → CLI → mongo suites → introspection — so gap discovery front-loads onto the most-used surfaces.
6. **SQLite.** prisma-next has an early SQLite target with e2e-only coverage. Working position: out of scope (non-ported lines with reason "SQLite target pre-GA / no integration harness"); a follow-up project can lift those entries when SQLite matures.
7. **Engine snapshot assertions.** `insta::assert_snapshot!` asserts exact protocol-response strings. Working position: translate the snapshot's expected payload into explicit `toEqual` assertions on the equivalent prisma-next result — same data, prisma-next's result shape; response-envelope formatting itself is not asserted.

## References

- [`inventory.md`](./inventory.md) — full suite-level source inventory with in/out-of-scope verdicts (the scope contract).
- Sources: `prisma/prisma@a6d01554528e016bea1467a072776b0e2b94dcba`, `prisma/prisma-engines@e922089b7d7502aff4249d5da3420f6fa55fc6ad` (checked out at `/tmp/prisma`, `/tmp/prisma-engines`).
- Target-surface docs: `packages/2-sql/4-lanes/sql-builder/STATUS.md`, `packages/1-framework/3-tooling/cli/README.md`, `docs/Testing Guide.md`, `docs/reference/framework-gaps.md`, `docs/reference/mongodb-feature-support-priorities.md`.
- Linear Project: _to be created at project kickoff (drive-create-project ceremony)._
