# Code review: slice 1 (TML-3386)

Reviewer-maintained. Contract: `projects/data-types-completion/design.md` sections 1 to 6. Plan: `projects/data-types-completion/slices/1/plan.md`.

## Subagent IDs

- Implementer: slice1-implementer (Fable), dispatch a round 1. Replaced for round 2 by slice1-implementer-2 (Opus) on 2026-09-30, because the account reached its Fable usage limit before round 2 started; nothing was lost (clean tree). Return to Fable for the next fresh implementer once the limit resets.
- Reviewer: slice 1 reviewer (Opus), persistent, started 2026-09-30 for dispatch a round 1

## Scoreboard

| Dispatch | Round | Verdict |
| --- | --- | --- |
| a | 1 (`ee324c75f6..16ef9dd0e7`) | ANOTHER ROUND NEEDED: 1 must-fix, 1 should-fix, 7 low |
| a | 2 (`a41f377b5b..01a3f1c8b3`, design `2c1a3335d4`) | SATISFIED: S1-a-R1-1 to S1-a-R1-9 closed, no new finding |
| b | 1 (`48b4fc0c59..14645c85c8`, design `4fc18309bc`) | ANOTHER ROUND NEEDED: 3 low |
| b | 2 (`006f164312`, design `185969a71c`) | SATISFIED: S1-b-R1-1 to S1-b-R1-3 closed, no new finding |
| c | 1 (`707b4c86af..806c08cfc4`, design `bf9ebd9d60` excluded) | SATISFIED: no finding |
| d | 1 (`7565a8f8f9`, `45fe7b6423`, `28773fa5f1..ecca4f2409`) | ANOTHER ROUND NEEDED: 1 should-fix, 2 low |
| d | 2 (`22fd1bc9de..bc2479e72f`) | SATISFIED: S1-d-R1-1 to S1-d-R1-3 closed, no new finding |
| e | 1 (`f8903ee5dc..c7965f6d86`) | ANOTHER ROUND NEEDED: 2 low |
| e | 2 (`6b28dbff21`, `511e3fd4b1`) | SATISFIED: S1-e-R1-1 and S1-e-R1-2 closed, no new finding |
| f | 1 (`4b33205e76..ddb0814c42`) | ANOTHER ROUND NEEDED: 1 must-fix, 2 should-fix, 1 low |
| f | 2 (`ddb0814c42..2f23721797`) | ANOTHER ROUND NEEDED: S1-f-R1-1 to S1-f-R1-4 closed; 1 new low |
| f | 3 (`9ddfaa62e3`) | SATISFIED: S1-f-R2-1 closed, no new finding |
| review fixes 1 | 1 (`01925ee865..f4e89409e0`) | ANOTHER ROUND NEEDED: 2 low |
| review fixes 1 | 2 (`c409a672b8`, `ca0de95478`) | SATISFIED: S1-rf1-R1-1 and S1-rf1-R1-2 closed, no new finding |
| review fixes 2 | 1 (`5a6f37bfaa..7bece37e1a`) | ANOTHER ROUND NEEDED: 1 must-fix, 2 low |
| review fixes 2 | 2 (`9d4437193f`, `6b99abad7d`) | SATISFIED: S1-rf2-R1-1 to S1-rf2-R1-3 closed, no new finding |
| review fixes 3 | 1 (`c3f36b3369..e5641a42ce`, after the merge of `main`) | ANOTHER ROUND NEEDED: 1 low |
| review fixes 3 | 2 (`a8e36d4744`) | SATISFIED: S1-rf3-R1-1 closed, no new finding |
| review fixes 4 | 1 (`7835641a20..a5550c2793`, merge of `main` first) | ANOTHER ROUND NEEDED: 2 must-fix, 2 low |

## Findings log

### S1-a-R1-1 (must-fix): the golden test skips 40 committed SQL contracts

- Where: `test/integration/test/planner-golden/planner-ddl-golden.test.ts:57-64`, and the claim in the file header (lines 1-12) and in commit `d0891e296d`.
- What is wrong: contracts are selected by file name (`**/contract.json`, `**/expected.contract.json`). That misses 40 tracked whole SQL contracts: 35 Prisma 7 reader fixtures `packages/2-sql/2-authoring/contract-prisma7/test/fixtures/*/expected-contract.json` (hyphen, not dot), `packages/3-targets/3-targets/sqlite/test/fixtures/sqlite-contract.json`, `packages/3-targets/3-targets/postgres/test/fixtures/namespaced-contract.json`, `packages/3-targets/3-targets/postgres/test/fixtures/snapshot-read-shapes/codec-instance.json`, `test/integration/test/value-objects/fixtures/generated/sql-contract.json` and `test/integration/test/fixtures/contract-format/supabase-before-dbgenerated-removal.contract.json`. Design 6 asks for every committed example and fixture contract. The skipped Prisma 7 fixtures hold the only `pg/float4` column in the repository and the only `time`, `timetz` and `timestamp` columns without precision, so a DDL change for those types would not be seen. Nothing records that these files were left out.
- Change: select every tracked `*.json` file whose top level has `targetFamily: "sql"` and `target` `postgres` or `sqlite`, whatever its name. Keep the `unreadable` recording for files the validator refuses. Record the new goldens now: the three commits change no planner, adapter or target code, so the output equals the base commit's. Update the header and the test's own wording to match.

### S1-a-R1-2 (should-fix): no committed contract covers the raw-parameter cases or several SQLite types

- Where: `test/integration/test/planner-golden/` (corpus).
- What is wrong: even with S1-a-R1-1 fixed, no committed contract has a column of these shapes: `pg/numeric` with `precision` and no `scale` (written `numeric(10)`, the case where writing the normal form would give `numeric(10,0)`); `pg/char` with no `length` (written `character`, not `character(1)`); `pg/bit`, `pg/varbit` without `length`; `pg/interval` without `precision`; `pg/varchar` without `length`; any list of a parameterised type. On SQLite: `sqlite/real@1`, `sqlite/blob@1`, `sql/varchar@1` (the new `sqlite/character-varying`), `sql/char@1` without `length`, `sql/int@1`, `sql/float@1`. Design 2.3's raw-versus-normalised rule is the main way dispatch e can change DDL, and the `renderSqlTypeName` unit tests of dispatch b cannot catch a planner that passes the wrong parameters. The halt condition "the golden planner test finds a DDL change" is only as good as this corpus.
- Change: add one TypeScript-authored fixture contract per target (Postgres with pgvector and postgis; SQLite), emitted and committed in this dispatch through the same path as the other `test/fixtures/generated/contract.json` files so `pnpm fixtures:check` holds them fixed. Give it one column per data type of design 2.6 in each parameter shape the TypeScript helpers can write today (with and without each optional parameter), one list column per type that allows lists, and one `typeRef` alias of a parameterised type. Record their goldens now. The `typeRef` alias will then show the one allowed DDL change of design 3.6 as a visible diff in dispatch e.

### S1-a-R1-3 (low): example-local packs are dropped without a record

- Where: `test/integration/test/planner-golden/planner-ddl-golden.test.ts:110-113`.
- What is wrong: an extension id not in `extensionsById` is dropped silently, and the golden lists it under `extensions` as if it were loaded. Today this is harmless: I checked the nine affected contracts and none has a column whose codec comes from `demo/engagement-stats`, `slugid-defaults`, `audit` or `feature-flags` (all are `pg/*` or `pg/vector@1`). But a future contract that uses an example-local pack's codec would be planned without it and nobody would see why.
- Change: keep an explicit set of the four pack ids known not to be importable, fail the test on any other unknown id, and write the ids that were not loaded into the golden (for example `extensionsNotLoaded`).

### S1-a-R1-4 (low): a space between `(` or `,` and a double quote is kept

- Where: `packages/2-sql/1-core/contract/src/sql-data-type.ts:354-356`.
- What is wrong: design 11.2 step 2 removes spaces after `(` and `,`. The double-quote branch writes a pending space without that check, so `foo( "Bar")` prepares to `foo( "Bar")`, not `foo("Bar")`.
- Change: apply the same after-`(`-or-`,` check in the quote branch, and add a resolve test with a synthetic quoted text preceded by `( `.

### S1-a-R1-5 (low): rule 3 lets `display` rename a placeholder

- Where: `packages/2-sql/1-core/contract/src/sql-data-type.ts:140`.
- What is wrong: the check compares `display` and `text` without letter case, so a display `geometry(Geometry,{SRID})` passes, and `substitute` then writes `undefined`, because `params['SRID']` does not exist.
- Change: also require `placeholdersOf(display)` to equal `placeholdersOf(text)` exactly, and add a declare test that refuses such a display.

### S1-a-R1-6 (low): one resolver assertion cannot fail

- Where: `packages/2-sql/1-core/contract/test/sql-data-type.resolve.test.ts:66`.
- What is wrong: no fixture declares `character varying`, so `character varying (255)` resolves to `undefined` whatever the text preparation does. The assertion is meant to show that a space before `(` is kept.
- Change: assert on a declared text instead, for example `numeric (10,2)` resolves to `undefined`.

### S1-a-R1-7 (low): two render tests read wrongly

- Where: `packages/2-sql/1-core/contract/test/sql-data-type.render.test.ts:122` and `:69-72`, `:161-169`.
- What is wrong: "refuses a written parameter on a type that is never written" passes no parameter. `dataTypeWithDisplay()` builds a data type by spreading `geometry` and swapping its texts, so it never goes through `sqlDataType` and its rules.
- Change: rename the first to "refuses to write a type that is never written". Declare the second with `sqlDataType('t/displayed', { texts: [{ text: 'geometry', written: true, display: 'Geometry' }] })`.

### S1-a-R1-8 (low): the error reference leaves out the catalog case

- Where: `docs/reference/error-reference.md:578-580`.
- What is wrong: the entry names two causes, a schema failure and "no written text ... takes that set of parameters". `renderSqlCatalogText` also raises the code when no catalog text takes the parameters in their normal form.
- Change: add that cause to the entry.

### S1-a-R1-9 (low): `sqlBaseName` passes unchecked parameters to `render`

- Where: `packages/2-sql/1-core/contract/src/sql-data-type.ts:295-301`.
- What is wrong: the `blindCast` reason says callers pass what `dataTypeParams` kept. `dataTypeParams` does not make sure required keys are present, so a `pg/enum` column without `typeName` reaches `render` and fails with a `TypeError` from `split`, not a structured error.
- Change: in the `render` branch, call `validatedParams(type, params)` and pass its result, which removes the cast. Add a test: `sqlBaseName(enumType, {})` throws `CONTRACT.TYPE_PARAMS_INVALID`. The branch without `render` stays unvalidated, because it ignores the parameters (the pgvector contract has a `pg/vector@1` storage type with no `length`, and its base name must still be `vector`).

### Round 2 status of the round 1 findings

