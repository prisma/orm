# Slice C — Delete `dbgenerated`, regenerate the Supabase contract, ship the upgrade instruction

**Project:** [Remove `dbgenerated`](../../spec.md). **Linear:** not yet created. **Branch:** `remove-dbgenerated-delete` off `main`. **Shape:** one PR. **Depends on:** [slice A](../a-sql-default-literal/spec.md) and [slice B](../b-codec-psl-literals/spec.md) both merged to `main`.

## Outcome

`dbgenerated` is gone from Prisma 8. `@default(dbgenerated("x"))` is a hard error whose message names the replacement. `contract infer` never prints it. The Prisma 7 source reads the Prisma 7 language's `dbgenerated` without it. The shipped Supabase contract carries none of the 21 uses. Users with existing contracts have an upgrade instruction. Serhii has a brief for the editor tools.

## Design

### C1. Delete the registry entries

- Postgres [`control-mutation-defaults.ts`](../../../../packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts): delete `dbgeneratedSig`, `lowerDbgenerated`, and the registry entry.
- SQLite [`control-mutation-defaults.ts`](../../../../packages/3-targets/6-adapters/sqlite/src/core/control-mutation-defaults.ts): delete `dbgeneratedSig`, `lowerDbgenerated`, `NOW_SYNONYMS`, and the registry entry. The introspection-side rule in `sqlite/src/core/default-normalizer.ts` that reads `CURRENT_TIMESTAMP` and `datetime('now')` as `now()` stays, and its comment is rewritten to say it exists so a named `now()` default verifies against the database's text (slice A's `sqliteResolveDefault` applies it to both sides).
- Test fixture registry [`contract-psl/test/fixtures.ts`](../../../../packages/2-sql/2-authoring/contract-psl/test/fixtures.ts): delete the entry.
- Registry-order test expectation becomes `['autoincrement', 'now', 'uuid', 'cuid', 'ulid', 'nanoid']`.
- Language-server completion tests: `dbgenerated` removed from the expected list and snippet tests.
- Adapter registry tests: the `dbgenerated` lowering, empty-argument, and verbatim-preservation cases are deleted; the SQLite `now()` canonicalization suite is deleted.

### C2. The removed-function message

File: [`contract-psl/src/default-function-registry.ts`](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts).

When `lowerDefaultFunctionWithRegistry` (or the `oneOf` failure path in `sql-attribute-specs.ts`, whichever produces `PSL_UNKNOWN_DEFAULT_FUNCTION`) meets a call whose name is exactly `dbgenerated`, the diagnostic message is:

`Default function "dbgenerated" was removed. Write the SQL as a tagged literal: @default(sql\`<expression>\`). Supported functions: <existing list>.`

The code stays `PSL_UNKNOWN_DEFAULT_FUNCTION`. The parity fixture `test/integration/test/authoring/diagnostics/invalid-default-arguments/schema.prisma` that used `dbgenerated("")` is rewritten to exercise a different invalid argument (an unknown function name), and a new diagnostics fixture `removed-dbgenerated` asserts the message above.

### C3. Prisma 7 source

File: [`contract-prisma7/src/defaults.ts`](../../../../packages/2-sql/2-authoring/contract-prisma7/src/defaults.ts).

- Remove `dbgenerated` from `FUNCTION_ARGUMENT_KEYS`.
- In `lowerFunction`, before the registry lookup: if `fn === 'dbgenerated'` and there is one positional string argument, return `{ storage: { kind: 'function', expression: <the string value> }, onCreate: undefined }`. No canonicalization and no body check: the Prisma 7 language had neither, and the planner's DDL-time check still applies.
- If `fn === 'dbgenerated'` with no arguments, return `{ storage: undefined, onCreate: undefined }` on every field: optional, required, or list. Delete the diagnostic that rejected the empty form on required fields. `givesColumnDefault` returns `false` for the empty form, as today.
- If `fn === 'dbgenerated'` with any other argument shape, `PSL.PRISMA7_UNKNOWN_DEFAULT` with `function "dbgenerated()" has an argument this contract source does not read.` (the existing message path).
- Fixtures under `contract-prisma7/test/fixtures/` and `test/integration/test/fixtures/prisma7-source/{reference,supported,supported-verify}/schema.prisma` keep their `dbgenerated("gen_random_uuid()")` uses; they are Prisma 7 language. Add one fixture with the empty form on a required field and assert the column has no default and no diagnostic.
- The package README's list of what the source reads says: `@default(dbgenerated("<sql>"))` becomes a raw SQL default; `@default(dbgenerated())` means no column default.

### C4. Infer prints the new forms

