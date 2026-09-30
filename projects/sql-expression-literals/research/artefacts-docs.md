# Research: artefacts, docs and process outside the core code

Scope: everything outside the core code that changes when plain-string SQL bodies are refused in PSL and TypeScript, and `pg.sql` / `sqlite.sql` are removed. All paths are relative to the worktree root. Line numbers are from the tree at `6a5b58ecb7`.

Summary of what was found:

- 58 plain-string SQL bodies sit in one generated file, the Supabase pack's `contract.prisma`. Every other committed use is hand-written: 33 in `.prisma` fixtures and the Supabase example (4 + 4 + 4 + 10 + 11), 14 in committed `contract.ts` sources.
- Every committed body is one line long, contains no backtick, and has no leading whitespace. The Supabase pack's bodies contain no backslash. The hand-written policy fixtures contain only `\"` escapes, which become plain `"` inside a backtick literal.
- `fixtures:check` never rewrites a `.prisma` file. The Supabase pack's `contract.prisma` must be regenerated with `contract:generate`, and every hand-written file must be edited by hand.
- `check:error-reference` checks only dotted codes (`PSL.X`, `CONTRACT.X`). It does not check underscore codes such as `PSL_DEFAULT_TYPE_INCOMPATIBLE`, so no automated check requires those to be documented.
- The PR conventions disagree with each other on the title format. See section 7.

## 1. Committed artefacts that hold plain-string SQL or a prefixed tag

### 1.1 Generated: the Supabase pack contract

`packages/3-extensions/supabase/src/contract/contract.prisma` (775 lines).

How it is generated. `pnpm --filter @internal/extension-supabase run contract:generate` runs `tsx scripts/generate-contract.ts` (`packages/3-extensions/supabase/package.json` `scripts.contract:generate`). The script does this:

1. Starts a PGlite dev database (`createDevDatabase` from `@repo/test-utils`) and restores `test/fixtures/supabase-reference/` into it (`setUpSupabaseMockSchema`). This needs no Docker and no network. `--url <conn>` introspects a live database instead.
2. Introspects the `auth` and `storage` schemas with the Postgres control adapter. It then calls `postgresTargetDescriptor.inferPslContract`, so the text is whatever the Postgres `contract infer` printers produce.
3. Post-processes the result: removes the default on `auth.users.phone`, renames models (`AuthUser`, `StorageBucket`, …), applies named-type aliases, and adds a `namespace unbound { role … }` block.
4. Prints the result with `printPsl(merged, { pslBlockDescriptors })` and writes `src/contract/contract.prisma`.
5. Runs `node_modules/.bin/prisma contract emit` in the package root, which rewrites `src/contract/contract.json` and `src/contract/contract.d.ts`.

The printers that write the plain strings today:

- `packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-index-attributes.ts:41` prints `expression:`.
- The same file, line 60, prints `where:`.
- The same file, line 91, prints the `@@check` `expression:`.
- `packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-policy-blocks.ts:113-121` prints `using` and `withCheck` as `raw: JSON.stringify(...)`.

The file can only be regenerated after those printers emit `sql` literals. Hand-editing it would make it differ from the generator's output, and that drift was already fixed once (`upgrade-instructions/pending/supabase-contract-regenerated/`). No automated test compares this file with the generator's output.

Occurrences:

| Place | Count | Lines |
| --- | --- | --- |
| `@@index(where:)` | 11 | 74, 75, 76, 77, 78, 79, 283, 326, 359, 360, 597 |
| `@@index(expression:)` | 4 | 80, 417, 479, 735 |
| `@@check(expression:)` | 43 | 83, 126–129, 158, 193–210, 327–334, 362–364, 381, 419, 437–439, 459, 481, 497 |
| `@@fullTextIndex(where:)` | 0 | — |
| policy `using` / `withCheck` | 0 | — (the pack declares roles only) |
| Total | 58 | |

The file also holds 11 `@default(sql\`…\`)` literals. They are already in the new form. None of the 58 bodies contains a backtick, a backslash or leading whitespace. `contract.json` must not change, so `src/contract/contract.json` and `.d.ts` must come out byte-identical after regeneration.

Consequence for ordering (failure mode F30 in `drive/calibration/failure-modes.md:615`): `fixtures:check` runs `build:contract-space` on this pack. Once PSL refuses plain strings, that step fails until this file is regenerated. The printer change and the regeneration must land in the same PR as the refusal, and before it or in the same dispatch.

### 1.2 Hand-written `.prisma` sources and fixtures

| File | How its outputs are produced | Places and counts |
| --- | --- | --- |
| `examples/supabase/src/contract.prisma` | Hand-written. `pnpm --filter supabase-example emit` (`prisma contract emit`) writes `src/contract.json` and `.d.ts`. | `using`: 3 (lines 15, 22, 30). `withCheck`: 1 (line 31). |
| `packages/3-extensions/supabase/test/fixtures/example-app/contract.prisma` | Hand-written; byte-identical to `examples/supabase/src/contract.prisma`. `pnpm --filter @internal/extension-supabase emit` (config `test/fixtures/example-app.config.ts`) writes `example-app/contract.json` and `.d.ts`. | `using`: 3 (15, 22, 30). `withCheck`: 1 (31). |
| `packages/3-extensions/supabase/test/fixtures/renamed-policy/contract.prisma` | Hand-written. Same `emit` script (`renamed-policy.config.ts`). | `using`: 3 (17, 23, 29). `withCheck`: 1 (30). |
| `packages/3-extensions/supabase/test/fixtures/no-policy/contract.prisma` | Hand-written. | None. |
| `test/integration/test/authoring/parity/rls/schema.prisma` | Hand-written PSL half of a parity pair with `contract.ts`. `expected.contract.json` is rewritten by `pnpm --filter integration-tests emit:authoring`. | `using`: 7 (22, 28, 34, 47, 53, 60, 66). `withCheck`: 3 (35, 41, 54). |
| `test/integration/test/authoring/parity/default-sql-literal/schema.prisma` | Hand-written parity fixture. | Line 7: `@default(pg.sql\`(now() + interval '1 hour')\`)`. Change it to `sql`. The TS half (`contract.ts:15`) already uses `sql`. |
| `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/contract-expression-authored.prisma` | Hand-written CLI journey fixture, used by `expression-index-migration.e2e.test.ts:119,194` through `journey-test-helpers.ts:210`. | `expression:`: 2 (8, 10). `where:`: 1 (9). |
| `…/cli-journeys/contract-expression-authored-renamed.prisma` | Hand-written (`expression-index-migration.e2e.test.ts:123`). | `expression:`: 2 (8, 10). `where:`: 1 (9). |
| `…/cli-journeys/contract-expression-authored-editedbody.prisma` | Hand-written (`expression-index-migration.e2e.test.ts:153`). | `expression:`: 2 (8, 10). `where:`: 1 (9). |
| `…/cli-journeys/contract-rls-adopted.prisma` | Hand-written (`rls-exact-name-adoption.e2e.test.ts:80`). The body is Postgres's reprint and is compared byte for byte under `@@map`. | `using`: 1 (15). |
| `…/cli-journeys/contract-rls-wire.prisma` | Hand-written (`rls-exact-name-adoption.e2e.test.ts:103`). | `using`: 1 (15). |
| `packages/1-framework/2-authoring/psl-parser/test/format/fixtures/tagged-literal/input.prisma` and `expected.prisma` | Hand-written formatter fixture. | `pg.sql` at input lines 4 and 10 (`pg . sql "y"`) and expected lines 4 and 10. The formatter works on syntax only and never checks registered tags, so this fixture still passes after the removal. It uses `pg.sql` only as an example of a dotted tag. Decide whether to switch it to a tag that still exists, such as `postgis.geometry`, so readers do not think `pg.sql` exists. |