- S1-a-R1-1: closed. `listCommittedSqlContracts` now reads every tracked `*.json` file and keeps those whose top level names the SQL family and Postgres or SQLite. The 40 files are in the corpus (340 goldens). The 289 goldens not otherwise touched are byte-identical to round 1. The nine that changed differ only in the extension lists; I compared `planned` with `jq -S` before and after.
- S1-a-R1-2: closed. `test/integration/test/planner-golden/fixtures/{postgres,sqlite}/contract.ts` are emitted through `emit-fixture-configs.mjs`. Their goldens contain `numeric(10)`, `character`, `bit`, `bit varying`, `interval`, `time` and `timetz` with and without parameters, `float4`, `tsquery`, lists of each parameterised type, the enum, pgvector and postgis with and without `srid`. They also contain the `typeRef` aliases, which show today's quoting bug (`"character"`, `"uuid"`). SQLite has `REAL`, `BLOB`, and `CHARACTER` and `CHARACTER VARYING` with and without `length`.
- S1-a-R1-3: closed. `examplePackIds` is explicit, and any other unknown pack throws. The golden lists what was not loaded under `extensionsNotLoaded`.
- S1-a-R1-4: closed without a test, correctly. Design 2.7 item 2 now refuses `"` in a declared text, and that refusal has a test (`'a double quote'`). So a reported text that contains a quote can never match, whatever preparation does around it, and a test of the space rule next to a quote could not fail. The code follows 2.7 item 3.
- S1-a-R1-5: closed, with a test (`/t\/bad.*SRID/`).
- S1-a-R1-6: closed. `numeric (10,2)` and `numeric(10 ,2)` are asserted against a declared text. Each would turn red if preparation removed that space.
- S1-a-R1-7: closed. The test is renamed, and `t/displayed` is declared through `sqlDataType`.
- S1-a-R1-8: closed. The entry names the catalog cause and `sqlBaseName`.
- S1-a-R1-9: closed. The `render` branch calls `validatedParams`, and the cast is gone. The test expects `CONTRACT.TYPE_PARAMS_INVALID` naming `typeName`. Design 2.7 item 6 is also done: kind claims are validated and normalised through `resolvedWith`, with a test for each.

### S1-b-R1-1 (low): an enum reported with no schema is not tested

- Where: `packages/3-targets/3-targets/postgres/test/data-type-texts.test.ts:168-179`; the doc comment at `packages/3-targets/3-targets/postgres/src/core/data-types.ts:106`.
- What is wrong: design 11.3, as edited in `4fc18309bc`, reads an enum with an undefined `schema` as unqualified. The code does this (`reported.schema === undefined ||`), but no test covers it, so removing that clause would leave every test green. The doc comment still says "its name in `public`" only.
- Change: add a case `reported('mood', { kind: 'enum', schema: undefined, name: 'mood' })` that resolves to `{ dataType: 'pg/enum', typeParams: { typeName: 'mood' } }`. Make the comment say "its name in `public` or with no schema".

### S1-b-R1-2 (low): the pgvector and postgis declaration tests accept extra keys

- Where: `packages/3-extensions/pgvector/test/data-type-declarations.test.ts:34-39`; `packages/3-extensions/postgis/test/data-type-declarations.test.ts:33-46`.
- What is wrong: both tests compare `sql` with `toMatchObject`, so a text with an extra key (a stray `display`, say) still passes. The Postgres test uses `toEqual`.
- Change: assert `sql.texts` with `toEqual` and `sql.claimsKind` with `toBeUndefined()`.

### S1-b-R1-3 (low): the codec authoring guide shows the old `postgresCodec` call

- Where: `docs/reference/codec-authoring-guide.md:289`, `:295` and `:545`.
- What is wrong: both examples pass `dataType: pgInt4.id` / `pgText.id`, which no longer typechecks. Line 295 says the adapter takes the wrapped descriptor's parameter schema, but it now takes the data type's (`.agents/rules/doc-maintenance.mdc`).
- Change: pass `pgInt4` and `pgText`, and say that the adapted codec's parameter schema is its data type's. Dispatch f's rewrite of the guide does not remove the need to keep these examples compiling now.

### Dispatch b round 2 status of the round 1 findings

- S1-b-R1-1: closed. `data-type-texts.test.ts` now reads an enum reported with `schema: undefined` as `{ typeName: 'mood' }`. `wip/logs/b2-enum-red.log` shows it failing with the clause removed. The doc comment is updated.
- S1-b-R1-2: closed. Both extension tests compare `sql.texts` with `toEqual` and check that `claimsKind` is undefined.
- S1-b-R1-3: closed. Both `postgresCodec` examples pass the data type object and import what they use. The guide says the adapted codec's parameter schema is its data type's `params`. `lint:docs` passed.

### S1-d-R1-1 (should-fix): the unmapped-key check skips every codec without a parameter schema

- Where: `packages/1-framework/1-core/framework-components/src/control/control-stack.ts:473-485` (`enforceConstructorInvariants`).
- What is wrong: `objectSchemaKeys` returns `undefined` both for a schema that is not an arktype object and for no schema at all, and the check is skipped in both cases. A codec with no `paramsSchema` declares no keys of its own, so a constructor that maps an argument onto any key its data type does not declare is exactly what design 5.1 refuses. Today it passes assembly silently. Skipping a schema that exists but exposes no keys (a non-arktype StandardSchema) is a reasonable choice and can stay.
- Change: when `codec.paramsSchema` is `undefined`, treat the codec's own keys as empty and check the mapped keys against the data type's `params` keys only. Keep the skip only for a schema that is present but exposes no keys. Add a red-first test: a constructor mapping an argument onto a codec with no parameter schema and a data type without `params` is refused.

### S1-d-R1-2 (low): no test shows the two assembly functions are called

- Where: `packages/2-sql/9-family/src/core/control-instance.ts:509` and `packages/1-framework/1-core/framework-components/src/control/control-stack.ts:918-919`.
- What is wrong: the checks are tested only by calling `enforceSqlDataTypeInvariants` and `enforceDataTypeInvariants` directly. Deleting the call in `createSqlFamilyInstance`, or the `constructors` and `codecDescriptorFor` inputs in `createControlStack`, leaves every test green.
- Change: add one test that `createSqlFamilyInstance` throws for a stack with two colliding SQL data types, and one that `createControlStack` throws for a constructor naming an unregistered codec.

### S1-d-R1-3 (low): the error reference does not describe the two codes' new raising site

- Where: `packages/2-sql/1-core/contract/src/sql-data-type.ts:338-352`; `docs/reference/error-reference.md` entries `CONTRACT.CODEC_DESCRIPTOR_MISSING` (line 256) and `CONTRACT.DATA_TYPE_UNREGISTERED` (line 374).
- What is wrong: `storedSqlTypeNameOfCodec` reuses both codes when a contract is authored. This is the error a user now sees when a `contract.ts` uses an extension's codec without listing the extension. The entries describe only control-plane resolution and assembly. The `DATA_TYPE_UNREGISTERED` entry gives the payload `dataType, contributedBy`, but this site sends `codecId, dataType` (`.agents/rules/doc-maintenance.mdc`).
- Change: add the authoring site to both entries, say how to fix it (list the pack that provides the codec), and list the payload of each site.

### Dispatch d round 2 status of the round 1 findings

- S1-d-R1-1: closed. A codec with no `paramsSchema` now declares no keys of its own, and mapped keys are checked against the data type's `params`. A present schema that exposes no keys is still skipped. Two new tests fail when the fix is reverted (I checked).
- S1-d-R1-2: closed. `createControlStack` is tested to refuse a constructor naming an unregistered codec, and `createSqlFamilyInstance` to refuse colliding SQL data types. Each test fails when its call or input is removed (I checked). The one `blindCast` is in a test file.
- S1-d-R1-3: closed. Both error reference entries name the authoring source, how to fix it, and its payload (`codecId`; `codecId`, `dataType`).

### S1-e-R1-1 (low): the error reference keeps an entry for a code nothing raises

- Where: `docs/reference/error-reference.md:514` (`CONTRACT.NATIVE_TYPE_INVALID`).
- What is wrong: the dispatch removed the code from both targets' `errors.ts` and its raising sites, so `check:error-reference` now counts 360 codes, but the entry still says the planners raise it. `check:error-reference` checks only that every known code is listed, not the reverse (`.agents/rules/doc-maintenance.mdc`).
- Change: delete the entry.

### S1-e-R1-2 (low): the Scenario A test still says it writes and reads a vector

- Where: `test/integration/test/extension-pgvector-scenario-a.e2e.integration.test.ts:29` and `:347`.
- What is wrong: the apply test no longer has an `embedding` column, because `pgvector/vector` requires `length` (design 2.4) and a PGlite domain takes no type modifier. The header still says the `Doc` table carries a `vector(N)` column in every layer, and the test name says "round-trip OK", which now reads only `id`.
- Change: say that only the plan test has the `vector(3)` column and that the apply test checks the markers and an `id` row.

### Dispatch e round 2 status of the round 1 findings

- S1-e-R1-1: closed. The `CONTRACT.NATIVE_TYPE_INVALID` entry is deleted, and nothing outside `projects/` names the code. `check:error-reference` lists all 360 codes.
- S1-e-R1-2: closed. The header now says only the plan test's `Doc` table has the `vector(N)` column, and why the applied table has only `id`. The test name says the markers are written and a `Doc` row round-trips. The Scenario A file passes (6 tests). Both commits carry both sign-offs and no AI attribution.

### S1-f-R1-1 (must-fix): the upgrade entries were not validated by execution

- Where: `upgrade-instructions/pending/data-types-declare-names/extension/` and `.../app/`; `skills-contrib/record-upgrade-instructions/SKILL.md` "Validation by execution".
- What is wrong: the skill says "Before merging, run every new entry against the corresponding example or extension code … starting from its pre-PR state", then check that `git status --porcelain` over the non-test paths is empty, that tests are untouched, and that the suite is green. It ends "If any check fails, iterate on the entry; do not merge." Checking each instruction by reading the pgvector, postgis and arktype-json diffs is not that procedure, and it does not cover every path the equality check compares. The extension diff since `bot/data-types-completion` also changes `packages/3-extensions/postgres/src/contract/define-contract.ts` and `packages/3-extensions/sqlite/src/contract/define-contract.ts`, and the app diff changes `examples/prisma-8-demo-sqlite/src/prisma/contract.d.ts`.
- Change: in a disposable checkout (a gitignored worktree under `wip/`), run both flows exactly as the skill writes them against `bot/data-types-completion`, and record the commands and their empty outputs in the round report. Where an entry does not reproduce a file (the two facade `define-contract.ts` files are the likely case), extend the entry, or bring the question to the orchestrator if those files should not be in the extension audience's diff.

### S1-f-R1-2 (should-fix): the extension entry leaves out three changes an extension author sees

- Where: `upgrade-instructions/pending/data-types-declare-names/extension/instructions.md`.
- What is wrong: (1) `CodecControlHooks.resolveIdentityValue` now receives `dataType` (the data type id) in place of `nativeType` (`packages/2-sql/9-family/src/core/migrations/types.ts`). An extension hook that reads `nativeType` breaks, and the entry tells authors to keep the hook unchanged. (2) PostgreSQL parameter casts now write the data type's base name: `$1::integer` becomes `$1::int4`, and likewise `bool`, `int2`, `int8`, `float4`, `float8`. An extension whose tests or fixtures assert query text changes. (3) The migrations `contractToSchema(contract, frameworkComponents)` now requires `frameworkComponents`.
- Change: add an entry, or a paragraph under an existing one, for each, with before and after code and a detection pattern (`resolveIdentityValue` reading `nativeType`; `::integer`, `::boolean` and the other old names in test text; `contractToSchema(` with one argument).

### S1-f-R1-3 (should-fix): the column helpers restate their data type's bound, and postgis gets it wrong