Files: [`9-family/src/core/psl-contract-infer/default-mapping.ts`](../../../../packages/2-sql/9-family/src/core/psl-contract-infer/default-mapping.ts), [`postgres-default-mapping.ts`](../../../../packages/3-targets/3-targets/postgres/src/core/psl-infer/postgres-default-mapping.ts), [`infer-model-blocks.ts`](../../../../packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-model-blocks.ts), [`infer-psl-contract.ts`](../../../../packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-psl-contract.ts).

- `mapDefault`'s function arm: named functions print as today; anything else prints `@default(sql\`<expression>\`)`, or `@default(sql"<expression>")` with PSL string escaping when the expression contains a backtick. This is the family's built-in fallback; the `fallbackFunctionAttribute` option and `DefaultMappingResult`'s `comment` member are deleted. `postgres-default-mapping.ts` keeps only the named-function table (`gen_random_uuid()`) and its `formatDbGeneratedAttribute` is deleted.
- Classification before printing: infer already resolves a column's raw default with the same Postgres parser verify uses (`parsePostgresDefault`, reached through `resolvedDefault`). Two classifications it does not make today are added so the Supabase contract prints literals where it can:
  - A default written as `'<text>'::<type>` where `<type>` is the column's own type (including `jsonb`, `json`, `text`, and array types) is a literal whose value is `<text>` read through the column's codec. The four Supabase JSON defaults print as `@default("{}")` and `@default("[]")`.
  - A default written as `'<text>'::<schema>.<enum>` or `'<text>'::<enum>` where the enum is a native enum in the introspected schema and the column is typed by it is the enum member `<text>`; infer prints `@default(<member>)`. The six Supabase enum casts print this way. The test at `infer-psl-contract.enum-adoption.test.ts` that pins a schema-qualified cast as preserved raw is rewritten to expect the member.
- `@default(autoincrement())` identity handling is unchanged.

### C5. Regenerate the Supabase contract

- Run the pack's generation script (`pnpm --filter <supabase package> contract:generate`). The diff of `contract.prisma` is exactly the 21 `dbgenerated` lines:

| Lines | Before | After |
|---|---|---|
| 88, 158, 445, 459, 544, 571, 587, 657, 675, 697 | `@default(dbgenerated("gen_random_uuid()"))` | `` @default(sql`gen_random_uuid()`) `` |
| 167, 168, 576 | `@default(dbgenerated("'{}'::jsonb"))` | `@default("{}")` |
| 466 | `@default(dbgenerated("'[]'::jsonb"))` | `@default("[]")` |
| 118 | `@default(dbgenerated("'confidential'::auth.oauth_client_type"))` | `@default(confidential)` |
| 292 | `@default(dbgenerated("'code'::auth.oauth_response_type"))` | `@default(code)` |
| 293 | `@default(dbgenerated("'pending'::auth.oauth_authorization_status"))` | `@default(pending)` |
| 546 | `@default(dbgenerated("'ANALYTICS'::storage.buckettype"))` | `@default(ANALYTICS)` |
| 561 | `@default(dbgenerated("'VECTOR'::storage.buckettype"))` | `@default(VECTOR)` |
| 627 | `@default(dbgenerated("'STANDARD'::storage.buckettype"))` | `@default(STANDARD)` |
| 296 | `@default(dbgenerated("(now() + '00:03:00'::interval)"))` | `@default(sql\`(now() + '00:03:00'::interval)\`)` |

Line numbers are as of `main` at 2026-09-16; the implementer re-derives them.

**Known pre-existing drift (found 2026-09-17).** The committed Supabase contract already differs from what `pnpm contract:generate` produces on `main`, independently of this project: the `types {}` alias block is inlined, 43 `@@check(...)` lines are added, the six enum casts already print as literal defaults such as `@default("confidential")`, and the two `String[]` columns gain `@noCheck(elementNotNull)`. Regenerating therefore changes about 490 lines of `contract.prisma`, 650 of `contract.json`, and 290 of `contract.d.ts`. Before C5 runs, that drift must be regenerated and reviewed on its own (a separate PR, or the first commit of this slice with its own verify run), so that this slice's regeneration diff is only the `dbgenerated` lines. The table above then shrinks: the six enum rows are already done, and the enum print form is a string literal, not the member name. Any change beyond the remaining `dbgenerated` lines after that first regeneration is a halt condition.

- The emitted `contract.json` changes only where a literal replaces a function default (the JSON and enum lines). The storage hash moves. `test/reference-fixture-verify.integration.test.ts` must stay green: every new literal must verify equal to the live default.
- `CONTRACT-FIDELITY.md`: rewrite the "Column defaults" paragraph. It currently claims three omitted defaults; `scripts/generate-contract.ts` `DEFAULT_OMISSIONS` holds one (`auth.users.phone`). Say so, and remove the sentence about `dbgenerated` being function-kind on list fields.

### C6. Fixtures and examples