Checked and found clean. The other formatter fixtures (24 directories under `psl-parser/test/format/fixtures/`) contain none of the places. The same holds for `examples/prisma-8-demo/src/prisma/contract.prisma` and its migration copy: `@@fullTextIndex` has no `where:` there, and `@default(sql…)` is already in the new form. `test/integration/test/sql-orm-client/fixtures/self-relations/contract.prisma` has a `@@fullTextIndex` without `where:`. `apps/telemetry-backend/src/prisma/contract.prisma`, all `test/e2e/**` files, recordings, snapshots and `.mjs`/`.js` scripts contain none of the places either.

Not in scope: `packages/2-sql/2-authoring/contract-prisma7/test/fixtures/dbgenerated-without-expression/unread-argument.prisma:9` is Prisma 7 source (`dbgenerated(expression: "a")`), read by the Prisma 7 reader.

The hand-written policy fixtures contain `\"` escapes (for example `"\"userId\"::uuid = auth.uid()"`). In a backtick literal these become `` sql`"userId"::uuid = auth.uid()` ``. The canonical body, and therefore `contract.json`, does not change.

### 1.3 Committed TypeScript contract sources

| File | Emitted by | Places and counts |
| --- | --- | --- |
| `test/integration/test/authoring/parity/rls/contract.ts` | Parity pair; `emit:authoring` rewrites `expected.contract.json`. | Line 18: `const ownerPredicate = '"userId"::uuid = auth.uid()'`. `using:` 7 (41, 43, 47, 58, 63, 69, 71). `withCheck:` 3 (48, 53, 64). This mirrors `schema.prisma` one to one. |
| `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/contract-expression-authored.ts` | Loaded by `expression-index-migration.e2e.test.ts:194` (`swapContract`). | `constraints.index({ expression })`: 2 (16, 26). `where:`: 1 (22). |
| `test/integration/test/sql-builder/fixtures/contract.ts` | `test/integration/scripts/emit-fixture-configs.mjs`, part of `integration-tests` `emit`, rewrites `test/sql-builder/fixtures/generated/contract.{json,d.ts}` from `prisma.config.ts`. | `fullTextIndex(cols.body, { where: 'post_id = 1', … })`: 1 (53). `contract-no-pgvector.ts` has none. |

No `examples/**/contract.ts` passes strings to any of the places. `examples/prisma-8-demo/prisma/contract.ts:72` calls `fullTextIndex` without `where`, and `examples/paradedb-demo/prisma/contract.ts:24` calls `index` without `where` or `expression`. No committed `contract.ts` uses `check({ expression })`.

### 1.4 Test assertions that pin the `contract infer` output

These are test code, not fixtures, but they fail as soon as the printers emit `sql` literals:

- `test/integration/test/cli-journeys/infer-roundtrip-fidelity.e2e.test.ts`: lines 367, 384, 402 (`@@index(expression: "…")` and `where: "…"`), 440 (`using = "(id = 1)"`), 459 (`withCheck = "(id = 2)"`).
- `test/integration/test/cli-journeys/infer-roundtrip-fidelity.hand-written-check.e2e.test.ts:61`: regex `/@@check\(expression: "\(cardinality\(tags\) > 0\)", …/`. The comment at line 21 also shows the old form.
- `test/integration/test/cli-journeys/sign-the-database.e2e.test.ts`: lines 123, 126, 129, 195, 196.
- `test/integration/test/cli-journeys/expression-index-migration.e2e.test.ts:7`: a doc comment in the old form.

For planning, these test files contain inline PSL with plain-string SQL. The number is the count of matching lines:

- `packages/3-targets/3-targets/postgres/test/psl-rls-operations.test.ts` 24
- `psl-policy-map-authoring.test.ts` 21
- `contract-psl/test/interpreter.check-attribute.test.ts` 12
- `test/integration/test/authoring/parity/ts-psl-rls-parity.test.ts` 10
- `psl-rls-authoring.test.ts` 6
- `psl-printer/test/declarative-policy-select.round-trip.test.ts` 6
- `psl-printer/test/generic-extension-block-printer.test.ts` 5
- `postgres adapter test/migrations/rls-lifecycle-e2e.integration.test.ts` 4
- `psl-infer/infer-psl-contract.test.ts` 4
- `interpreter.index-naming.test.ts` 4
- `rls-migration-plan.integration.test.ts` 3
- `infer-policy-emission.test.ts` 3
- `psl-full-text-index.test.ts` 3
- `psl-policy-authoring.test.ts` 2
- `print-psl.check.test.ts` 2
- `contract-psl/test/ts-psl-parity.test.ts` 2
- `interpreter.diagnostics.test.ts` 2
- `language-server/test/completion-provider.test.ts` 2
- 1 each in:
  - `rls-walking-skeleton-psl.integration.test.ts`
  - `full-text-index-planning.test.ts`
  - `interpreter.unknown-attributes.test.ts`
  - `interpreter.model-attribute-indexes.test.ts`
  - `psl-printer/test/fixtures/declarative-policy-select-extension.ts`
  - `psl-parser/test/symbol-table.test.ts`

`pg.sql` and `sqlite.sql` in core tests and sources are listed in the appendix.

## 2. How `pnpm fixtures:check` works

Root `package.json`:

```text
"fixtures:emit": DATABASE_URL=… pnpm -r --filter='./examples/*' --filter='./apps/*' --filter='@internal/sql-builder' --filter='@internal/sql-orm-client' --filter='@internal/postgres' --filter='@internal/extension-supabase' --filter='e2e-tests' --filter='integration-tests' run --if-present emit
              && DATABASE_URL=… pnpm -r --filter='./packages/3-extensions/*' run --if-present build:contract-space
              && pnpm migrations:regen && pnpm migrations:regen:examples
"fixtures:check": pnpm fixtures:emit && git diff --exit-code -- ':(glob)**/contract.*' ':(glob)**/expected.contract.json'
```