- Where: `packages/3-extensions/postgis/src/core/codecs.ts:161-172` (`pgGeometryColumn`); the same pattern in `packages/3-extensions/pgvector/src/exports/column-types.ts:19-35` (`vector`).
- What is wrong: design 2.4 says the data type's `params` is the only place a bound is written. `pgGeometryColumn({ srid: 0 })` passes the helper's own check ("non-negative integer"), but `postgis/geometry` requires 1 or more. So the contract builds, and is refused later, at the latest when the planner writes the column (`CONTRACT.TYPE_PARAMS_INVALID`). pgvector's helper repeats its bound with the right values, so it is a second copy of the bound, not a wrong one.
- Change: make both helpers validate `{ srid }` and `{ length }` with the codec's `paramsSchema` (for example through `validateAuthoringTypeParams`, or by reading the schema's issues) and report `CONTRACT.ARGUMENT_INVALID` as today. Delete the restated bounds and the "non-negative" doc text. Red first: `pgGeometryColumn({ srid: 0 })` throws.

### S1-f-R1-4 (low): the guide's stack and adapter snippets leave out `dataTypes`

- Where: `docs/reference/codec-authoring-guide.md:331-364` ("Stack contribution and direct adapter injection").
- What is wrong: the snippets contribute pgvector and postgis descriptors, and build `createPostgresAdapter({ codecDescriptors })`, with no `dataTypes`. Copied as written, a query that binds a vector parameter fails when the cast is rendered, because the runtime has no `pgvector/vector` data type. The guide says to register `dataTypes` elsewhere (line 588), and the extension entry shows `createPostgresAdapter({ codecDescriptors, dataTypes })`, but these snippets contradict both.
- Change: add `dataTypes` to both extension descriptors and to the `createPostgresAdapter` call, and say that a custom codec's data types are passed beside it.

### Dispatch f round 2 status of the round 1 findings

- S1-f-R1-1: closed. I reran the extension flow myself in a fresh `git worktree add wip/proof-review 2f23721797`, removed afterwards. I restored `packages/3-extensions/` from the merge base with `bot/data-types-completion` (`1e9cc29f05`) and ran `wip/proof/apply.py`, which is the implementer's recorded application of the entry's prose. I spot-checked it against the prose of `define-contract-wrapper-builds-data-type-lookup` and `comments-name-removed-apis`. Then I ran biome on the three changed files, as the entry's opening instruction says ("run the package's formatter"). Step 4 (`git status --porcelain` over the non-test paths) prints nothing. Step 5 (`git diff --exit-code` of the test paths against the base, and untracked test files) exits 0 with no output. Step 6 then runs the tip's own extension tests, since the non-test files are byte-identical to the tip: pgvector 191, postgis 129 and arktype-json 53 pass. The implementer's `ext-step6.log` also shows all ten `packages/3-extensions/*` suites passing. App flow, from the logs: `app-emit.log` re-emits `examples/prisma-8-demo-sqlite`, `app-step4.txt` is empty, and the example has no `test` script, so `app-typecheck.log` (clean) stands in for step 6.
- S1-f-R1-2: closed. The entry adds `parameter-casts-use-base-names`, `resolve-identity-value-receives-data-type` and `contract-to-schema-takes-components`, each with before and after code and a detection pattern.
- S1-f-R1-3: closed. `vector`, `geometry` and `pgGeometryColumn` call the new `validateSqlTypeParams(type, params)`, which is the old private `validatedParams` exported, so the data type's `params` is the only bound (design 2.4). The helpers now raise `CONTRACT.TYPE_PARAMS_INVALID`, the design 2.3 code for parameters a data type refuses, in place of `ARGUMENT_INVALID`. With the three helper files set back to their parent commit, 5 pgvector and 8 postgis new assertions fail, including SRID 0 (I checked), so the tests were able to fail.
- S1-f-R1-4: closed. Both stack snippets and the `createPostgresAdapter` call pass `dataTypes`.

`99da8c769a` changes only comment lines in eight extension source files. Every changed line is inside a comment, and it touches no test. Checks at `2f23721797`: root typecheck, `lint:agent`, `check:error-reference` (360) and `check:upgrade-coverage --mode pr --prev bot/data-types-completion` exit 0; `@internal/sql-contract` has 482 tests passing. Every commit carries both sign-offs and no AI attribution.

### S1-f-R2-1 (low): the app entry does not mention the column helpers' new refusal

- Where: `upgrade-instructions/pending/data-types-declare-names/app/instructions.md`.
- What is wrong: applications call `vector(n)` from `@prisma/orm-extension-pgvector/column-types` and `geometry({ srid })` from `@prisma/orm-extension-postgis/column-types`. A bad argument now throws `CONTRACT.TYPE_PARAMS_INVALID`, not `CONTRACT.ARGUMENT_INVALID`, and `srid: 0` is now refused when the contract is authored. Before, the contract built and the column failed later, when the migration planner wrote it. An application that tests for the old code, or that has an SRID of 0, sees a change the app entry does not describe.
- Change: add an app entry naming both helpers, the new code, and the SRID bound of 1 or more. Detect it with `CONTRACT\.ARGUMENT_INVALID` near those imports, or `srid\s*:\s*0\b`.

### Dispatch f round 3 status of the round 2 finding

- S1-f-R2-1: closed. The app entry `column-helpers-raise-type-params-invalid` names `vector(length)`, `geometry({ srid })` and `pgGeometryColumn({ srid })`, the change from `CONTRACT.ARGUMENT_INVALID` to `CONTRACT.TYPE_PARAMS_INVALID`, and that `srid: 0` is refused when the contract is built. It detects both `CONTRACT.ARGUMENT_INVALID` and `srid: 0`. Its `meta` claim (`{ dataType, parameters }`) matches `validateSqlTypeParams` in `sql-data-type.ts:245-250`. `check:upgrade-coverage --mode pr` exits 0 against both `bot/data-types-completion` and the default base. The commit carries both sign-offs and no AI attribution.

### S1-rf1-R1-1 (low): the Postgres facade's refusal of a duplicate data type has no test

- Where: `packages/3-extensions/postgres/src/contract/define-contract.ts` (`assemblePostgresDataTypeLookupWithBuiltins`); the only test of the new behaviour is `packages/3-extensions/sqlite/test/contract-builder/data-type-assembly.test.ts`.
- What is wrong: `3cc2ea28e3` and `0dc997cd07` changed both facades so that the data type lookup is assembled once, with the duplicate check. Before, the Postgres facade built its lookup with `createDataTypeLookup`, which accepts a duplicate id. The SQLite facade has a test that an extension registering `sqlite/text` is refused with `CONTRACT.DATA_TYPE_DUPLICATE`. No test does the same for Postgres, and no Postgres test mentions `DATA_TYPE_DUPLICATE`, so a return to `createDataTypeLookup` in the Postgres facade would pass every test.
- Change: add the same test for the Postgres `defineContract`, with an extension that registers `pg/text`.

### S1-rf1-R1-2 (low): the Mongo TypeScript helpers build a data type lookup without the duplicate check

- Where: `packages/2-mongo-family/2-authoring/contract-ts/src/contract-builder.ts:1101`.
- What is wrong: `aa360b5595` made `AuthoringEntityContext.dataTypeLookup` required, and the Mongo helpers now fill it with `createDataTypeLookup(components.flatMap(...))`. That is the construction CR-F05 removed from the SQL facades: with a duplicate id, `get` returns the last type and `all()` returns both. Item 5 of the brief named only the SQL facades, so this is not a scope breach, but it brings the same pattern back in a new place.
- Change: use `assembleDataTypes(components).lookup` from `@internal/framework-components/control`, which refuses a duplicate id.

### Review fixes round 2 status of the round 1 findings

- S1-rf1-R1-1: closed by `ca0de95478`. The Postgres `defineContract` test registers `pg/text` from an extension and expects `CONTRACT.DATA_TYPE_DUPLICATE` naming `duplicate-text`. It passes at the parent too, because the behaviour already existed; the test pins it.
- S1-rf1-R1-2: closed by `c409a672b8`. The Mongo helpers use `assembleDataTypes(components).lookup`. The new test registers `mongo/string` twice and expects `CONTRACT.DATA_TYPE_DUPLICATE`; it would pass silently with `createDataTypeLookup`, so it was red at the parent.
- Upgrade proof: `wip/proof2/` (on `f4e89409e0`) and `wip/proof/` (on `ca0de95478`, `steps.txt`). Steps 4 and 5 print nothing and exit 0 for both audiences. Step 6: the extension suites pass (postgres 257, pgvector 188, postgis 124, sqlite 55, supabase 102, mongo 150; 68 of 68 turbo tasks), and the SQLite demo re-emits and typechecks cleanly.
- `@internal/mongo-contract-ts` (131) and `@internal/postgres` (257) pass. Both commits carry both sign-offs and no AI attribution.

### S1-rf2-R1-1 (must-fix): the postcheck's keyword list leaves out 69 keywords that Postgres quotes

- Where: `packages/3-targets/3-targets/postgres/src/core/sql-utils.ts` (`RESERVED_KEYWORDS`, `quoteIdentifierWhereNeeded`); tests in `packages/3-targets/3-targets/postgres/test/migrations/node-issue-planner.test.ts`.
- What is wrong: Postgres `quote_identifier` quotes every keyword that is not unreserved: reserved, column-name and type-or-function-name keywords. The set holds 95 words, a copy of the deleted `formatUserDefinedTypeName` list. I checked it against PGlite (Postgres 18.3) with `pg_get_keywords()` and `quote_ident` (`wip/rf2-review/probe/kw.mjs`, `kw.log`): Postgres quotes 164 keywords, and 69 are missing from the set, including `position`, `time`, `interval`, `values`, `row`, `none`, `cross`, `returning` and `system_user`. No word in the set is one Postgres leaves unquoted. PGlite prints `format_type` of an enum named `position` as `"position"`, so a planned type change to that enum still fails its postcheck, the failure CR-F02 asked to remove. The doc comment says "reserved keyword", which is also the wrong rule, and none of the four test cases uses a keyword.
- Change: make the set every keyword whose `pg_get_keywords()` category is not `U`, taken from the newest Postgres the target supports, and rename it to match (for example `QUOTED_KEYWORDS`). Say in the doc comment that it quotes every keyword that is not unreserved. Add planner test cases for a reserved word (`select`) and a column-name keyword (`position`), both expecting the quoted name.

### S1-rf2-R1-2 (low): both targets' `data-type-entries.ts` still import the runtime lanes package

- Where: `packages/3-targets/3-targets/postgres/src/core/data-type-entries.ts:16-21`, `packages/3-targets/3-targets/sqlite/src/core/data-type-entries.ts:11-16` (`createNumberClassifier`, `parseJsonBody`, `printJsonBody`, `signedRange` from `@internal/sql-relational-core/ast`).
- What is wrong: both files are in shared-plane entries of `architecture.config.json`, and `packages/2-sql/4-lanes/**` is runtime plane. SD-F01 named these lines. Item 3 moved only `numeralText` and `isNonFiniteText`, as the brief asked. The import predates the slice (it is in both files at `bot/data-types-completion`); the slice only added the Postgres file to the shared map. I accept it for this slice.
- Change: add a line to `projects/data-types-completion/deferred.md`: move the four PSL value helpers out of the lanes layer so the shared data type entry files stop importing a runtime package.

### S1-rf2-R1-3 (low): the round 1 ruling on the enum postcheck is now wrong