- Rename the parity pair `test/integration/test/authoring/parity/default-dbgenerated/` to `default-gen-random-uuid/` with `@default(gen_random_uuid())` and `.default(genRandomUuid())`.
- `test/integration/test/ports/prisma/functional/issues-28591-mapped-enums/_fixture/contract.prisma` line 41: `@default(dbgenerated("'pending'::\"SuggestionStatus\""))` becomes `@default(pending)` (the field is enum-typed) or, if the port requires the cast text, `@default(sql\`'pending'::"SuggestionStatus"\`)`. Choose the member form unless the test breaks; record which.
- `contract-psl/test/interpreter.defaults.test.ts` test `preserves raw dbgenerated defaults for timestamp and json columns` becomes `preserves raw sql defaults for timestamp columns` using `sql\`clock_timestamp()\``; the json column case moves to slice B's literal tests (already there).
- `test/e2e/framework/test/sqlite/migrations/widening.test.ts` comment naming `lowerDbgenerated` is rewritten.
- Every remaining test that constructs `dbgenerated(...)` PSL (see the inventory in the project spec) is rewritten to `sql\`...\`` or to the literal or named form its column allows.

### C7. Upgrade instruction

Directory: `upgrade-instructions/pending/remove-dbgenerated/app/instructions.md` and `upgrade-instructions/pending/remove-dbgenerated/extension/instructions.md`, following [`upgrade-instructions/README.md`](../../../../upgrade-instructions/README.md) and the `record-upgrade-instructions` skill. Both audiences are affected: examples changed (`app`) and the Supabase extension changed (`extension`).

Content, both audiences:

- Declaration: `@default(dbgenerated("..."))` removed from PSL; `.defaultSql(...)` deprecated in TypeScript.
- Mechanical rewrite table:

| You wrote | Write instead |
|---|---|
| `@default(dbgenerated("gen_random_uuid()"))` | `` @default(sql`gen_random_uuid()`) `` |
| `@default(dbgenerated("now()"))`, `@default(dbgenerated("CURRENT_TIMESTAMP"))` on Postgres | `@default(now())` |
| `@default(dbgenerated("'<json>'::jsonb"))` on a JSON column | `@default("<json>")` |
| `@default(dbgenerated("'<member>'::<enum type>"))` on an enum column | `@default(<member>)` |
| `@default(dbgenerated("<anything else>"))` | `@default(sql\`<anything else>\`)` |
| `.defaultSql('now()')` | `.default(now())` |
| `.defaultSql('autoincrement()')` | `.default(autoincrement())` |
| `.defaultSql('gen_random_uuid()')` | `` .default(sql`gen_random_uuid()`) `` |
| `.defaultSql('<anything else>')` | `.default(sql\`<anything else>\`)` |

- Detection: `grep -rn "dbgenerated(" prisma/` and `grep -rn "defaultSql(" prisma/`.
- Note that the contract JSON does not change for any of these rewrites except JSON and enum literals, where the storage hash moves and `db verify` still passes because the value is the same.

### C8. Docs sweep

Delete or rewrite every mention of `dbgenerated` as an accepted form:

- `packages/2-sql/2-authoring/contract-psl/README.md`
- `docs/reference/error-reference.md` (the `dbgenerated` examples; add the removed-function message)
- `docs/architecture docs/adrs/ADR 167 - Typed default literal pipeline and extensibility.md`: add a dated note under the superseded banner: the `dbgenerated(...)` stopgap was removed; raw SQL defaults are ADR 129 tagged literals, typed literals go through codecs per ADR 184's amendment.
- `docs/architecture docs/adrs/ADR 248 - PostgreSQL floor lowered to 15.md` line 19: `dbgenerated("gen_random_uuid()")` → `gen_random_uuid()`.
- `scorecard/03-psl-schema-language.md` and `scorecard/15-migrations.md`: update the rows and their status.
- `skills/prisma-8/upgrading/**` and `upgrade-instructions/**` history: leave as is (they describe past versions).
- `projects/infer-emit-roundtrip/`, `projects/port-all-tests/`, `projects/prisma-8-rc1/`: leave as is (project history).
- `CHANGELOG.md`, `docs/releases/`: leave as is.

### C9. Artefact-format test

Add an integration test that loads the Supabase pack's `contract.json` as committed on `main` before this slice (copy it into `test/integration/test/fixtures/contract-format/supabase-before-dbgenerated-removal.contract.json`) through `validateSqlContractFully` and asserts it validates. This proves a contract carrying `{ kind: 'function', expression }` defaults from before the change still loads.

### C10. The editor-tooling brief for Serhii

File: `projects/remove-dbgenerated/editor-tooling-brief.md`. Contents:

- What changed in the parser: the `TemplateLiteral` token, the `TaggedLiteral` expression node and its AST class, the `literal()` and `taggedLiteral()` combinators, the tag registry on `ControlMutationDefaults`.
- What the language server must do: tokenise and parse the fence without errors; offer completion for registered tags inside `@default(` alongside the function list; report the new diagnostic codes at their spans; hover on a tagged literal shows the tag's usage string.
- What the formatter must do: leave a `TemplateLiteral` token byte-identical, including its indentation.
- What highlighting should do: inject SQL highlighting inside `sql`, `pg.sql`, and `sqlite.sql` fences (TextMate grammar or equivalent), with the fence delimiters styled as string delimiters.
- Where the tests are: the tokenizer, parser, combinator, and completion tests slices A and C added, so he can extend them.
- What is explicitly not done: everything in the highlighting bullet, hover, and tag completion.

## Tests (written first; each named test must fail before its implementation lands)

- Interpreter: `@default(dbgenerated("x"))` → `PSL_UNKNOWN_DEFAULT_FUNCTION` with the C2 message, on the Postgres and SQLite fixture registries.
- Prisma 7 source: `dbgenerated("x")` → function default `x` with no registry entry present; empty `dbgenerated()` on a required field → no default, no diagnostic; on an optional field → same; on a list field → same.
- Infer (`postgres/test/psl-infer`): `'{}'::jsonb` on a jsonb column → `@default("{}")`; `'confidential'::auth.oauth_client_type` on a column of that enum → `@default(confidential)`; `(now() + '00:03:00'::interval)` → `@default(sql\`(now() + '00:03:00'::interval)\`)`; an expression containing a backtick → the quote fence; `gen_random_uuid()` → `@default(gen_random_uuid())`.
- Family `default-mapping` tests: no `comment` result exists (type-level: `DefaultMappingResult` has one member).
- Supabase: `pnpm --filter <supabase package> test` green, including the reference-fixture verify test, against the regenerated contract.
- Artefact-format test (C9).
- Journey `infer-roundtrip-fidelity.e2e.test.ts`: assert the printed schema contains no `dbgenerated`.
- Diagnostics fixture `removed-dbgenerated` (C2).

## Definition of done

- `git grep -n dbgenerated -- packages examples test docs skills upgrade-instructions scorecard` returns only: the ADR 167 note; `upgrade-instructions/pending/remove-dbgenerated/**`; `packages/2-sql/2-authoring/contract-prisma7/**` (source, README, fixtures) and `test/integration/test/fixtures/prisma7-source/**`; `CHANGELOG.md`, `docs/releases/**`, and `skills/prisma-8/upgrading/**` history.
- `git grep -n "NOW_SYNONYMS\|lowerDbgenerated\|dbgeneratedSig\|formatDbGeneratedAttribute\|fallbackFunctionAttribute" -- packages` returns nothing.
- All tests above green; `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm fixtures:check` (the Supabase contract and the renamed parity fixture change, nothing else), `pnpm lint:deps`, `pnpm lint:docs`, root typecheck green.
- The upgrade instruction fragments pass the per-PR validation the `record-upgrade-instructions` skill describes.
- The Serhii brief exists and is linked from the PR body.
- ADR 167 note merged with the PR.

## Halt conditions

- The regenerated Supabase `contract.prisma` differs anywhere other than the 21 lines in C5. List the extra lines and stop.
- A Supabase literal default does not verify equal to the live default. Name the column and both sides and stop; do not add a normaliser rule.
- A committed fixture on SQLite carries a default only `dbgenerated` could express and none of the new forms can. List it and stop.
- A contract JSON from before the change fails to load (C9). Stop; the project's first cross-cutting requirement is violated.

## Repository rules that apply

`CLAUDE.md`; `.agents/rules/running-tests.mdc`; `.agents/rules/git-staging.mdc`; `.agents/rules/no-backward-compatibility.mdc` (no shim that keeps `dbgenerated` parsing); `.agents/rules/doc-maintenance.mdc`; `.agents/rules/fix-the-class-not-the-instance.mdc`; `.agents/rules/cli-test-fixture-cleanup.mdc`; the `record-upgrade-instructions` skill; `drive/calibration/failure-modes.md` F12 (exhaustive doc sweep); `drive/calibration/dod.md` § Project-DoD "Artefact-format changes load the previous format".

## Amendment 2026-09-17: no named `gen_random_uuid()`

Project spec D6 is amended: `gen_random_uuid()` is not a named function. Everywhere this slice says `@default(gen_random_uuid())`, `genRandomUuid()`, or a `default-gen-random-uuid` parity pair, read `` @default(sql`gen_random_uuid()`) ``, `` .default(sql`gen_random_uuid()`) ``, and a pair that uses those forms. `contract infer` prints a live `gen_random_uuid()` default through the general `sql` fallback; there is no special entry for it. In C5 the ten `gen_random_uuid()` rows become `` @default(sql`gen_random_uuid()`) ``.