What it rebuilds that matters here:

- `examples/supabase` `emit` (`prisma contract emit`): rewrites `examples/supabase/src/contract.{json,d.ts}` from the hand-written `src/contract.prisma`.
- `@internal/extension-supabase` `emit`: rewrites `test/fixtures/{example-app,no-policy,renamed-policy}/contract.{json,d.ts}`.
- `@internal/extension-supabase` `build:contract-space` (`prisma contract emit` with the pack's `prisma.config.ts`): rewrites `src/contract/contract.{json,d.ts}` from the committed `src/contract/contract.prisma`. It does not run `contract:generate`.
- `integration-tests` `emit` does three things:
  - Emits the listed configs.
  - Runs `scripts/emit-fixture-configs.mjs`, which re-emits every `prisma.config.ts` under `test/ports`, `test/enum-order-by` and `test/sql-builder/fixtures` that has a committed `generated/` sibling. This includes the sql-builder fixture with the `fullTextIndex` `where`.
  - Runs `emit:authoring` = `UPDATE_AUTHORING_PARITY_EXPECTED=1 UPDATE_SIDE_BY_SIDE_CONTRACTS=1 vitest run test/authoring/cli.emit-parity-fixtures.test.ts test/authoring/side-by-side-contracts.test.ts && biome format --write test/authoring/parity test/authoring/side-by-side`. For each parity case this loads both `contract.ts` and `schema.prisma`, asserts that both give equal contracts and hashes, and writes `expected.contract.json`. This covers the `rls` and `default-sql-literal` cases.
- `@internal/sql-builder` and `@internal/postgres` `emit`: re-emit `test/sql-builder/fixtures/prisma.config.no-pgvector.ts` and copy the result. That contract has no raw SQL places.
- `build:contract-space` also runs on `@internal/extension-paradedb`, `@internal/extension-pgvector` and `@internal/extension-postgis`. None of their contracts contains a place.
- `migrations:regen` (`scripts/regen-extension-migrations.mjs`) re-pins extension migration heads for paradedb, pgvector and postgis. Supabase has no `migrations/` directory.
- `migrations:regen:examples` (`scripts/regen-example-migrations.mjs`) re-emits each example migration's `contract.prisma` into `migrations/snapshots/<hex>/contract.*`, then runs `tsx migration.ts` to rewrite `ops.json` and `migration.json`. It never calls the planner.

What it compares: only files named `contract.*` and `expected.contract.json`. The glob also matches `contract.prisma` and `contract.ts`, but nothing in `fixtures:emit` writes those. `ops.json`, `migration.json` and `migration.ts` are not compared (`docs/onboarding/fixtures-emit-and-check.md`).

What it does not cover:

- The CLI journey fixtures in 1.2 and 1.3. They are inputs to `pnpm test:integration`, which includes `test/cli-journeys/**` through `test/integration/vitest.config.ts:54`.
- The formatter fixture.
- The Supabase pack's `contract.prisma`, which only `contract:generate` rewrites.

CI runs it in the `fixtures` job (`.github/workflows/ci.yml:165`). `pnpm fixtures:check:agent` is the logged variant. The project DoD says "`fixtures:check` shows no `contract.json` change for any existing fixture". The places whose output must stay byte-identical are the Supabase pack contract, the three Supabase test fixtures, the example, both parity `expected.contract.json` files, and `test/sql-builder/fixtures/generated/contract.json`.

A pre-existing staleness, unrelated to this project: `docs/onboarding/fixtures-emit-and-check.md:9` lists the `emit` packages without `@internal/postgres` and `@internal/extension-supabase`.

## 3. Docs to change

Do not edit historical records. The following describe past releases and stay as they are:

- `CHANGELOG.md:318, 381`
- `docs/releases/v8.0.0-rc.2.md:58, 121`
- `skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.1-to-8.0.0-rc.2/instructions.md:26, 186, 504`
- `skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.1-to-8.0.0-rc.2/instructions.md:75, 639`

### 3.1 ADRs (`docs/architecture docs/adrs/`)

ADR 129, `ADR 129 - Template-Tagged Literals for Extensions.md` (amend):

| Line | What needs to change |
| --- | --- |
| 16 | "The Postgres target reads the `sql` tag, checks the body is one expression" → the `sql` tag produces a `sql/expression` value, and `@default` stores it and runs its own checks. |
| 22 | TS form: add that the tag returns a `sql/expression` value. |
| 26 | "handed to the pack that registered the tag, which decides what the literal lowers to" → the tag names a data type and the entry parses the body into its value. |
| 28 | "Index expressions, check-constraint bodies, and row-level-security predicates continue to take plain strings; whether they move to tagged literals is a separate decision." → state this project's decision: every place takes a `sql` literal and plain strings are refused. |
| 34 | The rationale for a plain string at `@default`: extend it to all places. |
| 42 | Uses `pg.sql` as the example of a dotted tag. Change it to `postgis.geometry`. |
| 46 | "An attribute accepts it only where its argument specification says so" → through the new building block that names a data type. |
| 70 | The TS tag: returns a `sql/expression` value, and the builder fields that take raw SQL accept only that value. |
| 74 | "a tag that lowers its own body sits under a reserved key with a `lower` function" → remove. `sql` is the authoring entry of `sql/expression`. |
| 78 | "`sql` is registered by Postgres and by SQLite, through one implementation the SQL family exports" → the SQL family names the id `sql/expression` and exports its implementation, and each target registers it. |
| 79 | "Each target also registers a prefixed alias: `pg.sql` … `sqlite.sql`" → delete, with the reason (decision 5). |
| 82 | "checked when the default is lowered" → checked at every place. |
| 84–91 | "What a tag lowers to" (`lower` function; the two checks "in PSL and TypeScript alike") → `@default` stores a `sql/expression` value as a function default. The checks belong to `@default` in PSL and to `.default()` in TS, not to the tag. The other places check nothing. |
| 104 | `contract infer` prints raw defaults as `sql` literals → it prints every place that way (decision 8). |
| 110 | The rejected alternative "Keep raw SQL as a plain string argument" now covers every place. |
| 120 | The rejected alternative "The SQL family, not each target, registers the unprefixed `sql` tag": reconcile it with the family naming the id while targets register it. |
| 128 | The reference to ADR 234/244 stays. |

ADR 254, `ADR 254 - Data types and casts.md` (amend):

| Line | What needs to change |
| --- | --- |
| 5 | "Built so far" / follow-up list. The building block that types value positions now exists (built for raw SQL only), and block parameters are typed by data type. |
| 77 | "No type spans targets, and no family registers types." → add the case of a family naming an id that targets register (`sql/expression`). |
| 139 | Tag paragraph: `sql` is the tag of `sql/expression`, registered by each SQL target. |
| 143 | Paragraph about the lowering entry and `pg.sql`/`sqlite.sql` → replace it: `sql/expression` is a data type that declares no casts. |
| 145 | "The language server takes tag completion … So does `contract infer`" → both now also cover every SQL place. |
| 151 | The rule for a literal: a plain string at a `sql/expression` place is refused by the cast rule. Name the code and message. |
| 155 | "Value positions … are typed through the attribute specification with one combinator that names a data type" → now built. Block parameters are typed the same way. |
| 160 | "a `sql` tag lowers" → it parses to a `sql/expression` value, and `@default` stores that value as an expression. |
| 180 | Printing: infer prints every SQL place through `sql/expression`'s `print`. |
| 207 | The rejected "family-level vocabulary of written types": explain why `sql/expression` is not that (it has no casts). |
| 225 | Related: "`sql` is the one lowering tag" → update. |

`docs/architecture docs/ADR-INDEX.md`:

- Line 39 (ADR 254 row): "`sql` is the one lowering tag" → update.
- Line 136 (ADR 129 row): "only the target unprefixed (`sql`, `pg.sql`, `sqlite.sql`); `` @default(sql`...`) `` lowers to …" → drop the prefixed tags and mention every place.

ADR 126, `ADR 126 - PSL top-level block SPI.md` (block parameters move from codec ids to data types):

| Line | What needs to change |
| --- | --- |
| 19 | `using  = "auth.uid() = author_id"  // value → a codec-typed literal` → `` using = sql`auth.uid() = author_id` `` with a comment about the data type. |
| 37 | `using: { kind: 'value', codecId: 'String', required: true }` → declares data type `sql/expression`. The field name follows the core design. |
| 46 | "a body of `x = y` assignments and double-quoted values" → values of any written form. |
| 57 | Table row "`value` … a codec-typed value — the codec owns its representation" → a value of a declared data type, admitted by the cast rule. |
| 61 | Paragraph "`value` rides the codec JSON medium … names a `codecId`" → rewrite for data types. |
| 71 | "Validate … a `value` the codec's `decodeJson` rejects" → a value whose type has no cast into the declared type, or that the entry's parse refuses. |

ADR 225 (`ADR 225 - Three-layer extensibility for pack-contributed entity kinds.md:61`) only names `ref`/`value`/`option`/`list` and defers to ADR 126. It needs no change unless the `value` kind is renamed.

Example updates only:

- ADR 234, `ADR 234 - Content-addressed wire names for Postgres-normalized objects.md`: line 29–30 (TS `using: '"userId"::uuid = auth.uid()'`, `withCheck: …`), line 40–41 (PSL `using = "\"userId\"…"`, `withCheck = …`), line 129 (TS `using: 'true'`), line 137 (PSL `using = "true"`).
- ADR 236, `ADR 236 - Target-contributed model attributes.md:26`: PSL `using = "\"userId\"::uuid = auth.uid()"`.
- ADR 243, `ADR 243 - Name-identified indexes and exact-name adoption.md:48, 71`: `@@index(expression: "eql_v3.eq_term(email)", …)`. Lines 13 and 15 use the shortened forms `@@index(expression: …, unique: true)` and `@@check(expression, name:)`. Optionally write them as `` sql`…` ``.
- ADR 244, `ADR 244 - Check constraints are opaque wire-named expressions.md`: it has no quoted-string PSL example. Line 152 uses the shortened forms `@@check(expression: …, name: "…")` and `check({ expression, name })`. Optionally write `` sql`…` ``. Lines 129, 131 and 185 are prose and need no change. The spec lists ADR 244 for example updates, but there is nothing to rewrite beyond line 152.
- ADR 195 (`ADR 195 - Planner IR with two renderers.md`): no plain-string examples. Whether it records the embedded-SQL DDL node (spec requirement 7) is a design question. The spec's ADR pointer does not name a home for requirement 7.
- ADR 231 (`ADR 231 - Declarative attribute specifications.md:131-175`, "The combinator kit"): lists the combinators. It lists neither `taggedLiteral` nor the new building block that names a data type. Add the new one here, or say where it is documented.
- ADR 167 line 5: accurate as it is.

### 3.2 Subsystem docs (`docs/architecture docs/subsystems/`)

- `6. Ecosystem Extensions & Packs.md:639` uses `definition: pg.sql\`` and line 648 uses `@@index([status], where: pg.predicate\`status <> 'archived'\`)`. Change both to `sql`. Lines 630–633 describe tags as `<pack>[.<flavor>]` and packs returning "deterministic JSON"; this is an older design and can optionally be aligned.
- `5. Adapters & Targets.md:299-300`: the RLS authoring and equivalence text has no code. Optionally add that predicates are `sql` literals.
- `1. Data Contract.md:583` uses a hypothetical decorator `@@pg.predicate("active = true")`. Optional.
- `2. Contract Emitter & Types.md:311` ("tagged literal handlers") and `7. Migration System.md` have no affected text.

### 3.3 Reference docs (`docs/reference/`)

`error-reference.md` (see section 5 for the format):

- Line 276–278 `CONTRACT.DEFAULT_INVALID` says the TS `sql` tag raises `reserved-function` and `unsafe-sql` → under decision 7, `.default()` raises these. The tag keeps only the canonicalization failures (`reason`, `offset`).
- Line 598–600 `PSL_UNKNOWN_DEFAULT_LITERAL_TAG`: "A `@default` tagged literal …" and "Postgres also registers `pg.sql` and SQLite `sqlite.sql`" → every place, with no prefixed tags.
- Line 602–608 `PSL_DEFAULT_TYPE_INCOMPATIBLE`: currently says "A written `@default` value …". If this code reports a plain string at a SQL place, extend it to attribute arguments and block parameters, with the message that says to write `` sql`...` ``.
- Line 610–612 `PSL_INVALID_DEFAULT_LITERAL`: `@default`-only wording.
- Line 618–624 `PSL_TAGGED_LITERAL_NUL` and `PSL_TAGGED_LITERAL_TOO_LARGE`: "Reported at the literal when the default is lowered" → at every place.
- Line 630–632 `PSL_INVALID_DEFAULT_SQL`: "The message names the tag as written (`sql`, `pg.sql` or `sqlite.sql`)" → `sql` only. It stays `@default`-only.
- `PSL_EXTENSION_INVALID_VALUE` (raised by `framework-components/src/control/psl-extension-block-validator.ts:192,204,218`) and `PSL_INVALID_ATTRIBUTE_ARGUMENT` have no entries today. If either reports a refused plain string, it needs one.

`psl-editor-tooling-tagged-literals.md`:

| Line | What needs to change |
| --- | --- |
| 1, 3 | Title and intro say "tagged literal defaults" → every place. |
| 11 | `taggedLiteral(tags, …)` combinator and the `@default` arms → the new building block and its place in each spec. |
| 13 | "Every SQL target registers `json` and `sql`; Postgres adds `pg.sql` and SQLite adds `sqlite.sql`" and the lowering description → remove the prefixed tags. `sql` is the entry of `sql/expression`. |
| 19 | Completion "inside `@default(`" → in every place (spec requirement 6). |
| 21 | Span checks → add the new refusal. |
| 23 | Hover: still not done (non-goal). No change beyond scope. |
| 31 | "Inject SQL highlighting inside `sql`, `pg.sql`, and `sqlite.sql` fences" → `sql` only. |
| 39–41 | Test list: add the new tests and fixtures. |
| 45 | "What is not done": keep it consistent. |

Other reference docs:

- `docs/README.md:30`: link text "PSL editor tooling for tagged literal defaults" → drop "defaults".
- `codec-authoring-guide.md:447-479` ("Giving a type PSL support"): accurate as it is. Optionally note a type whose authoring entry is a tag with no casts (`sql/expression`) and that a family may name an id targets register.

### 3.4 Package READMEs

`packages/2-sql/2-authoring/contract-psl/README.md`:

- Line 60: "raw SQL as a `sql` tagged literal".
- Line 62: "`sql` is registered by every SQL target; `pg.sql` (Postgres) and `sqlite.sql` (SQLite) are target-prefixed spellings of the same tag. An unregistered tag is … reported when the default is lowered" → drop the prefixed tags.
- Lines 92–94: `@@index([email], where: "(archived_at IS NULL)", …)`, `@@index(expression: "eql_v3.eq_term(email)", …)`, `@@index(expression: "lower(email)", …)` → `sql` literals.
- Line 98: "`expression:` (the whole CREATE INDEX element list as one opaque string)" → one `sql` literal.
- Line 101: "`where:` is a partial-index predicate" → a `sql` literal.
- The README has no `@@check`, `@@fullTextIndex` or policy section. Add a sentence that all places take `sql` literals.

`packages/2-sql/2-authoring/contract-ts/README.md`:

- Line 64: "As in PSL, `` sql`now()` `` and `` sql`autoincrement()` `` are refused with `CONTRACT.DEFAULT_INVALID`" → `.default()` now refuses them, not the tag. State that the tag returns a `sql/expression` value.
- Lines 241–242: `constraints.index([cols.email], { …, where: '(archived_at IS NULL)', … })` and `constraints.index({ expression: 'eql_v3.eq_term(email)', … })` → `sql` template literals.
- Line 246: "The expression is the whole CREATE INDEX element list as one opaque string".
- Line 248: the deferred `{ fields, render }` form, whose `render` returns a string. Design question for the core plan: does `render` return a `sql/expression` value? Update the text to match.

Other READMEs:

- `packages/3-targets/3-targets/postgres/README.md:167`: `@@index(expression: "to_tsvector('english', \"text\")", type: "gin", name: …)` → `` sql`to_tsvector('english', "text")` ``. The optional `where:` of `@@fullTextIndex` on the same line takes a `sql` literal.
- `packages/3-extensions/supabase/README.md:117` and `examples/supabase/README.md:9`: prose only, no change. Line 117 mentions a `.rls([...])` stage, which looks stale but is unrelated.
- `packages/1-framework/3-tooling/language-server/README.md` and `psl-parser/README.md` have nothing affected.

### 3.5 Skills

`skills/prisma-8/references/contract.md`:

- Line 120: "`@@index` also accepts `expression:` … `where:`".
- Line 123: `@@index(expression: "lower(email)", …)`.
- Line 124: `@@index([authorId], where: "(archived_at IS NULL)", …)`.
- Line 134: `@@fullTextIndex([text], where: "archived_at IS NULL", …)`.
- Line 137: TS `fullTextIndex` prose.
- Line 313: `@@check(expression: "total > 0", name: …)`.
- Line 315: "`expression` is the raw predicate".
- Line 322: TS `check({ expression, name })` prose; show `` sql`…` ``.
- Line 415: infer captures `where:`. Fine, but infer now prints `sql` literals.

`skills/prisma-8/references/queries-postgres.md`:

- Line 90: `@@fullTextIndex([text], where: "archived_at IS NULL", …)`.

`skills/prisma-8/references/supabase.md`:

- Lines 72, 79, 87–88: policy examples with `using = "\"userId\"::uuid = auth.uid()"`, `using = "true"` and `withCheck = …`.
- Line 97: block body prose.
- Line 99: "Predicates are verbatim SQL strings. Quote camelCase column names inside them (`\"userId\"`)" → `sql` literals with no escaping.
- Line 100: the TS builder parity text should show `` sql`…` ``.

`skills/prisma-8/references/quickstart.md`:

- Line 222: "comes back as `@@check(expression: <reprint>, map: "<name>")`" → `` @@check(expression: sql`<reprint>`, map: "<name>") ``.

Unchanged skill files:

- `skills/prisma-8/SKILL.md:68` has trigger keywords only. Optionally add `` sql`...` ``.
- `skills/journey-tests/08-supabase-rls.md:15` is a checklist and needs no change.
- The skill does not currently teach `` @default(sql`…`) `` anywhere; this is observed, not required.
- `skills-contrib/**` and `.agents/rules/**` have no hits.
- `packages/0-shared/skills/` does not exist. The PR template's "Skill update" comment points there, but the skill lives at `skills/prisma-8/`.

Scorecards (`scorecard/03-psl-schema-language.md`, `scorecard/15-migrations.md`) have no rows for these places and no plain strings. Rows are optional.

### 3.6 Pending upgrade fragments whose text becomes stale

These fragments are unreleased and will be combined into one guide at release together with this project's fragment. The lifecycle says "Never append to another PR's fragment" (`skills-contrib/record-upgrade-instructions/SKILL.md:39`). Either the new fragment states what supersedes them, or the plan explicitly corrects them. Decide which.

- `upgrade-instructions/pending/data-types-column-defaults/extension/instructions.md`:
  - Lines 248–260 describe the lowering entry: `[loweringEntryKey('sql')]`, `[loweringEntryKey('pg.sql')]`, `loweringEntryKey`, `isLoweringEntryKey`, `isDataTypeLoweringEntry`.
  - Lines 38–48 detection names `isDefaultLiteralTagLoweringEntry`.
  - Line 229 says "A target may register an unprefixed tag".
- `upgrade-instructions/pending/sql-default-literal/extension/instructions.md:27`: says `` sql`now()` `` is "refused, in PSL and in the TypeScript `sql` tag". After decision 7, `.default()` refuses it, not the tag.
- `upgrade-instructions/pending/postgres-full-text-search/app/instructions.md:54` has the TS `fullTextIndex(cols.text, { where: 'archived_at IS NULL', … })`, and line 68 has the PSL `@@index(expression: "to_tsvector(…)", …)`.

## 4. The upgrade-instructions system

### 4.1 `upgrade-instructions/README.md` (required structure)

Directory layout for each fragment (README lines 7–11):

```text
upgrade-instructions/pending/<descriptive-name>/<app|extension>/
  instructions.md
  scripts/...       (optional scripts/assets)
```

Rules (lines 13–19):

- Choose a descriptive name that does not collide with other pending contributions. No random suffix, index or registry.
- A relevant change under `examples/` requires an `app` declaration.
- A change under `packages/3-extensions/` requires an `extension` declaration, subject to the coverage-check exclusions.
- "Each PR must **add its own declaration relative to its actual target branch**". Inherited fragments do not count. Both audiences need separate declarations.
- Keep the YAML frontmatter `changes[]` and the Markdown prose, with optional `detection` and relative `script` references. A no-op declaration is `changes: []` with no prose.
- Do not predict a release number or edit shared transition guides on feature PRs.

Checks (lines 36–44): `pnpm check:upgrade-coverage` reads committed Git trees, so commit first. It has three modes, `pr`, `publish` and `dev`; see 4.4.

### 4.2 Example: `upgrade-instructions/pending/data-types-column-defaults/`

Files:

- `app/instructions.md` (172 lines)
- `extension/instructions.md` (357 lines)
- No scripts.

`app/instructions.md` frontmatter, first entry verbatim:

```yaml
---
changes:
  - id: a-json-default-is-a-json-tag
    summary: |
      A `Json` or `Jsonb` column's default is written ``@default(json`{ "a": 1 }`)``. A quoted
      string is refused: `pg/jsonb` casts from `pg/json`, not from `pg/text`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(Jsonb|Json)(\[\])?\??([ \t]+@[\w.]+(\([^)\n]*\))?)*?[ \t]+@default\([\s\[]*"'
```

The remaining app entries have the same shape. Each has `id`, `summary`, and `detection` with a `glob` plus either `matches` (regex list) or `contains` (substring list):

- `a-decimal-default-is-written-unquoted`
- `a-float-non-finite-default-is-written-bare`
- `a-json-list-default-is-one-json-literal`
- `infer-prints-a-literal-where-it-printed-dbgenerated` (uses `contains: ["dbgenerated("]`)
- `number-valued-64-bit-columns-store-their-default-as-digit-text` (uses `glob: "**/contract.json"`)

The frontmatter closes at line 55.

Body headings: one `## \`<id>\`` per change, in the same order:

- line 57 `## \`a-json-default-is-a-json-tag\``
- line 84 `## \`a-decimal-default-is-written-unquoted\``
- line 100 `## \`a-float-non-finite-default-is-written-bare\``
- line 111 `## \`a-json-list-default-is-one-json-literal\``
- line 128 `## \`infer-prints-a-literal-where-it-printed-dbgenerated\``
- line 144 `## \`number-valued-64-bit-columns-store-their-default-as-digit-text\``

Each section quotes the new diagnostic message in a `text` block, then gives a "Before | After" table.

`extension/instructions.md` frontmatter: 9 entries, all `detection.glob: "**/*.{ts,mts,cts}"` with `matches` regexes on symbol names. Entries and their body headings:

| Entry id | Body heading line |
| --- | --- |
| `every-codec-descriptor-names-a-data-type` | 85 |
| `a-pack-registers-its-data-types` | 114 |
| `casts-replace-accepted-shape-handling` | 147 |
| `decode-json-takes-only-the-canonical-form` | 183 |
| `the-authoring-entry-replaces-the-tag-registry-entry` | 204 |
| `map-default-takes-data-types` | 266 |
| `psl-and-numeral-helpers-live-in-relational-core` | 299 |
| `the-postgres-target-exposes-its-data-types` | 317 |
| `a-target-adapted-codec-extends-the-template` | 331 |

The frontmatter closes at line 83.

Close precedents for this project:

- `upgrade-instructions/pending/remove-dbgenerated/{app,extension}/` covers removing a PSL syntax. It uses a `**/*.prisma` `contains` detection and a rewrite table.
- `upgrade-instructions/pending/supabase-contract-regenerated/extension/` covers regenerating the Supabase pack contract.

### 4.3 The `record-upgrade-instructions` skill

`skills-contrib/record-upgrade-instructions/SKILL.md` (144 lines). Required steps:

1. Identify the affected audiences from `git diff <base>..<head> -- examples/ packages/3-extensions/`. `examples/` → `app`; `packages/3-extensions/` → `extension`; both → both, recorded independently.
2. Add `upgrade-instructions/pending/<descriptive-name>/<audience>/instructions.md` for each audience. Never append to another PR's fragment.
3. Write YAML `changes[]` entries, each with:
   - a kebab-case `id`
   - a one-line `summary`
   - an optional `detection` (a glob and a content predicate)
   - an optional `script`, relative to the fragment

   Make each detection predicate match only the exact token: test it against a true positive and against the nearest false positive, using token-boundary lookbehinds (lines 42–51). Describe only what the consumer must do. If there is no action, write `changes: []` with no prose.
4. Optionally add colocated scripts: no network, no environment variables, no cross-audience imports. Copy a script into both audiences if both need it.
5. Validate by execution (lines 73–128). Start from `<head>` and run `git restore --source=<base> -- examples/` (or `packages/3-extensions/`). Apply the fragment's scripts and prose. Then check three things:
   - `git status --porcelain -- <dir> ':(exclude)<dir>/*/test/**'` must print nothing.
   - Test directories must still equal `<base>` (`git diff --exit-code <base> -- '<dir>/*/test/**'` and no untracked test files).
   - The matching tests pass: `pnpm --filter <example> test`, or `pnpm test --filter='./packages/3-extensions/*'`.

   Do this in a disposable checkout.
6. Commit, then run `pnpm check:upgrade-coverage --mode pr --prev <base> --head <head>`. Link each new fragment directory in the PR description.

Out of scope for fragments: the general bump, install and validate loop. The published `skills/prisma-8/references/upgrade-app.md` and `upgrade-extension.md` own it.

### 4.4 `pnpm check:upgrade-coverage`

`scripts/check-upgrade-coverage.mjs` (347 lines).

What it checks:

- **`pr` mode without a version bump.** For each covered directory (`examples/` → `app`, `packages/3-extensions/` → `extension`), it collects the changed paths that matter. If any exist, the PR must add a new `upgrade-instructions/pending/<name>/<audience>/instructions.md` that is absent at `--prev` (rule `per-pr-declaration`). A change does not count if any of these is true:
  - It is test infrastructure (`isTestInfrastructurePath`: any path segment `test/` or `tests/`, `*.test.*`, `*.spec.*`, `vitest.config.*` or `coverage.config.json`).
  - It is a `package.json` change that only touches versions or scripts.
  - It is a biome config change to `$schema` only.
  - It is a `contract.json` or `contract.d.ts` that is equal after blanking extension version stamps.
- **Every declaration.** It must have parseable frontmatter with a `changes` array (rule `instructions-format`). Each `script` must point to a regular file inside the same directory (rule `script-reference`).
- **A release bump in `pr` mode, or `publish` mode.** Every pending file is a violation (`pending-release`), and the assembled guides at `skills/prisma-8/upgrading/<audience>/upgrades/<transition>/instructions.md` must exist.
- **`dev` mode.** Validates format only.

Consequences for this project:

- The PSL slice edits `examples/supabase/src/contract.prisma`, which needs an `app` declaration.
- It edits `packages/3-extensions/supabase/src/contract/contract.prisma`, which needs an `extension` declaration.
- Any `src` change in `packages/3-extensions/postgres/` (policy builders in `src/contract/rls.ts`) or `packages/3-extensions/sqlite/` also needs an `extension` declaration.
- Changes to `packages/3-extensions/*/test/**` do not count.
- A stacked or later slice needs its own new declaration.

How CI runs it: `.github/workflows/ci.yml:133-137`, in the Lint job:

```text
pnpm check:upgrade-coverage --mode pr --prev "$BASE_SHA" --head "$HEAD_SHA"
```

where `BASE_SHA = pull_request.base.sha || merge_group.base_sha` and `HEAD_SHA = merge_group.head_sha || github.sha`. The publish workflow runs it at `.github/workflows/publish.yml:139` with `--mode "$MODE"`.

## 5. The error reference and diagnostic-code checks

Format of `docs/reference/error-reference.md` (1467 lines):

- An intro (lines 1–15), then a namespace table (lines 17–32).
- One `## <NAMESPACE>` section per namespace (the PSL section starts at line 496).
- One `### <CODE>` heading per code. The code is the anchor: the hosted page anchors each code as `#<CODE>`.
- Each entry is prose covering:
  - what triggers the code
  - the exact message in backticks, with `<placeholders>`
  - where it is reported ("Reported at the literal" / "at the `@default` attribute")
  - for structured errors, `Payload: …` or `Meta: …`
- Underscore diagnostic codes (`PSL_*`) sit in the `## PSL` section after the dotted `PSL.PRISMA7_*` codes (lines 594–632). They have no payload line.

The four entries, verbatim:

- `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` (lines 598–600): "A `@default` tagged literal uses a tag no pack in the stack registered: `Unknown literal tag "<tag>". Known tags: <tags in registration order>.` Every SQL target registers `sql`; Postgres also registers `pg.sql` and SQLite `sqlite.sql`. Reported at the literal when the default is lowered."
- `PSL_DEFAULT_TYPE_INCOMPATIBLE` (lines 602–608): "A written `@default` value has a data type the column's type neither is nor casts from: `Field "<Model>.<field>": <column type> has no cast from <value type>; it casts from <types>`, or `; it casts from nothing` when the column's type declares no cast at all. …" The second paragraph reads "The same code reports a written form this target has no data type for at all: `Field "<Model>.<field>"[ at element <n>]: this target has no data type for a <string|boolean|number> value` …". It ends: "Reported at the `@default` attribute. See ADR 254."
- `PSL_INVALID_DEFAULT_LITERAL` (lines 610–612): "A written `@default` value that whatever read it refused: the authoring entry's parse, a cast, or the column's codec. … The message is `Field "<Model>.<field>": <the message of whatever refused it>` … Reported at the `@default` attribute. See ADR 254."
- `PSL_INVALID_DEFAULT_SQL` (lines 630–632): "A `` @default(sql`...`) `` body fails the SQL family's body check: `Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.` … or is exactly `now()` or `autoincrement()`: `` Write @default(now()) instead of sql`now()`; now() is a Prisma default function, not raw SQL. `` The message names the tag as written (`sql`, `pg.sql` or `sqlite.sql`). Reported at the literal."

Related entries that also change are listed in 3.3: `CONTRACT.DEFAULT_INVALID` (276–278), `PSL_TAGGED_LITERAL_NUL` and `PSL_TAGGED_LITERAL_TOO_LARGE` (618–624), and `CONTRACT.DEFAULT_SQL_INTERPOLATION` (280–282, which stays the tag's).

Checks that exist:

- **`pnpm check:error-reference`** = `node scripts/list-error-codes.mjs --verify docs/reference/error-reference.md`. CI runs it at `ci.yml:138-139`.
  - It scans git-tracked `packages/**/*.ts` files under `/src/`, excluding tests. It collects single-quoted strings that match `'(CONFIG|CLI|CONTRACT|PSL|PLAN|RUNTIME|ORM|DRIVER|BUDGET|LINT|MIGRATION|SUPABASE|POSTGIS|PGVECTOR|PARADEDB|TESTKIT)\.[A-Z][A-Z0-9_]*'`.
  - It fails if the page does not contain a collected code as a substring.
  - It covers only dotted codes. Underscore `PSL_*` codes are not checked: 109 distinct `PSL_*` codes appear in `src`, and 9 have entries. A new or reworded underscore code is documented by convention only. A new dotted code, such as a `CONTRACT.*` code raised by `.default()` or by a builder, must be added or CI fails.
- **`pnpm lint:docs`** = `node scripts/validate-package-readmes.mjs`. It checks only that every package directory with `src/` has a `README.md`; a missing title or `## Responsibilities` section produces a warning. It does not look at diagnostics.
- **`pnpm lint:throws`** = `node scripts/lint-throws.mjs`. This is a ratchet on bare `throw new Error(...)`.
  - It counts `no-bare-throw:` diagnostics from the Biome plugin at `HEAD` and at `git merge-base origin/main HEAD`. It builds the merge-base copy in a temporary `git worktree` under the OS temp directory.
  - It fails when the count rises, and lists the new sites.
  - It needs `origin/main`, and skips when `HEAD` equals the merge-base.
  - Plugin fixtures, `scripts/*.{mjs,ts}` and `skills/**/upgrades/` are not counted.
  - Use `structuredError(...)` for user-facing errors, and `InternalError` or `assertNever` for bugs.
  - It has nothing to do with documenting codes.

## 6. CI-only checks: how to run them locally

Both are in the CI Lint job (`.github/workflows/ci.yml:121` and `:137`). `pnpm lint:agent` runs `turbo run lint` (Biome per package) and does not include either check.

```bash
git fetch --no-tags origin main:refs/remotes/origin/main   # both need origin/main
pnpm lint:throws
git commit ...                                            # coverage reads committed trees only
pnpm check:upgrade-coverage --mode pr --prev "$(git merge-base origin/main HEAD)" --head HEAD
pnpm check:error-reference                                 # also Lint-job-only, cheap
```

Other Lint-job steps not covered by `lint:agent`:

- `lint:deps`, `lint:code`, `lint:rules`, `lint:rules:symlinks`, `lint:skills`, `lint:rules:footprint`, `lint:docs`
- `lint:manifests`, `lint:workflows`, `test:scripts`, `lint:casts`, `lint:framework-vocabulary`
- `lint:consumer-internal-imports`, `lint:legacy-name`, `lint:vitest-timeouts`, `lint:publishability`
- `check:release-notes --mode pr` (lines 71–143)

`pnpm fixtures:check` is a separate CI job (`ci.yml:145-165`).

## 7. Release notes, CHANGELOG, and PR conventions

### 7.1 Release notes and CHANGELOG

A feature PR writes no release notes and no CHANGELOG entry.

- `docs/releases/v<version>.md` is written only on a release PR. The `draft-release-notes` skill drafts it from the merged PRs while `publish-npm-version` runs.
- `CHANGELOG.md` gets a mirrored `## v<version>` entry at the same time.
- `pnpm check:release-notes --mode pr` (`scripts/check-release-notes.mjs`, `ci.yml:143`) does nothing unless the PR changes the root `package.json` `version`.

A feature PR contributes only its upgrade fragment. The release notes later link the assembled guides.

What the release notes expect of breaking changes (`docs/releases/README.md`):

- Breaking changes come first.
- Say what the reader must do.
- Nest a short before/after snippet. Lead with PSL for authoring-surface changes, and take it from the upgrade recipe.
- Link PRs as absolute links.
- Link the recipes as tag-pinned URLs: `https://github.com/prisma/orm/blob/v<version>/skills/prisma-8/upgrading/{app,extension}/upgrades/<transition-label>/`.

The section order is Breaking changes → Features → Fixes → New contributors. A fragment's before/after tables are therefore the source for the release-note example.

### 7.2 PR conventions: the sources disagree on the title

- `drive/pr/README.md:29-38`: a conventional-commit prefix (`feat:`/`fix:`/…), the Linear id as a `(TML-NNNN)` suffix or a `Refs: TML-NNNN` line, and a one-line imperative summary. Example: `feat(sql): add returning() to insert operations (TML-2549)`.
- `skills-contrib/create-pr/SKILL.md:42-64,190` and the PR template checklist (`.github/PULL_REQUEST_TEMPLATE.md:40`): `TML-NNNN: <sentence-case title>`. The skill says: "Don't use the conventional-commit `type(scope):` title format — that's the old format." `drive/calibration/dod.md` PR-side items also ask for a "Linear ticket prefix (e.g. `tml-XXXX:`)".
- The merged titles on `main` are plain sentences with `(#PR)` (for example `constraints.unique and constraints.id keep their names literal … (#30387)`) because squash merges rewrite them.

The prefix form `TML-3282: …` agrees with the template, the skill and the DoD. `drive/pr/README.md` is the outdated one.

Required body sections:

- The PR template (`.github/PULL_REQUEST_TEMPLATE.md`) requires these headers:
  - `## Linked issue`
  - `## Summary`
  - `## Testing performed`
  - `## Skill update` (describe the skill change, or write "n/a — internal only")
  - `## Checklist` (DCO sign-off, CONTRIBUTING read, tests updated, `TML-NNNN:` title, Skill update filled)
  - `## Notes for the reviewer`
- `create-pr` adds this order (`SKILL.md:74-116`):
  1. `## Linked issue` (`Refs [TML-…](…)`, plus any prerequisite or follow-up PRs)
  2. `## Skill update`
  3. `## At a glance` (real code from the branch)
  4. `## Decision`
  5. `## How it fits together` (3–6 steps)
  6. `## Behavior changes & evidence`
  7. `## Reviewer notes` (placed near the top of the long sections)
  8. `## Compatibility / migration / risk`
  9. `## Verification` / `## Testing performed`
  10. `## Follow-ups`
  11. `## Alternatives considered` (last of the narrative sections)
  12. `## Checklist`
- `drive/pr/README.md:40-47` adds these rules for the full mode:
  - Reference the Linear ticket in the overview.
  - Call out package-layer changes in `## Changes`.
  - Note fixture regeneration so reviewers know the size of the diff comes from regeneration.
  - Do not reference `projects/…` paths in the PR body.
- The record-upgrade-instructions skill asks the PR body to link each new fragment directory.

Other PR rules:

- Every commit carries `Signed-off-by` (DCO); `drive/pr/README.md:62`.
- Every review thread must be resolved before the merge queue proceeds (lines 25–27).
- The Linear state before merge is `Ready to be merged` (lines 93–97).

## Appendix: `pg.sql` / `sqlite.sql` in core sources and tests (for the core-code inventory)

Sources:

- `packages/3-targets/6-adapters/postgres/src/core/data-type-authoring.ts:16`
- `packages/3-targets/6-adapters/sqlite/src/core/data-type-authoring.ts:16`
- `packages/3-targets/3-targets/postgres/src/core/data-type-entries.ts:6` (doc comment)
- `packages/1-framework/2-authoring/psl-parser/src/syntax/ast/expressions.ts:203` (doc comment example)

Tests:

- `psl-parser/test/attribute-spec-combinators.tagged-literal.test.ts:43,48,53,58,74,77`
- `psl-parser/test/parse-tagged-literal.test.ts:54,164`
- `psl-parser/test/tokenizer.test.ts:355`
- `language-server/test/completion-provider.test.ts:1240,1248,1255`
- `contract-psl/test/fixture-data-types.ts:173`
- `contract-psl/test/interpreter.defaults.data-types.test.ts:237,240`
- `contract-psl/test/interpreter.defaults.tagged-literal.test.ts:80,139,142,144,193`
- `contract-psl/test/sql-attribute-specs.test.ts:348`
- `2-sql/9-family/test/sql-default-literal-tag.test.ts:44,49,57,73,74`
- `adapters/postgres/test/control-mutation-defaults.test.ts:343,352,353,370`
- `adapters/postgres/test/data-type-authoring.test.ts:30,59`
- `adapters/sqlite/test/control-mutation-defaults.test.ts:35,44,45,62`
- `adapters/sqlite/test/data-type-authoring.test.ts:31,45`

The parser, tokenizer and formatter tests use `pg.sql` only as an example of a dotted tag and still pass after the removal. The rest assert registration and must change.