- Where: `projects/data-types-completion/slices/1/plan.md`, "Review fixes round 1 rulings".
- What is wrong: it says an enum column that references a `types {}` entry is now unquoted in the postcheck. Item 1 changed that, and the plan does not say so.
- Change: add a line to the round 2 ruling that the postcheck now quotes an enum name as `format_type` prints it, replacing the round 1 ruling.

### Review fixes 2 round 2 status of the round 1 findings

- S1-rf2-R1-1: closed by `9d4437193f`. `POSTGRES_QUOTED_KEYWORDS` in `postgres-keywords.ts` has 164 words and equals the set `quote_ident` quotes in PGlite 0.5.4 (Postgres 18.3), with nothing missing and nothing extra (`wip/rf2-review/probe/kw2.log`). A test compares it with `pg_get_keywords()` where `catcode <> 'U'`. The planner cases `select` and `position` expect the quoted names. The PGlite dev dependency is `0.5.4`, a version the lockfile already has; the lockfile diff adds only the importer entry. The new file has a shared-plane map entry.
- S1-rf2-R1-2: closed by `6b99abad7d`, a line in `deferred.md`.
- S1-rf2-R1-3: closed by `6b99abad7d`, a line in `plan.md` saying the round 1 ruling is replaced.
- Checks, logs under `wip/rf2-review/`: `lint:deps` exits 0; the Postgres target typechecks, and its tests pass (142 files, 2,784 tests). Both commits carry both sign-offs and no AI attribution.

### Review fixes round 1 status of the code review findings

All 19 items of `wip/briefs/review-fixes-1.md` are built as written. Code review F01 to F09 and system design F01, F03 to F09 and F11 to F15 are closed. Details in the round note.

### S1-rf3-R1-1 (low): the codec authoring guide does not list the new codec check

- Where: `docs/reference/codec-authoring-guide.md`, "Assembly is strict" (items 1 to 8), and the paragraph under "Declaring a data type" that ends "has no name to write".
- What is wrong: `2e2bfb4018` makes assembly refuse a SQL stack in which a codec represents a data type that is not a `SqlDataType`. Extension authors read this guide to learn what assembly refuses, and its list stops at item 8. The earlier paragraph still describes the old failure, a column whose type has no name to write when a migration is planned, which the check now prevents.
- Change: add item 9 to the second list: in a SQL stack, a codec represents a data type not declared with `sqlDataType`; `sql/expression` is the one data type no column has. Replace the "has no name to write" sentence with one saying that a SQL stack in which a codec represents such a type is refused at assembly.

### Review fixes 3 round 2 status of the round 1 finding

- S1-rf3-R1-1: closed by `a8e36d4744`. Item 9 of "Assembly is strict" says the error names the codec, its data type and the data type's contributor, which is what `enforceSqlDataTypeInvariants` throws (an `InternalError`, as the list's introduction says). The reworded sentence in "Declaring a data type" says assembly refuses a codec of a type declared with plain `dataType`, and that `sql/expression` is such a type, which matches `isSqlDataType` and `sql-expression.ts`. The commit also makes `slices/1/pr-body.md` identical to the published copy on the slice 2 branch, closing the round 1 referral. `lint:docs` exits 0 (`wip/rv3/lint-docs-r2.log`). Both sign-offs, no AI attribution.

### S1-rf4-R1-1 (must-fix): the extension upgrade entry does not cover the new arguments of `deriveJsonSchema`

- Where: `upgrade-instructions/pending/data-types-declare-names/extension/instructions.md`. `deriveJsonSchema` and `derivePolymorphicJsonSchema` in `packages/2-mongo-family/2-authoring/contract-psl/src/derive-json-schema.ts`, exported from `@internal/mongo-contract-psl`. The Mongo extension's call at `packages/3-extensions/mongo/test/mongo.enum.e2e.test.ts` line 91.
- What is wrong: On `main` both functions take `valueObjects?, codecLookup?, valueSets?` after their fields. Now they take a required `lookups: MongoTypeLookups` second, and `codecLookup` is no longer a later argument. The Mongo extension's own test had to change its call, earlier in slice 1 and again in `9552aeabbd`. No entry describes the change, so an extension author who calls either function gets a type error and no instruction. Design 6 says the entry covers every change an extension author sees, and the published 0.14-to-0.15 guide recorded the last signature change of these two functions (`mongo-derive-json-schema-value-sets-param`). `check:upgrade-coverage` passes because it checks only that a declaration exists.
- Change: add an entry, for example `mongo-derive-json-schema-takes-lookups`: the second argument is a required `{ codecLookup, dataTypeLookup }` (`MongoTypeLookups` from `@internal/mongo-contract/data-type`), and the codec lookup moves into it. Detect `deriveJsonSchema` and `derivePolymorphicJsonSchema` as the 0.14-to-0.15 entry does. Add its prose section with a call before and after.

### S1-rf4-R1-2 (must-fix): five test names still number the design's rules, and a rewritten comment keeps project ids

- Where: `packages/2-sql/1-core/contract/test/sql-data-type.declare.test.ts` lines 80, 122, 173, 212 and 241: `describe('rule 1: …')` to `describe('rule 6: …')`, with no rule 5 block. `test/integration/test/extension-pgvector-scenario-a.e2e.integration.test.ts` line 49: `(project AC5 / AC10 / TC-16)`, in the sentence slice 1 rewrote.
- What is wrong: "rule 1" to "rule 6" are the numbered rules of design 2.2. The code does not number them (`sqlDataType`'s comment says "a rule of the module"), so on `main` the numbers point into a deleted document, and the gap at 5 reads like a missing test. Ruling 6 asked for a sweep of the whole slice diff, and these lines are in it. `AC5`, `AC10` and `TC-16` are token shapes `.agents/rules/no-transient-project-ids-in-code.mdc` forbids; they came from `main`, but slice 1 rewrote the sentence that carries them.
- Change: drop each `rule N: ` prefix and keep the property after it. Drop `(project AC5 / AC10 / TC-16)` from the rewritten sentence.

### S1-rf4-R1-3 (low): the contract builder's inner functions still accept a missing codec lookup

- Where: `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts` lines 116 to 118 (`columnCodec`), 191 to 195 (`codecForDefault`), 241 (`encodeColumnDefault`), 568 to 570 (`encodeEnumMembers`) and 601 (`checkMemberValues`).
- What is wrong: This is the class of SD F05, in a file ruling 5 did not name. Slice 1 made `buildSqlContractFromDefinition` require both lookups, and every caller of these functions passes the required codec lookup. Each still takes `CodecLookupWithDescriptors | undefined` and, when it is missing, skips encoding or the stored-as-written check. The code is `main`'s; slice 1 made the branches dead.
- Change: make the parameter required and delete the `undefined` branches, or record it in `deferred.md` beside slice 2's item for the local `TypeLookups` in this file.

### S1-rf4-R1-4 (low): one ADR 241 consequence still says constructors carry native storage names

- Where: `docs/architecture docs/adrs/ADR 241 - Scalar types use the authoring type-constructor channel.md` line 79.
- What is wrong: The rewritten bullet says a SQL target "defines its PSL-only constructors, the native storage names and codec bindings". A constructor names only a codec; line 47 of the same ADR says the type's name comes from the data type.
- Change: "It defines its PSL-only constructors, which bind PSL type names to codecs, and its adapter contributes them."

## Round notes

### Review fixes 4, round 1

Scope: `7835641a20..a5550c2793`, the merge of `main` (`57675308d6`, TML-3283, and ADR 258) and 11 commits, against `wip/briefs/s1-fixes.md` and the round 4 findings (SD F01 to F07, CR F01 to F03, referrals).

The merge: `git show --remerge-diff 7835641a20` shows the two conflicts only. `pg/bytea` keeps `texts: [writtenAndCatalog('bytea')]` and gains `main`'s `pgByteaCanonical` as both its canonical form and its cast from text. Slice 1's `dateTimeType` takes `main`'s name `typeCanonicalFromText` and keeps slice 1's `spec` argument, so every date and time type keeps its texts. `pgvector/vector` keeps `params` and `texts` and gains `toCanonicalForm: vectorCanonicalForm`. The auto-merged `codec-helpers.ts`, `prisma7-binding.ts` and the control adapter's output settings equal `main`'s change. `codec-literal-defaults.integration.test.ts`, the one test file both sides changed, keeps `main`'s two titles and two `expect` calls plus slice 1's data type lookup argument. TML-3283 changed no planner file, the golden manifest is unchanged in the range, and the golden test passes.

Item by item:
- 1 (`936e2b29d1`): the marks are on the four text constructors, `INFERRED` follows, and the tests are (a), (b) and a third: every constructor `EXISTING_COLUMN_DATE_TIME_TYPES` names is marked. Red: with the four marks moved back by a temporary edit, and the target rebuilt for the adapter test, (a), the third test and (b) fail, naming exactly `Date`, `Time`, `Timestamp` and `Timestamptz`. Reverted, rebuilt, green. Design 12.4, 13.4, the new 13.8 and the first slice 3 grep row follow the ruling; `CODEC_ID_BY_INFERRED_TYPE` is gone from `main`'s packages and from the row.
- 2 (`beba4228d4`): as asked. The sweep finds no other text that puts slice 1 on the planning branch, and no link into a gitignored path. `inventory/data-types.md` lines 8, 10 and 61 name raw outputs under the gitignored `wip/data-types-inventory/` as code spans. They record how the inventory was made, and the inventory is deleted at close-out, so I leave them.
- 3 (`1f23426887`): as asked. The keys test moved from the adapter to the target. One leftover phrase in ADR 241: S1-rf4-R1-4.
- 4 (`760c6a68dd`): `DataTypeLookup` and `createDataTypeLookup` now equal `main`'s. The upgrade entry `data-type-lookup-lists-all` described a method slice 1 added and now removes, so deleting it is right. Design 2.7 item 1 and 5.2 agree.
- 5 (`9552aeabbd`): no optional codec lookup and no `?.` on one is left in the SQL interpreter's `src`; the deleted `InternalError` in `storedValueReader` was the runtime form of the same off-switch. Mongo takes one required `MongoTypeLookups`. No test passes `undefined` lookups (the `undefined` arguments are `valueObjects`), and the four touched test files keep their test and `expect` counts. The same class remains in the contract builder (S1-rf4-R1-3), and the new signature has no upgrade entry (S1-rf4-R1-1).
- 6 (`38939d1005`): the eighteen listed names are fixed; the sweep finds more (S1-rf4-R1-2).
- 7 (`ba1680c374`, `a02e566ecc`): matches `control-instance.ts` line 451 and ADR 254 line 206. Item 10's `CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION` is raised only from `enforceSqlDataTypeInvariants`. The extension entry says the same.
- 8 (`c3c2cbc2c2`): moved unchanged.
- 9 (`72379647c7`): the Mongo comment as asked. The referral's premise for `authoring.ts` was wrong: `columnFromEntity` still returns `nativeType`, which the TypeScript `pg.enum` helper reads (`packages/3-extensions/postgres/src/contract/native-enum.ts` line 168). The new comment is accurate: the PSL path reads only `typeParams` (`EntityRefColumnFromEntityResult`), and the type name comes from the `pg/enum` data type. Accepted.
- 10: verify compares `resolvedNativeType`, which `contractToSchemaIR` writes as `renderSqlTypeName(type, normalize(params))` and introspection writes through `normalizeSchemaNativeType`. The implementer's probe (`wip/logs/f10-alias-probe.test.ts.txt`, not in the tree) compares the first with the second applied to each declared catalog text, for 24 Postgres data types and 36 parameter sets. All 36 agree, including `bigint`, `double precision`, `character varying(5)`, `time(3) without time zone` and `timestamp(3) with time zone`. No code change, as the brief says.

Rules: no `any`, no bare `as` in production code, no import extension, no zod, no `@ts-expect-error`, no test name with "should". The new comments are the moved or rewritten doc comments the rulings asked for. Every commit carries both sign-offs and no AI attribution.

Checks at `a5550c2793`, logs under `wip/rv/`: typecheck passes in the 16 touched packages. Touched test files, one package at a time: framework-components 66, mongo contract-psl 51, contract-prisma7 15, mongo extension 20, pgvector 48 (with `main`'s `vector-list-default` integration test), postgis 14, target-mongo 27, target-postgres 630 (20 skipped by `main`'s `runIf`), target-sqlite 69, adapter-postgres 49 (with `main`'s three TML-3283 integration files), adapter-sqlite 7. The SQL contract-psl suite alone: 648. `lint:deps` finds no violation, `lint:framework-vocabulary` is at 262 of 262, and `lint:docs` and `check:upgrade-coverage --mode pr --prev bot/main` exit 0. The golden planner test passes (694) and `main`'s `bytea-defaults` journey passes (6). The slice 1 grep check prints nothing. Only the two golden fixture `contract.json` files differ from `bot/main`. I did not rerun `fixtures:check`; the implementer's run exits 0 (`wip/logs/final-fixtures.log`).

### Review fixes 3, round 1

Scope: `c3f36b3369..e5641a42ce`, 10 commits, against `wip/briefs/s1-review-fixes-3.md` and the round 3 findings (SD-F01 to SD-F07, CR-F01 to CR-F04).

Item by item:
- 0: `07218254e0` copies spec, design, plan, design notes, deferred and `slices/1` from the slice 2 branch; slice 1 had no `handover.md`. Against `bot/tml-3388-data-type-in-contract` today, the copies differ only by this round's edits and by `slices/1/pr-body.md` (referral below).
- 1 (CI journey): `3005905d76`. On `main` the journey's `VarChar(0)` was refused by the adapter's length hook, which slice 1 deleted. It is now refused by step 1 of `renderSqlTypeName` (design 2.3) with `CONTRACT.TYPE_PARAMS_INVALID` and `meta: { dataType: 'pg/varchar', parameters: ['length'] }`, which is the error 2.3 asks for. The journey still tests its purpose: `db init`, `db update` and `migration plan` each exit 2 with the library's structured error, not `CLI.UNEXPECTED`, and the scenario (a contract emitted earlier or edited by hand) still arises. The example in the `caught-errors.ts` doc comment follows the new code. Red first: the CI failure on the merged tip.
- CR-F01: `bf366aa6ef`. The unit test pins `numeric(10,0)`, `numeric(10,2)` and `character(1)`; the integration test applies `Numeric(10)` and `Numeric(10, 2)`, verifies strictly and plans no change. Design 3.4 is amended. Rule 6 is in `sqlDataType` with three tests, and design 2.2 states it. Every Postgres, SQLite, pgvector and postgis declaration runs rule 6 when its module loads, and their tests pass. `pg/enum` (kind claim) and `pg/text-array` (no texts) are exempt; the probes of `pg/numeric`, `pg/char`, `pg/bit` and `postgis/geometry` each meet a written text. One existing test fixture changed `srid?` to `srid` to satisfy the rule; that test is about `display`, so it loses nothing. The commit is typed `test:` although it adds rule 6.
- CR-F02, SD-F07: `40c9c40fba`. `sqlDataType` spreads the framework declaration; `MongoDataTypeSpec` extends `DataTypeSpec`; one test per factory compares the result without its family facts with the output of `dataType`, using `casts` and `toCanonicalForm`.
- CR-F04: `d7a12317fe`.
- SD-F06: `c43866f20f`. The ranges are inline in `pgNumericParams`; `numeric-limits.ts` and its `./codecs` export are gone; the guide's example now shows a scale from -1000.
- SD-F04: `904a16c23c`. ADR 241 (lines 11, 15, 63, 79 and the example) and ADR 254 line 214 state the rule and the reason. The Postgres comment is restored. SQLite's `type-constructors.ts` is a move with no content change. The adapter's set is `postgresPslTypeConstructors`. Neither set is exported anywhere new.
- SD-F03, SD-F05: `2e2bfb4018`. One function takes `declaredDataTypes` and `codecDescriptors` and runs the collision, `sql/expression` cast and codec checks; the Postgres control adapter uses `stack.dataTypeLookup`. No shipped codec trips the codec check. Every codec of the Postgres and SQLite targets, arktype-json (`pg/jsonb`), pgvector and postgis names a `sqlDataType` declaration, and paradedb and supabase have no codecs. A probe (`wip/rv3/assembly-probe.mjs`) runs `family.create` on the Postgres stack with arktype-json, pgvector, postgis and paradedb (43 codecs, 29 data types) and on the SQLite stack (12 codecs, 10 data types) without error. The guide does not list the check: S1-rf3-R1-1.
- SD-F01: `57d1139066`. Both files moved with their tests; new entry `@internal/sql-contract/data-type-support` with tsdown, README and the three public shells; no re-export left in `relational-core/src/exports/ast.ts`; every user of the 14 names imports the new entry. `codec-helpers.ts` is mapped shared, and everything both targets' `data-types.ts` and `data-type-entries.ts` import is now shared. The deferred line is gone. The two new upgrade changes are accurate: at `bot/data-types-completion` every listed name was exported from `@internal/sql-relational-core/ast` and both constants from `@internal/target-postgres/codecs`, and `pgNumericParams` is exported from `./data-types`. `git diff c3f36b3369..e5641a42ce -- packages/3-extensions examples` is empty, so not rerunning the upgrade validation is right.
- SD-F02 and the document edits: `e5641a42ce`. Design 1, 2.2, 3.2, 3.4, 5.2, 10.4, 12.1 and 12.2, and spec 6, 7, the non-goals and "Closes", as asked. `design-notes.md` is unchanged in the range, and the edits keep Will's rulings: a data type never parses or prints SQL value literals (Q14, TML-3283), SQLite's column types are what SQLite stores, and constructors are defined in the target and contributed by the adapter.

Mutations, each restored and the tree clean afterwards: removing the codec loop fails 3 tests; removing the call in `createSqlFamilyInstance` fails 4 (collision, codec, and both `sql/expression` cast cases); removing rule 6 fails 1; copying the fields one by one again fails 2; dropping `normalize` in `schemaTypeText` fails the new unit test.

Rules: no `any`, no bare `as` in production code, no test name with "should"; the new doc comments are the ones the findings asked for. No `contract.json`, `contract.d.ts` or golden changed. Every commit carries both sign-offs and no AI attribution.

Checks at `e5641a42ce`, logs under `wip/review-s1-merge/wip/rv3/`: 15 touched or affected unit test files, run one at a time, pass (478 tests). Typecheck passes in mongo-contract, sql-contract, relational-core, family-sql, target-postgres, target-sqlite, adapter-postgres, cli and the integration package. `lint:deps` (no violations), `lint:agent` and `check:upgrade-coverage --mode pr --prev bot/data-types-completion` exit 0. `stale-contract-default.e2e.test.ts` passes (2 tests, in both the integration and packaging projects) and `psl-defaults-apply-and-verify.integration.test.ts` passes (16). The implementer's `test:packages` run failed only tests that fail under load or in this environment (three tarball tests on a pnpm trust policy, telemetry, two language server files, the adapter round trip); each rerun alone passed, except the tarball tests, which fail before any code of this repository runs.

Referral (orchestrator): `slices/1/pr-body.md` on this branch is older than the description published on the slice 2 branch (`45bee502b9`). It lacks the codec check under "Assembly checks" and the `Numeric(10)` line under the behaviour changes. Copy the published text over if the slice 1 pull request carries `projects/`.

### Review fixes, round 2

Scope: `774cb701bf..7bece37e1a`, 10 commits (the dispatch said 11): one per item of `wip/briefs/review-fixes-2.md`, plus `9931528e4d` (a test type fix for item 2) and `7bece37e1a` (upgrade entry).

Item by item:
- 1 (CR-F02): a kind-claiming data type now takes `unquotedSqlBaseName`, split on `.`, each part through `quoteIdentifierWhereNeeded`. The pattern `^[a-z_][a-z0-9_]*$` matches Postgres's rule (the old one wrongly allowed `$`). The four cases (`UserRole` and `user_role`, with and without `typeRef`) assert `formatTypeExpected`; the two `UserRole` cases were red at the parent, which returned the unquoted name. The test header names TML-3387, which the rules allow. `wip/pr-notes.md` has the line. The keyword list is incomplete: S1-rf2-R1-1.
- 2 (CR-F01): `readProps` returns `undefined` when arktype throws. The union and the piped object are tested for both key readers and for `sqlDataType`, which now refuses with an `InternalError` naming the id. Both were red at the parent (raw `ParseError`). `9931528e4d` adds `as never` in a test file only.
- 3 (SD-F01): `numeral-text.ts` in `@internal/sql-contract`, exported from `./data-type`; every importer re-pointed; design 3.2 says "stays unmapped". See S1-rf2-R1-2.
- 4 (SD-F02): `assembleDataTypes` lives in `shared/data-type.ts`, exported from `./codec` only. The three Postgres lookup functions are gone from `codec-registry.ts` and `./codecs`; `createPostgresBuiltinDataTypeLookup` is in `data-types.ts`, used by the serializer, the PSL inferrer and the testkit. The adapter no longer re-exports it; tests import from `@internal/target-postgres/data-types`. The adapter's other two re-exports (`createPostgresBuiltinCodecLookup`, `createPostgresCodecRegistryWithBuiltins`) predate the slice.
- 5 (SD-F03): `AuthoringEntityContext.codecLookup` is required; every builder passes one. `bsonTypesOfCodec` takes `MongoTypeLookups`. `deriveJsonSchema` keeps its optional codec lookup, the round 1 deferral.
- 6 (SD-F04): both functions take `SqlDataType` and data type parameters; the caller list is gone; the ruling line is in `plan.md`. See S1-rf2-R1-3.
- 7 (SD-F05): renamed; no `sqlComponentTypes` or `assemblePostgresDataTypeLookup` remains outside project docs.

Rules: no `any`, no bare `as` in production code, no test name with "should". Every commit carries both sign-offs and no AI attribution. No `contract.json`, `contract.d.ts` or golden changed.

Upgrade proof, `wip/r2c/`: every check in `summary.log` exits 0, including `fixtures:check:agent`, `lint:docs`, `lint:throws` and the framework vocabulary (262 of 262); `ext-step6.log` shows 68 of 68 extension test tasks passing; the tree was clean afterwards and `wip/proof-checkout` is removed.

Checks at `7bece37e1a`, logs under `wip/rf2-review/`: `typecheck:agent`, `lint:agent`, `lint:deps`, `check:error-reference` (360) and `check:upgrade-coverage --mode pr --prev bot/data-types-completion` all exit 0. The slice 1 grep check prints nothing. The golden planner test passes (684). The integration subset passes (34 files, 242 tests). The 20 touched packages' tests: 68 of 69 tasks pass; `@internal/adapter-postgres` failed only the two round-trip tests that time out under load, as in round 1, and that file passes alone (5 of 5).

### Review fixes, round 1

Scope: `01925ee865..f4e89409e0`, 20 commits, one per item of `wip/briefs/review-fixes-1.md` plus `f4e89409e0` (upgrade entry). The two docs commits after it (`36a07405da`, `5453754750`) are the orchestrator's.

Item by item:
- 1 (CR-F01): `substitute` refuses a value that is not a safe integer with `CONTRACT.TYPE_PARAMS_INVALID` and `meta: { dataType, parameters: [name] }`, for both written and catalog texts. The test uses a string parameter carrying `1); DROP TABLE users; --`; it was red at the parent, which returned the text. `sqlBaseName` substitutes nothing, so it needs no check. The guide says a `render` hook must quote every value it writes.
- 2 (CR-F02): the registry refuses a codec whose data type the lookup lacks, with `CONTRACT.DATA_TYPE_UNREGISTERED`, a `why`, a `fix` and `{ codecId, dataType }`. `createPostgresAdapter({ codecDescriptors: [descriptor] })` throws at construction.
- 3 (CR-F03, SD-F06): `buildStorageColumn` validates every column after `typeRef` resolution and adds `modelName` and `fieldName`. A `storage.types` entry no column uses is not checked (tested). `git grep validateSqlTypeParams` in production source finds only `sql-data-type.ts` and `build-contract.ts`, so no column helper checks on its own. The `type.*` helpers keep `CONTRACT.ARGUMENT_INVALID`. Tests cover `varcharColumn(0)`, `numericColumn(2000)`, `vector(0)`, `pgGeometryColumn({ srid: 0 })` and `geometry({ srid: 0 })` through `defineContract`. Both upgrade entries say the helpers no longer throw and the build does. The error reference states the PSL, `type.*` and contract-build mapping under `CONTRACT.TYPE_PARAMS_INVALID` and points to it from `CONTRACT.ARGUMENT_INVALID`. The new `blindCast` reason is true: `materializeCodec` calls `validateCodecTypeParams` before the factory.
- 4 (CR-F04): the planner test asserts `formatTypeExpected: 'bigint'` for an `int8` alias column. It passes at the parent too, because the branch was already unreachable; it pins the behaviour. The branch, `formatUserDefinedTypeName` and its tests are gone; `wip/pr-notes.md` names the change. The enum postcheck consequence is the recorded ruling.
- 5 (CR-F05): one assembly in both facades and both extension contracts. See S1-rf1-R1-1.
- 6 (CR-F06): all three messages as asked. The table and column are added in `contractToSchemaIR`, which the planner calls. The framework `objectSchemaProps` also gained an `extends('object')` check, needed so that `type('string')` is refused with the id.
- 7 (CR-F07): `columnDataType` throws `InternalError`; `DefaultLiteralColumn.dataType` is required. The control adapter now calls the exported `renderArrayLiteralDefault` directly. The test was red at the parent.
- 8 (CR-F08, SD-F15): `requiredSchemaKeys` is the one reader; the serializer's copy is deleted. The three arktype shapes are tested for both key readers.
- 9 (CR-F09): `storedTemporalText` takes the data type id; `TemporalNativeType` and the name pairs are gone; the bytea list type is `sqlBaseName(pgBytea, {}).toUpperCase()`.
- 10 (SD-F03): `findSqlDataTypeCollision(types)` is the one function; `claimingSqlTexts` and `sqlTypeTextsCollide` are private. `enforceSqlDataTypeInvariants` reads `stack.dataTypeLookup.all()`. The new test puts a colliding type only in the lookup, so walking the contributors would miss it; with the call removed, the earlier `createSqlFamilyInstance` test fails.
- 11 (SD-F04, SD-F11): renamed; the doc comment names the difference from `sqlBaseName` and the three consumers. `renderSqlColumnTypeName` is deleted; its one other user, the codec testkit, calls `renderSqlTypeName`.
- 12 (SD-F07): no field or parameter typed `DataTypeLookup` is named `dataTypes`; `SqlComponentTypes` is gone; design 3.4 and 3.5 say `dataTypeLookup`.
- 13 (SD-F08): `PostgresCodecRegistry` is `CodecRegistry & PostgresCodecDescriptorRegistry`. The control and runtime descriptors and `createPostgresAdapter` assemble the lookup, then the registry against it, and pass both on.
- 14 (SD-F09): `type.mongo.bsonTypes`, `'mongo' in type`, entry point `@internal/mongo-contract/data-type` with tsdown and public mirrors, `AuthoringEntityContext.dataTypeLookup` required, design 2.6 and 3.5 amended. The Mongo enum factory also separates the two diagnostics. See S1-rf1-R1-2.
- 15, 16: done. ADR 205's historical example keeps the old constant name under its update note.
- 17 (SD-F14): the templates' `paramsSchema` is `undefined`; the template type did not need to change.
- 18 (SD-F01): the Postgres entry lists `data-types.ts`, `data-type-entries.ts`, `sql-utils.ts` and `errors.ts`, the import closure (`errors.ts` imports only the shared `@internal/errors`). SQLite's `src/exports/data-types.ts` is shared.
- 19 (SD-F05): ADR 241's example matches the Postgres `VarChar` and `String` constructors; ADRs 155, 184, 202, 204 and 207 carry the note; ADR 208 carries the update.

Rules: no `any`, no bare `as` in production code, no new comments, no test name with "should". Every commit carries both sign-offs and no AI attribution. No `contract.json`, `contract.d.ts` or golden changed in the range.

Checks at `5453754750`, logs under `wip/rf1-review/`: `typecheck:agent`, `lint:agent`, `lint:deps`, `lint:docs`, `check:error-reference` (360), `check:upgrade-coverage --mode pr --prev bot/data-types-completion`, `lint:framework-vocabulary` (262 of 262), `lint:throws` (40 = 40) and `fixtures:check:agent` (tree clean afterwards) all exit 0. The slice 1 grep check prints nothing. The golden planner test passes (684). The touched integration files pass (8 files, 82 tests). The tests of all 24 touched packages pass; in `@internal/adapter-postgres` two round-trip tests timed out under load and pass alone (5 of 5). I did not rerun the upgrade entries' validation by execution and found no log of it under `wip/`; `f4e89409e0` suggests it ran. The orchestrator should confirm it from the implementer's report.

### Dispatch f, round 1

Scope: `4b33205e76..ddb0814c42` (`42441fc4dd` docs, `938ae7197b` upgrade entries, `ddb0814c42` test fix).

Docs. ADR 171 carries "Status: Superseded by ADR 254" and the index row reads "**Superseded by ADR 254.**", the convention of rows 044 and 162. ADRs 186, 205, 208, 213, 224, 241 and 254 and the Mongo subsystem doc now describe data types, not `targetTypes` or `expandNativeType`. The guide gains "Declaring a data type" and loses the rendering hook section. I compared every new snippet with the code. `pgNumericParams`, `pgNumeric`, `pgEnum`, `postgisGeometry`, `pgvectorVector` and the `postgresCodec(sqlTextDescriptor, …)` adapter are the code's own text. The `pgInt2`/`pgInt4` example spells out what the code writes with helper functions. I copied the complete declarations into `wip/review-f1/snippets/snippets.ts` and typechecked them against the workspace packages: exit 0. The snippets with `// …` or with helpers they do not define (`quoteIdentifier`, `elementNumber`) are excerpts, which the guide does not claim to be copy-pasteable. Only the stack snippets are wrong (S1-f-R1-4).

The coordinator's questions:
1. Snippets: see above.
2. The extension entry: every item on the design 6 list is covered, plus the `defineContract` lookups, listing extensions, runtime `dataTypes`, `DataTypeLookup.all` and the removed `validateScalarTypeCodecIds`. Three changes are missing (S1-f-R1-2). Skipping the byte-for-byte proof is not acceptable: the skill makes it a merge requirement (S1-f-R1-1). It can be done now or before the pull request opens, but the pull request must not merge without it.
3. The app entry: it is required, because the diff since `bot/data-types-completion` changes `examples/prisma-8-demo-sqlite/src/prisma/contract.d.ts`, and `check:upgrade-coverage` maps `examples/` to the app audience. It says both true things: list every extension whose codec a TypeScript contract uses (`CONTRACT.CODEC_DESCRIPTOR_MISSING` otherwise), and re-emit SQLite contracts for the `sql/char@1` and `sql/varchar@1` aggregate rows, with no change to `contract.json`, hashes or migrations. The import path `@prisma/orm-extension-pgvector/pack` exists, and `examples/prisma-8-demo` uses it.
4. `pgGeometryColumn` accepting SRID 0 is a finding for this slice: S1-f-R1-3, should-fix.
5. The `contract-builder.test.ts` fix is the right end state. A codec id no pack registers cannot name a column type, so the build refuses it with `CONTRACT.CODEC_DESCRIPTOR_MISSING`, as dispatch d decided. The test asserts the code and the message, and it drops the `as any` and its biome-ignore. It passes (18 tests).
6. Checks at `ddb0814c42`, logs under `wip/review-f1/`. `lint:docs` exits 0 (its warnings are about READMEs this slice does not touch). `lint:throws` exits 0 (40 = 40). `check:error-reference` lists all 360 codes. `check:upgrade-coverage --mode pr` passes against both `bot/data-types-completion` and the default base. The ADR index row for 171 is correct. The postgis tests pass.

Every commit carries both sign-offs and no AI attribution.

### Dispatch e, round 1

Scope: `f8903ee5dc..c7965f6d86`. Every brief item is built, with the three rulings in the slice plan applied. The slice's grep check over `packages` (tests included) is empty. The only goldens changed are the three allowed: `codec-instance.json` (now `CONTRACT.CODEC_DESCRIPTOR_MISSING`, a structured planner error), and the unquoted typeRef columns in the Postgres fixture (`"character"`, `"uuid"`) and core-surface (`"text"`). Every other golden is byte-identical. No `contract.json` or `contract.d.ts` changed.

The coordinator's questions:
1. Marker `invariants`: right. The table DDL comes from the literal `text[]` in `control-bootstrap.ts`, which is unchanged. The ledger table has no list column. The old codec cast the parameter as `$N::text[]` and passed the array through. `pg/text@1` with `many: true` renders the same `$N::text[]`, and the runtime encodes each element with the text codec, which is the identity. So the row written is the same. `extension-pgvector-scenario-a` writes and reads a marker's `invariants` in PGlite and passes. `pg/text-array@1` is still registered, with its data type, in `codecs.ts` and `aggregates.ts`.
2. List identity value: right, and it is a fix. Before, a contract list column reached `resolveIdentityValue` with its element's native type (`codecBaseNativeType`, for example `text`), so a NOT NULL `text[]` column added to a non-empty table got `DEFAULT ('')`, which Postgres refuses as a malformed array literal. Only the old `pg/text-array@1` test column, whose native type was `text[]`, got `'{}'`. No golden could show this: the goldens plan from an empty schema, and the temporary default is used only when a NOT NULL column is added to an existing table. The pull request should mention it as a behaviour change. `tsvector` lost its built-in identity value, but no stack registers `pg/tsvector@1`.
3. `SAFE_WIDENINGS`: right. `typeChangeCallStrategy` returns early unless `fromContract` is set, and the only caller that sets it is offline `migration plan`, which builds the prior schema with `contractToSchema(fromContract)`. That schema carries `codecRef` on every column. Reconciliation (`db init`, `db update`, aggregate plan) passes `fromContract: null`. Verify never reaches the strategy.
4. Scenario A: acceptable. Design 2.4 makes `length` required, and a PGlite domain cannot take `vector(3)`. The plan test still has the `vector(3)` column and still asserts that the extension install comes before the app table, which is the point of the scenario. The apply test lost only the vector value round trip. The wording is stale: S1-e-R1-2.
5. Cast tests: the `$1::int4` test fails against the base renderer, which wrote `$1::integer` (the old `adapter.test.ts` expectation shows it). The `varchar(255)` list test passes against the base too, because the old `pg/varchar` hook ignored its parameters. It is still a real guard: with `sqlBaseName` swapped for `renderSqlTypeName`, it fails (I checked). Not a finding.
6. Goldens and fixtures: as above. `fixtures:check:agent` exits 0 with a clean tree.
7. Grep: empty.

Checks I ran at `c7965f6d86`: root typecheck, `lint:deps`, `lint:agent`, `check:error-reference` (360 codes) and `lint:framework-vocabulary` (262 = 262) exit 0. Tests of all 34 touched packages pass. Integration: the golden planner test plus `test/integration/test/authoring/` (26 files, 832 tests) and the 13 touched integration files (174 tests) pass. I did not run the full integration or e2e suites, as Will ruled. Every commit carries both sign-offs and no AI attribution. There is no `any` and no bare cast in production code. The planners' native type identifier check is gone with the code. That is safe: every written name now comes from a declaration whose literal characters `sqlDataType` restricts, or from an enum name that `render` quotes.

### Dispatch d, round 2

Checks: framework-components 800 and family-sql 406 tests pass; root typecheck and `check:error-reference` exit 0. All three commits carry both sign-offs and no AI attribution.

### Dispatch d, round 1

Scope: `7565a8f8f9`, `45fe7b6423` and `28773fa5f1..ecca4f2409`. Every brief item is built. Writers: `buildStorageColumn`, raw `storage.types`, the `type.*` helpers, PSL `types {}` aliases and the Prisma 7 reader all write `storedSqlTypeNameOfCodec`, which is `sqlBaseName` of the data type with `dataTypeParams`, or `typeParams.typeName` for a `claimsKind` type. The value-object column keeps `jsonb`. `postgresQualifyColumnType` now qualifies only `typeName`, and the stored name follows from it. `buildSqlContractFromDefinition` requires both lookups. `ColumnTypeDescriptor.nativeType` is optional and unread. No template carries `nativeType`. The `inferred` marks equal design 13.4 for the constructors that exist (tested both ways), and SQLite, Mongo and `sql.String` carry none. Mapped arguments lose `minimum` and `maximum`; `nanoid` keeps 2 to 255; the temporal `precision` bound is gone. PSL reports a bound at the argument with `PSL_INVALID_ATTRIBUTE_ARGUMENT` (offset asserted); TypeScript helpers report `CONTRACT.ARGUMENT_INVALID`, as other argument errors do. Every 2.4 edge I checked has a test. `validateScalarTypeCodecIds` is deleted. Nothing from dispatch e is in the diff.

The implementer's five open decisions:
1. Both lookups required, and the facades build them from the target and the listed extensions. This follows from design 4 and is fine. It is the only application-visible change: a `contract.ts` that uses an extension codec without listing the extension now throws (see S1-d-R1-3). Dispatch f should mention it in the app-audience declaration if `check:upgrade-coverage` asks for one.
2. The Mongo warning drops "(stored as BSON X)". Fine; the replacement name, which the brief asked for, stays.
3. Skipping a codec whose schema is not an arktype object is fine. Skipping a codec with no schema is wrong: S1-d-R1-1.
4. Bounds are checked when the template has `typeParams`, including literal ones. With no `typeParams` there is nothing to check. Fine.
5. `InternalError` for the new checks is what design 5.1 says; using it for 5.2 too is consistent, because both are pack-author errors. Fine.

None of these is a design gap.

Vocabulary: `scripts/lint-framework-vocabulary.mjs:142-148` fails when the count is below the threshold and tells the author to lower it. The count is 262, so lowering 272 to 262 is required.

Checks I ran at `ecca4f2409`: root typecheck, `lint:deps`, `lint:agent`, `check:error-reference` and `lint:framework-vocabulary` (262 = 262) exit 0. `fixtures:check:agent` exits 0 with a clean tree. The first two runs hit the 300 s timeout under load from other sessions; the killed run left two retail-store migration files reformatted with identical JSON, which I restored. The golden planner test passes: 684, goldens unchanged. No `contract.json`, `contract.d.ts` or golden changed. Tests of the 17 touched packages pass (Postgres adapter 907 with 3 expected fails). The implementer's full `test:packages` log also shows one Postgres adapter round-trip test timing out at 8 s; it passes in my run. Rules: no `any`, no bare `as` in production code, no test name with "should", both sign-offs on every commit, no AI attribution. Tests and code share commits, but every new check and bound test asserts a refusal the old code did not make.

### Dispatch c, round 1

Declarations. SQLite matches design 2.6: seven types, each with one text marked written only. `sqlite/character` (`character` W) and `sqlite/character-varying` (`character varying` W) have an optional integer `length` of at least 1. `normalize` removes `length` (design 2.5), and each casts from `sqlite/text` unchanged. The existing casts are unchanged. Nothing claims: `data-type-declarations.test.ts` checks that each declared text resolves to `undefined`. Mongo matches: `mongoDataType(id, { bsonTypes, params?, casts? })` and `isMongoDataType` are in `mongo-contract/src/mongo-data-type.ts`. The twelve `bsonTypes` lists equal each codec's `targetTypes`, with eight for `mongo/json` and none for `mongo/bson`. `mongo/vector` has an optional `length` of at least 1 (design 2.4). The tests of every pack fail for a missing or extra registration, and check each codec's `paramsSchema` against its data type's `params` by identity.

Registration and constructors. `dataTypes` is in the SQLite target's `descriptor-meta-runtime.ts`, which the control meta spreads; the adapter registers none (tested). The moved scalar constructors are the same text; only the import path changed to `./codec-ids`. The order is `BigIntNumber`, then the scalars, the same as target-then-adapter before (tested).

The duplicate. `sql/char@1` is registered twice only in `sqlite-codec-registry-composition.test.ts:391-400`, where a test extension contributes a codec with that id. Before, the adapter's metadata left `sql/char@1` out, so the stack's duplicate check did not see the collision and the SQLite registry refused it at `create`. Now the adapter's metadata lists it, so the stack refuses the same input first, with `Duplicate codec descriptor for codecId "sql/char@1"`. The runtime path still gives the SQLite message. Nothing that worked now fails; only the step and the message changed for input that was already refused. No extension in the repository contributes either id.

`mongo/vector@1` is now parameterised, and nothing observable changes. No Mongo package reads `isParameterized` or `paramsSchema`, and the Mongo runtime never calls a codec factory per field. `factory` still hands out the one shared codec. The control stack's representative codec comes from `factory({})`, which still succeeds. `forCodecRef` used to refuse any `typeParams` for this codec as unexpected, and now validates them. That only permits more. No committed contract uses `mongo/vector@1`. The Mongo contract, target and adapter tests pass: 176, 664 and 330.

The `.d.ts` diffs are exactly the accepted rows. Five files gain four lines each: `sql/char@1` and `sql/varchar@1` under `min` and `max`. Nothing else changed, and no `contract.json` changed. Every emitted SQLite `contract.d.ts` in the repository has the rows. `packages/3-targets/3-targets/sqlite/test/fixtures/sqlite-contract.d.ts` is an older hand-kept file with no aggregate section, and is not touched. The golden test is unchanged (684 passed), so the `CHARACTER` and `CHARACTER VARYING` DDL still matches.

Dependency. The SQLite target adds `"arktype": "^2.2.2"`, the same specifier as the Postgres target. The lockfile gains only the three-line importer entry, resolving to 2.2.3, which the lockfile already held. That is what `pnpm install` writes; nothing else in the lockfile moved.

Rules: no `any` and no bare cast. The one new comment, above the two character codecs, says why they render no TypeScript type. Test names are fine. Every commit carries both sign-offs. My scan for attribution matched only "Regenerated with pnpm" in `806c08cfc4`; there is no AI attribution. `fixtures:check`, typecheck and `lint:deps` exit 0.

### Dispatch b, round 2

Package tests: target 2701, pgvector 197, postgis 121. Commit `006f164312` carries both sign-offs and no AI attribution.

For dispatch f: `check:upgrade-coverage --mode pr` requires a new declaration for each audience whose directory the pull request touches (`scripts/check-upgrade-coverage.mjs:311-329`): `examples/` for apps and `packages/3-extensions/` for extensions. Design 6 now says slice 1 has no app-audience instruction. If dispatch e edits anything under `examples/` (design 3.3 names `examples/prisma-8-demo/src/app/ContractView.tsx`), the check will also require an app-audience declaration. Dispatch f must then add one that states apps have nothing to change.

### Dispatch b, round 1

Declarations: each `pg/*` row matches design 2.6 exactly: texts, marks, the order of texts, no `display` on Postgres types, `claimsKind` only on `pg/enum`, and `pg/text-array` with nothing. The 2.4 bounds match. The 2.5 normal forms are on `pg/numeric`, `pg/char` and `pg/bit` only. `pgNumericParams` uses `.narrow` for "scale needs a precision"; I checked that its `props` still list both keys, so `dataTypeParams` and rule 1 keep working. The `render` of `pg/enum` splits at the first dot and quotes with `quoteIdentifier`, as 11.3 says. pgvector (`vector({length})` W C, 1 to 16000, required) and postgis (`geometry` W C; `geometry(geometry,{srid})` W C with display; `srid` at least 1) match. Casts and list casts are unchanged.

Tests: `data-type-declarations.test.ts` fails for a registered type with no entry and for an entry with no registered type. `data-type-texts.test.ts` has every row of inventory 1.3 as a writing, catalog and read-back case; every claiming text in lower case, upper case and with extra spaces; the only-written texts; `"char"`, `bpchar`, `interval year to month`; and `normalize` twice equals once. Parameters are checked through the codecs: the bounds test turned red 11 times against the old schemas (`wip/logs/b-bounds-red.log`). Its coverage test would fail if a data type without parameters gained a schema.

Codec schemas: every codec the target ships is checked with `toBe` against its data type's `params`, and `isParameterized` against whether that exists. pgvector and postgis check the same with `toBe`. The codec classes point at the exported constant (`pgNumericParams` and so on), which is the same object as `pgNumeric.params`; the identity test would catch a mismatch. `postgresCodec` now takes the data type object and uses its `params`. The runtime still validates and builds per column from the full `typeParams`. arktype does not strip undeclared keys, and `arktype/json@1` (data type `pg/jsonb`, no `params`) keeps its own schema, so the codec's own keys still reach the factory.

`pg/unboundedint@1` taking the numeric parameters is harmless. The `UnboundedInt` constructor takes no arguments, so PSL cannot write them; only a hand-written TypeScript descriptor can. A column without `typeParams` still passes: `validateCodecTypeParams` validates `typeParams ?? {}`, and `{}` fits. The `sum` aggregates that produce this codec resolve through the same resolver with `{}`. The visible change: a hand-written `{ precision: 10 }` used to fail at runtime (parameters on a codec that takes none) and is now accepted; after dispatch e it would be written `numeric(10)`, which fits its data type. The design could say once that a codec cannot narrow its data type's parameters.

Constructor move: the block removed from the adapter's `control-mutation-defaults.ts` and the block added to the target's `authoring.ts` are identical text. The only extra lines are the two spreads. The target's namespace is `BigIntNumber, UnboundedInt, pg`, then the scalars, then the native types. Before, the stack merged the target (first three) and then the adapter (scalars, natives), in descriptor order family, target, adapter. So the assembled order, and with it `scalarTypes` and completion, is unchanged; `type-constructors.test.ts` asserts that order. The removed adapter tests reappear in the target (documentation, `TimestamptzJsDate`, the inferred-type binding). The moved names were never exported publicly, and the column helpers are untouched. `dataTypes` is in `descriptor-meta-runtime.ts`, which the control meta spreads, so both planes register it; the adapter registers none (tested).

The stub adapter in `psl-infer/infer-psl-contract-described-contracts.test.ts:561` is justified. The target's data types now have casts, the stack's writability check needs value entries for their sources, and the real adapter still carries those entries until dispatch d. Remove that line when dispatch d moves the entries to the target.

The four `test:packages` failures are environmental. Three tarball tests fail in `pnpm install` on a registry trust check ("High-risk trust downgrade for @vercel/detect-agent@1.2.5"). The telemetry e2e test times out under load and passes alone (`wip/logs/b-telemetry.log`, 4 passed). Typecheck, the golden test (684 passed), `fixtures:check` (clean diff), `lint:deps` and biome all exit 0. Commits carry both sign-offs and no AI attribution. There is no `any` and no bare cast. The one new `blindCast` in `codec-descriptor.ts` gives a true reason.

For the orchestrator (not a finding in this dispatch): `check:upgrade-coverage --mode pr` requires a new extension-audience declaration under `upgrade-instructions/pending/` for any diff in `packages/3-extensions/`, and this dispatch changes pgvector and postgis. Slice 1 also breaks extension authors' code. `postgresCodec`, public at `@prisma/orm-target-postgres/target/codec-descriptor` and `@prisma/orm-postgres/target/codec-descriptor`, now takes the data type object, and dispatch e deletes `targetTypes` and the `expandNativeType` hooks. The design and plan mention upgrade instructions only for slice 2. The design should say that slice 1 ships an extension-audience instruction, written in dispatch f.

### Dispatch a, round 2

Can the golden test miss a DDL change? No, for every contract that plans today: the comparison is one `toBe` on the whole rendering. `wip/logs/golden-red.20260930-002407.95458.log` shows it turning red when only the extension lists changed. `plannerError` catches only structured errors thrown by `plan()`. A contract that plans today and fails later changes its golden from `success` to `plannerError`, so the test fails. Any other error still throws. `extensionsNotLoaded` changes only the extension list, and the planned output is compared in full. None of the nine contracts with an unloaded pack has a column whose codec comes from that pack. The 46 `unreadable` contracts and the one `plannerError` contract have no DDL at the base, so there is nothing in them to change.

How the SQLite fixture got goldens for `sql/char@1` and `sql/varchar@1`: today neither `createControlStack` nor `deserializeContract` checks a column's codec against the registry, and the SQLite planner writes the contract's `nativeType` upper-cased. So the hand-written descriptors plan without the codecs registered. `examples/prisma-8-demo-sqlite` already works this way. After dispatch e the planner finds the data type through the codec. If dispatch c has not registered both codecs (design 2.7 item 9), those goldens break, which is the right signal.

Commit `01a3f1c8b3` added `typeParams: {}` to two aliases in the Postgres fixture's `contract.ts`. The emitted `contract.json` still has no `typeParams` on `Code` and `Id`, `wip/logs/emit-pg.log` re-emitted it at 00:36, and the tree is clean. So the emitter drops an empty `typeParams`, and the fixture and its golden agree.

Rules: no `any`, no bare casts in production code, and no test name uses "should". The one new comment (the TS2742 import in the fixture) explains an import that would otherwise look unused. Every commit from `a41f377b5b` to `2c1a3335d4` carries both sign-offs and no AI attribution. I read the implementer's logs for typecheck, `lint:deps`, `check:error-reference`, biome, framework-components (787), Prisma 7 provider (14) and the golden run (684, exit 0). I spent no `pnpm` run.

For later dispatches:
- The `plannerError` golden for `packages/3-targets/3-targets/postgres/test/fixtures/snapshot-read-shapes/codec-instance.json` quotes the `expandNativeType` message. Dispatch e deletes that hook, so this golden will change even though no DDL changes. Re-record it with the diff shown in the report; this is not the DDL halt condition. After dispatch e the stack for that contract has no `pg/vector@1` codec. If the planner then fails with a plain `Error`, not a structured one, the test throws. Dispatch e should make that failure a structured error.
- The text-preparation branch for double quotes has no observable effect while 2.7 item 2 refuses quotes in declared texts. It is kept because 2.7 item 3 asks for it.
- `pg/char@1` appears only with a `length`. The data type `pg/char` without a length is covered through `sql/char@1`, and rendering depends only on the data type.

### Dispatch a, round 1

Scope: nothing from later dispatches. There are no real declarations, no deletions, and no planner, adapter or runtime changes. The public `package.json` mirrors are build output. `architecture.config.json` needs no change: `packages/2-sql/1-core/**` is already shared. Commits carry no AI attribution and both sign-offs. There is no `any`, no bare `as` in production code (`as const` only), and no test name uses "should". The framework change adds no family vocabulary: the count is 272 with a threshold of 272. I read the implementer's logs for package tests, typecheck, `lint:deps`, `check:error-reference`, framework vocabulary and the golden compare; all are green. I spent no `pnpm` run.

Hand walks, all correct:
- `pg/numeric` with `{precision: 10}`. Writing: validate; `normalize` gives `{precision: 10, scale: 0}`; the raw keys are `[precision]`, all kept; the written text for `{precision}` gives `numeric(10)`. Catalog: the normal-form keys are `[precision, scale]`; the catalog text gives `numeric(10,0)`.
- `pg/timestamptz` catalog text `timestamp({precision}) with time zone` with `{precision: 3}` gives `timestamp(3) with time zone`. Resolving that text gives the pattern `^timestamp\((\d+)\) with time zone$` and `{precision: 3}`. The only written texts are `timestamptz` and `timestamptz({precision})`, which do not claim.
- postgis `geometry(geometry,{srid})` with display `geometry(Geometry,{srid})`. Writing and catalog use the display, giving `geometry(Geometry,4326)`. Resolving lower-cases outside quotes, giving `geometry(geometry,4326)`, which matches with `srid` 4326.

Module against design 2.2, 2.3 and 11.2: every rule of 2.2 is enforced with an `InternalError` naming the id. 2.3 follows the design step by step: the raw parameters are used for writing, with only the keys `normalize` removes dropped; the normal form is used for the catalog; `display` is used in both. 11.2 follows the design: a kind claim does not consult texts; text preparation, whole-text match, schema check and normal form on return are all there. Findings 4, 5 and 9 are the only deviations.

Golden test: it builds a real control stack, deserializes each contract, and calls the Postgres or SQLite planner's `plan()` from an empty schema with `INIT_ADDITIVE_POLICY`. It records every operation's precheck, execute and postcheck SQL, and compares the whole rendering as one string with `toBe`, so any change fails. It also fails on a missing or stale golden. The goldens contain no machine paths. Recording the 46 old-format snapshots as `unreadable` is acceptable: no code at the base can plan them, the refusal is committed, and a change in it would show. Plans from an empty database do not cover `ALTER COLUMN TYPE` DDL or `SAFE_WIDENINGS`. Dispatch e must rely on the existing planner tests for those.

Undocumented choices. All are sound. The design should record these:
1. `resolveReportedSqlType(reported, dataTypes: readonly DataType[])`. The stack cannot supply that list today: `ControlStack` exposes only `dataTypeLookup` (`get`, `has`; `packages/1-framework/1-core/framework-components/src/control/control-stack.ts:88,853`), and it drops `assembleDataTypes(...).declared`. Dispatch d needs the list too, because `enforceSqlDataTypeInvariants(stack)` (design 5.2) must compare every pair of SQL data types. The design should say how the stack exposes it, for example `ControlStack.dataTypes: readonly DataType[]` taken from `declared`.
2. Text preparation leaves quoted text exactly as reported, whitespace included, and keeps a space before `,`. The design should either state this or also remove spaces before `,`.
3. "Lower case" applies to the literal parts of a text. Placeholder names are the exact `params` keys and may be camelCase. The literal characters are `a-z 0-9 _ space ( ) , . "`.
4. `sqlBaseName` of a type with no written text and no `render` throws `InternalError`. `renderSqlTypeName` of the same type throws `CONTRACT.TYPE_PARAMS_INVALID` ("it is never written").
5. `renderSqlCatalogText` of a kind-claiming type throws `InternalError`. When no catalog text fits, it throws `CONTRACT.TYPE_PARAMS_INVALID` with `<id> cannot be reported with parameters [..]; it is reported with [...]`.
6. `texts: []` next to `claimsKind` is refused.
7. The kind path returns `fromReported`'s result without checking it against the schema or normalising it, and gives `{}` when there is no `fromReported`. The design should say whether that is intended.
8. If S1-a-R1-9 is taken: `sqlBaseName` checks parameters only for a type with `render`.

For later dispatches (not findings here):
- `packages/3-extensions/pgvector/src/contract.json` has `storage.types.vector` with codec `pg/vector@1`, no `typeParams`, and `nativeType: "vector"`. Design 2.4 makes `length` required, so `renderSqlTypeName` would refuse it. `sqlBaseName` still gives `vector`, so the section 4 writers are fine. Nothing plans a column from it today.
- `packages/3-extensions/pgvector/test/migrations/planner.behavior.test.ts:246-270` plans columns with `pg/text-array@1` (never written, per 2.6) and `pg/tsvector@1` (no such codec is registered), using `nativeType`. Once the planner finds the data type through the codec (dispatch e), these tests need a decision. The design does not cover them, so this may be a halt condition in dispatch e.
- Slice 2 renames every snapshot directory, so the golden file names change. Slice 2's plan should say how it shows that DDL is unchanged, for example by comparing `planned` for each contract path without the hash.
- Resolver tests over the real declarations are due in dispatch b: every claiming text of 2.6, `"char"`, `bpchar`, `interval year to month`.
- The props-reading helper duplicates `postgres-contract-serializer.ts:100-121`. Acceptable for now.

## Orchestrator notes

### Orchestrator note, dispatch a round 2 (2026-09-30)
- Implementer slice1-implementer-2 (Opus) finished round 2: commits 38e59dd701 to 01a3f1c8b3; all nine findings reported fixed; checks green (logs in the report under `wip/`).
- Design fixed from its report: section 4 now says a `claimsKind` type stores `typeParams.typeName` unquoted; section 2.7 item 9 has dispatch c register `sql/char@1` and `sql/varchar@1` on SQLite.
- NEXT: send round 2 to the reviewer (commits `a41f377b5b..01a3f1c8b3`). Then dispatch b.
- Stopped here on the usage limit.
