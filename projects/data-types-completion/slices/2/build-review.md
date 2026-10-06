# Code review: slice 2 (TML-3388)

Reviewer-maintained. Contract: `projects/data-types-completion/design.md` sections 7 to 10. Plan: `projects/data-types-completion/slices/2/plan.md`.

## Subagent IDs

- Implementer: slice 2 implementer (Opus), dispatch a round 1
- Reviewer: slice 2 reviewer (Opus), persistent, started 2026-09-30 for dispatch a round 1

## Scoreboard

| Dispatch | Round | Verdict |
| --- | --- | --- |
| a | 1 (`fa4cbba1ee`, `c8e638387f`, `8e7eb4f82f`, `e8bd655435`, merge `75b971783e`) | ANOTHER ROUND NEEDED: 1 must-fix, 1 should-fix, 4 low |
| a | 2 (`a99f5b13cd..dc527c4502`) | ANOTHER ROUND NEEDED: S2-a-R1-1 to S2-a-R1-6 closed; 1 new must-fix, 1 new low |
| a | 3 (`feac9e4922`, `daed46c3c2`) | SATISFIED: S2-a-R2-1 and S2-a-R2-2 closed, no new finding |
| b | 1 (`ffecde3bde`, `650a4f2d32`) | SATISFIED: no finding; 2 design gaps for the orchestrator |
| b | 2 (`0c7ccebe6d`) | SATISFIED: the ruled JSON default gap is closed, no finding |
| c | 1 (`3190ecd3bd`, `dda8c4e356`, `596626b778`, `ae59f32967`, `190e4c7c28`, `4797502384`, `187c1a572c`, `d8eb478422`) | SATISFIED: 1 low; notes for dispatch f |
| c | 2 (`91e087fc09`) | SATISFIED: S2-c-R1-1 closed, no new finding |
| d | 1 (`dee5832fd2`, `86ce42fb16`) | ANOTHER ROUND NEEDED: 2 should-fix; 1 design gap |
| d | 2 (`02642c08c1`, `54b62a3e30`, `809938fa82`) | SATISFIED: S2-d-R1-1 and S2-d-R1-2 closed, the ruled option built, no new finding |
| e | 1 and 2 (`813a092bc5`..`da192ec6ab`, implementer commits only) | ANOTHER ROUND NEEDED: 1 must-fix |
| e | 3 (`40bde80ebb`, `5ffb0d42f6`) | SATISFIED: S2-e-R1-1 closed, no new finding |
| f | 1 (`8819d89a73`, `b237abc245`, `a8cbeacfb9`, `a1438656e8`, `625fa4411a`, `16f4682c19`) | ANOTHER ROUND NEEDED: 4 must-fix, 1 should-fix, 1 low |
| f | 2 (`0e325b563a`, `a359d8c43e`, `71a218f46e`, `a68d3a22fa`, `dc4e090968`, `cb85a39d8c`) | SATISFIED: S2-f-R1-1 to S2-f-R1-5 closed; S2-f-R1-6 waits for the base merge; no new finding |
| review fixes 2 | 1 (`c408e56420..ffb85f8f86`) | ANOTHER ROUND NEEDED: 1 must-fix, 2 low; the 16 items and the five manual QA defects closed; S2-f-R1-6 closed |
| review fixes 2 | 2 (`ee348bc3a8`, `adc4da5fbe`, `78b09700d0`) | SATISFIED: S2-rf2-R1-1 to S2-rf2-R1-3 closed, no new finding |

## Findings log

### S2-a-R1-1 (must-fix): a new bare cast in the contract validator

- Where: `packages/2-sql/1-core/contract/src/validators.ts:539-542` (`validateSqlContractStructure`).
- What is wrong: `(value as { storage?: unknown }).storage` is a new bare `as` in production code. `CLAUDE.md` forbids it.
- Change: `value` is already known to be a non-null object at that point, and `isPlainRecord` is imported in the file. Read the key with `isPlainRecord(value) ? value['storage'] : undefined`.

### S2-a-R1-2 (should-fix): two expected print refusals leave out the new `dataType` meta key

- Where: `test/integration/test/psl-print/every-postgres-contract-roundtrip.integration.test.ts`, the entries for `packages/3-extensions/pgvector/src/contract.json` (`types.vector`) and `test/integration/test/ports/engines/queries/data_types/native/postgres/_fixture/string/generated/contract.json` (`"public"."Child"."bit"`).
- What is wrong: `refuseColumnWithoutPslType` (`packages/3-targets/3-targets/postgres/src/core/psl-print/refusals.ts:61-67`) now puts `{ coordinate, dataType, codecId }` in meta. The test compares `meta` exactly. Commit `8e7eb4f82f` removed `nativeType` from these two entries without adding `dataType`, while the merge `75b971783e` wrote `dataType: 'pg/bit'` in the planner golden entry. The test cannot run until dispatch e regenerates the contracts, and then these two entries fail.
- Change: add `dataType: 'pgvector/vector'` and `dataType: 'pg/bit'` to the two entries. Dispatch e confirms both when the test runs.

### S2-a-R1-3 (low): the builder does not validate the parameters of a `storage.types` entry

- Where: `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts:1665-1672` and `authoring-helper-runtime.ts:54-68`.
- What is wrong: design 7.3 says the builder adds `dataType` and validates the parameters against the codec's `paramsSchema`, throwing `CONTRACT.ARGUMENT_INVALID`. The implementation validates when the `type.*` helper is called (unchanged from slice 1) and the builder only adds `dataType`. A hand-written `types` entry, such as `{ kind: 'codec-instance', codecId: 'pg/vector@1', typeParams: { length: 0 } }`, that no column uses is built without any check. A column that references it is checked by `validateColumnTypeParams` with `CONTRACT.TYPE_PARAMS_INVALID`.
- Change: validate each `documentTypes` entry in `buildSqlContractFromDefinition` against its codec's `paramsSchema` with `CONTRACT.ARGUMENT_INVALID` and the path `types.<name>`, with a test. Or, if the orchestrator rules that the helper is the one validation point, record that in design 7.3.

### S2-a-R1-4 (low): skipping a codec the stack does not know has no test

- Where: `packages/2-sql/9-family/src/core/contract-stack-checks.ts:48-51`, `packages/2-sql/9-family/test/control-instance.deserialize-contract-stack.test.ts`.
- What is wrong: a column or storage type whose codec the stack does not register passes the data type check. No test fixes this, so a later change could start refusing such contracts (or stop skipping them) without a test failing.
- Change: add a test that deserializes a contract with an unregistered codec and expects it to be accepted by this check.

### S2-a-R1-5 (low): test helpers pair columns with data types that do not exist

- Where: the `codecId.replace(/@\d+$/, '')` helpers in `packages/2-sql/9-family/test/contract-to-schema-ir.test.ts:126`, `packages/2-sql/9-family/test/field-event-planner.test.ts:19`, `packages/3-targets/6-adapters/sqlite/test/migrations/planner.codec-field-event.test.ts:18`, `packages/2-sql/5-runtime/test/{codec-integrity,codec-mapping-validation,same-bare-table-name,sql-context.codec-context}.test.ts`, `packages/2-sql/4-lanes/relational-core/test/{codec-descriptor-registry,codec-ref-for-column}.test.ts`, `packages/2-sql/4-lanes/sql-builder/test/runtime/same-bare-table-name.test.ts`, and three `sql-orm-client` tests.
- What is wrong: removing `@N` gives a wrong data type for any codec whose id differs from its data type's: `sql/char@1` becomes `sql/char` (the real one is `pg/char` or `sqlite/character`), `pg/vector@1` becomes `pg/vector` (real: `pgvector/vector`), and likewise `sql/int@1`, `pg/timestamptz-temporal@1` and `arktype/json@1`. `contract-to-schema-ir.test.ts` uses `sql/char@1` and `pg/vector@1` this way. No test relies on the wrong pair today: `contractToSchemaIR` takes the data type from the codec, `isAlteration` returns before comparing `dataType` when the codec differs, and the runtime never reads `dataType`. But these contracts would be refused by `deserializeContract`, so a test that later passes one through it or through the junction check would test invalid data. `createContractTable` in `packages/2-sql/9-family/test/schema-verify.helpers.ts:76-88` is safe: it refuses to guess for the four temporal types, its tests use only `pg/int4`, `pg/text` and `pg/varchar` (whose `@1` codecs represent them), and the `app/enum` entry names its codec.
- Change: take the data type from the codec's descriptor (`descriptor.dataType`) through a shared test lookup, or write the data type id explicitly in each test.

### S2-a-R1-6 (low): two stale sentences

- Where: `packages/3-targets/6-adapters/postgres/src/exports/column-types.ts:4` ("provide both codecId and nativeType"); `packages/3-targets/3-targets/postgres/src/core/codec-helpers.ts:29,51` (`typeName: typeName`, which can be the shorthand `typeName`).
- Change: rewrite the comment to say the descriptors provide the codec id; use the shorthand. `test/utils/README.md:130` still shows `nativeType`; dispatch f's README pass covers it.

### Dispatch a round 2 status of the round 1 findings

- S2-a-R1-1: closed (`a99f5b13cd`, `isPlainRecord`).
- S2-a-R1-2: closed (`c92fb6560f`).
- S2-a-R1-3: closed by ruling (`slices/2/plan.md`: the `type.*` helper is the one validation point).
- S2-a-R1-4: closed (`95dc5e74c4`).
- S2-a-R1-5: closed (`74bd975257`), except the file named in S2-a-R2-2.
- S2-a-R1-6: closed (`dc527c4502`).

### S2-a-R2-1 (must-fix): two new tests do not typecheck

- Where: `packages/3-targets/6-adapters/sqlite/test/descriptor-meta.test.ts:36` (TS18048, `sqliteTargetDescriptor.authoring` is possibly undefined); `packages/3-extensions/sqlite/test/contract-builder/value-object-storage.test.ts:55` (TS2559, the SQLite pack has no properties in common with `CodecContributor` in the call to `assembleSqliteCodecRegistry`).
- What is wrong: both tests pass under vitest, which does not typecheck them, but `@internal/adapter-sqlite#typecheck` and `@internal/sqlite#typecheck` now fail. Neither failure comes from a committed `contract.d.ts`, so the branch tip does not meet the dispatch's typecheck requirement.
- Change: use `authoring?.` in the first test. In the second, pass the target descriptor that `assembleSqliteCodecRegistry` expects, as the Postgres version of the test does. Then run both packages' `typecheck`.

### S2-a-R2-2 (low): one explicit map disagrees with its own test lookup

- Where: `packages/2-sql/9-family/test/contract-to-schema-ir.test.ts:44-53`.
- What is wrong: the file's codec lookup (lines 96-103) says `sql/char@1` represents `test/character`, `pg/text@1` represents `test/text`, and so on. The new map says `pg/char`, `pg/text`, `pgvector/vector`. So every test column pairs a codec with a data type that the test's own stack says it does not represent. No assertion depends on it, because `contractToSchemaIR` takes the data type from the codec.
- Change: delete the map and take `dataType` from `dataTypeOfCodec[codecId].id`.

### Dispatch a round 3 status of the round 2 findings

- S2-a-R2-1: closed (`feac9e4922`). `authoring?.` in the adapter test; the SQLite pack test uses `createSqliteBuiltinCodecLookup()`.
- S2-a-R2-2: closed (`daed46c3c2`). Columns take `dataType` from the test's own codec lookup; the `test/unknown@1` column, which the lookup does not know, names its data type explicitly.

### S2-c-R1-1 (low): a failed `ROLLBACK` hides the error that caused it

- Where: `withTransaction` in `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts:503-517` and `packages/3-targets/6-adapters/sqlite/src/core/control-adapter.ts:434-448`.
- What is wrong: when `fn` throws and `ROLLBACK` then also throws (a dropped connection), the `ROLLBACK` error propagates and the marker write error that caused it is lost.
- Change: when `ROLLBACK` throws, rethrow the original error (for example with the rollback failure as its `cause`, or by ignoring the rollback failure), with a test on each adapter.

### Dispatch c round 2 status of the round 1 finding

- S2-c-R1-1: closed (`91e087fc09`). When `ROLLBACK` throws, the original error is rethrown with the rollback failure as its `cause` (if it had none). Two tests per adapter; both adapter test files pass (4 and 4).

### S2-d-R1-1 (should-fix): nothing keeps the script's copied hash rules equal to the real ones

- Where: `upgrade-instructions/pending/data-type-in-contract/test/generate-fixtures.ts` and `test/data-type-in-contract.test.ts`.
- What is wrong: the generator computes every `after` hash with the real `recomputePublishedStorageHash` and `computeMigrationHash`, and the test compares the script's output with those trees. That proves the copy equal to the real rules on these fixtures on the day they were generated. No test runs the generator again or recomputes the committed hashes with the real functions. If the real hashing changes, for example during dispatch e or a later fix, the fixtures and the script stay equal to each other and the tests stay green while the script writes hashes the framework no longer computes. The fixtures are small, so they also cover few of the canonicalization rules the copy reproduces (empty-value omission paths, sorted index and check arrays, namespace `kind` removal).
- Change: add a test in a package that can import the internal functions (for example under `test/integration`) that reads every `after` fixture and asserts that the real `recomputePublishedStorageHash` with `sqlContractCanonicalizationHooks` gives each contract's stored hash (its snapshot directory name or `storage.storageHash`), and that `computeMigrationHash` gives each `migration.json`'s `migrationHash`. Dispatch e's proof on the repository's own projects then covers the wider shapes.

### S2-d-R1-2 (should-fix): both instruction files leave out two things the user must know

- Where: `upgrade-instructions/pending/data-type-in-contract/{app,extension}/instructions.md`.
- What is wrong: neither file tells the user to run their formatter afterwards, although the script replaces text in `migration.ts` and `contract.d.ts`, so line wrapping can differ from a fresh emit. Neither file says that the script rewrites every `*.json` under the root that parses as a SQL contract (skipping `node_modules`, `.git`, `dist` and `build`), so a test fixture of an old contract kept on purpose is rewritten too.
- Change: add both to each file: commit first; run the formatter after the script; restore any old-format fixture that must stay old with git (or keep such fixtures outside the project root). The design text of 10.2 (`db sign`, extension release order, the `$1::int4` change) is dispatch f's.

### Dispatch d round 2 status of the round 1 findings

- S2-d-R1-1: closed (`02642c08c1`). `test/integration/test/upgrade-instructions/data-type-in-contract-hashes.test.ts` checks every `after` contract with the real `createSnapshotContentVerifier(sqlContractCanonicalizationHooks)`, which recomputes with `recomputePublishedStorageHash` and throws on any difference, and every `migration.json` with the real `computeMigrationHash`. A corrupted stored hash therefore fails it, and a separate test fails when the fixture set holds no contract or no migration.
- S2-d-R1-2: closed (`809938fa82`). Both files say to commit first, that every SQL contract JSON under the root is rewritten (with the skipped directories), how to keep an old fixture, and to run the formatter afterwards.

### S2-e-R1-1 (must-fix): the Postgres round-trip test fails on seven contracts

- Where: `test/integration/test/psl-print/every-postgres-contract-roundtrip.integration.test.ts` (`trackedPostgresContracts()`).
- What is wrong: the test takes every tracked Postgres contract, and 14 of its 560 cases fail (7 files, each listed twice). `test/integration/test/fixtures/contract-format/supabase-before-dbgenerated-removal.contract.json` and the three `before` contracts of the upgrade script's fixtures are refused by `deserializeContract` for storing `nativeType`, which is intended. The three `after` contracts (`extension-package`, `postgres-extension-space`, `unknown-codec`) are synthetic and are refused by the printer (`CONTRACT.PRINT_UNSUPPORTED`). Commit `97e7f918e2` excluded `upgrade-instructions/` from the golden planner test but not from this test. CI runs it.
- Change: exclude `upgrade-instructions/` from `trackedPostgresContracts()` as the golden test does, and exclude the refusal fixture or record that its deserialization is refused, with the reason in the test.

### Dispatch e round 3 status of the round 1 finding

- S2-e-R1-1: closed (`40bde80ebb`, `5ffb0d42f6`). `test/integration/test/utils/tracked-contract-files.ts` lists tracked `*.json` files with two git exclusions only, `upgrade-instructions/` and the old-format refusal fixture, and both the round-trip and golden tests use it. The round-trip test passes 546 (560 less the 14 failing cases); the golden test passes 684 (686 less the refusal fixture's two cases), and the manifest lost only that entry.

### S2-f-R1-1 (must-fix): the extension text leaves out two changes that break an extension

- Where: `upgrade-instructions/pending/data-type-in-contract/extension/instructions.md`.
- What is wrong: it does not say that `sqlite/json`, `sqlite/datetime` and `sqlite/bigint` are deleted (an extension that names them as a codec's data type, a cast source or an entry key fails assembly), nor that assembly now refuses an authoring entry under the wrong key with `CONTRACT.DATA_TYPE_ENTRY_KEY_INVALID` (a tag entry that names its `type` sits under `tagEntryKey(tag)`; an entry under a data type id names none). Both are new in this slice; neither is in the slice 1 entry. The SQLite `DEFAULT 42` change is in the app text only; an extension that asserts planned SQLite SQL sees it too.
- Change: add one change per item with a token-precise detection (for example `['"]sqlite/(?:json|datetime|bigint)['"]`, tested against `sqlite/json@1` and `sqlite/bigintnumber@1`), with before and after code: the codec's `dataType` becomes `sqliteText`/`sqliteInteger`; an entry keyed by `sqlite/json` moves under `tagEntryKey('json')` with `type: sqliteText.id`. Add the `DEFAULT 42` paragraph to the extension text. Everything else checked is present in its audience: `db sign` signing every space and its JSON, `signSpaces`, the `DefaultRenderer` and `typeText` renames, `--data-type`, `valueObjectStorageType` on targets, `column()` without its fourth argument, `ColumnTypeDescriptor` and `StorageTypeMetadata` without `nativeType`, commit first and format afterwards. The cast change `$1::int4` is in the app text here and in the pending slice 1 extension text, so both audiences have it in the release.

### S2-f-R1-2 (must-fix): the app proof fails on `ContractView.test.tsx`

- Where: `examples/prisma-8-demo/src/app/ContractView.test.tsx`, the case "shows the data type each column stores".
- What is wrong: the file is in `src/app/`, not under a `test/` directory, so `':(exclude)examples/*/test/**'` does not exclude it. Step 4 prints ` M examples/prisma-8-demo/src/app/ContractView.test.tsx` after the script and the prose (rerun in `wip/proof-review`). The prose cannot add a test case, and the skill says it must not.
- Change: move that one case into `examples/prisma-8-demo/test/` as a `.ts` file (`// @vitest-environment jsdom`, `createElement(ContractView, { contract })`), because the demo's `tsconfig.json` includes `test/**/*.ts` but not `test/**/*.tsx` and changing it would break step 4 again. If that is not wanted, delete the case.

### S2-f-R1-3 (must-fix): the extension proof's step 5 fails on 12 generated fixtures

- Where: `packages/3-extensions/{postgres,sql-orm-client,supabase}/test/fixtures/**/contract.{json,d.ts}`.
- What is wrong: the script rewrites every SQL contract under the root, as both instruction files say, so `git diff --exit-code <base> -- 'packages/3-extensions/*/test/**'` exits 1. Each of the 12 files equals the tip byte for byte; nothing else in a test directory changed and nothing was created. The instruction is true for users, and the repository's tests need these fixtures in the new format, so changing the script or the prose is wrong.
- Change: amend step 5 of `skills-contrib/record-upgrade-instructions/SKILL.md` (both flows) with one sentence: a file in a test directory that the entry's colocated script writes passes when it equals `<head>` byte for byte; every other test file must stay at `<base>`. This changes a skill, so it needs the orchestrator's ruling; record it in the slice plan.

### S2-f-R1-4 (must-fix): the extension proof's step 4 fails on `CONTRACT-FIDELITY.md`

- Where: `packages/3-extensions/supabase/src/contract/CONTRACT-FIDELITY.md`, the sentence added by `a1438656e8` ("`db sign` signs a contract space only when its schema verifies, …").
- What is wrong: it is outside a test directory, so step 4 prints it. Design 10.4 requires the update, so removing it is not the fix.
- Change: add to the extension text one paragraph telling authors whose docs describe `db sign` that it now signs their space too, only when its schema verifies, quoting this sentence as the Supabase example. Applying that paragraph reproduces the file.

### S2-f-R1-5 (should-fix): the slice 2 grep check has lines outside the allowed classes

- Where: `packages/3-targets/3-targets/postgres/test/errors.test.ts:67` (a `StorageColumn` built with `nativeType: 'varchar'` and cast through `unknown`); `packages/3-targets/3-targets/postgres/test/authoring-field-presets.test.ts:13` (test name "and nativeType uuid"); `packages/2-sql/9-family/test/mutation-default-assembly.test.ts:153` (a preset output with `"nativeType": "text"`); the doc comments in the pgvector and postgis `migrations/20260601T0000_*/migration.ts`.
- What is wrong: `wip/s2f/grep-classification.txt` files the first three under "SqlColumnIR and test locals holding a type text", but they are the old column and preset shapes. The migration comment class is not in `plan.md` "Grep checks"; the reason to keep it (the proof's equality) is sound.
- Change: write `dataType: 'pg/varchar'` in the first, drop "and nativeType uuid" from the second, remove the key in the third; add the migration comment class to the allowed list in `plan.md`.

### S2-f-R1-6 (low): `check:upgrade-coverage --prev bot/data-types-completion` now fails for a reason outside this branch

- Where: `wip/rev-f/upgrade-coverage.log`.
- What is wrong: `bot/data-types-completion` merged main and is at 8.0.0-rc.14, so the check stops with "head 8.0.0-rc.13 is behind prev 8.0.0-rc.14 (reversed range)". Against the merge base `1e9cc29f05` it passes.
- Change: merge the base before opening the pull request; no change to this dispatch.

### Dispatch f round 2 status of the round 1 findings

- S2-f-R1-1: closed (`0e325b563a`). Two new extension changes name the deleted SQLite types, the stored types that replace them, `DEFAULT 42`, and the entry key rule with before and after code that matches `data-type-entries.ts`. The SQLite pattern matches `'sqlite/json'`, `"sqlite/bigint"`, `` `sqlite/datetime` `` and `sqliteBigint.id`, and does not match `'sqlite/json@1'`, `'sqlite/datetime@1'`, `'sqlite/bigintnumber@1'`, `'sqlite/bigintnumber'` or `sqliteBigintNumber.id`. `@internal/target-sqlite/data-types` is a real export.
- S2-f-R1-2: closed (`71a218f46e`). The case lives in `examples/prisma-8-demo/test/contract-view-data-type.test.ts` (jsdom, `createElement`); both files pass (3 tests) and the demo typechecks.
- S2-f-R1-3: closed (`a68d3a22fa`, ruled in `cb85a39d8c`). Step 5 of both flows gains the one sentence; `lint:skills` passes.
- S2-f-R1-4: closed (`a359d8c43e`). The extension text quotes the sentence, and applying it reproduces `CONTRACT-FIDELITY.md`.
- S2-f-R1-5: closed (`dc4e090968`, `cb85a39d8c`). The three tests use the new shapes and pass (35 and 4); the plan allows the `migration.ts` comment class.
- S2-f-R1-6: open until the base merge; `check:upgrade-coverage --mode pr --prev 1e9cc29f05` passes.

### S2-rf2-R1-1 (must-fix): an enum member written as a number is refused under `pg/json@1` and `pg/jsonb@1`, which `main` accepts

- Where: `packages/1-framework/1-core/framework-components/src/shared/enum-block-members.ts:32-49`, which sends every number member to `readWrittenNumber` (`readWrittenNumberForCodec` in `packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts`).
- What is wrong: the ruling says no form `main` accepted is refused. I loaded one enum per codec and member form on `main` (`9a726c6a6a`) and on this tip: 34 Postgres and 13 SQLite codec ids, each with `1`, `-1`, `0`, `1.5`, `9007199254740993`, `"1"`, `"low"`, `true`, `false` and `null` (probe and results in `wip/review-logs/r2-probes/`). On `main`, `enum P { @@type("pg/jsonb@1") Low = 1 }` loads and stores `1`, because the JSON codecs' `decodeJson` takes any value. On this tip it is refused with `enum "P" member "Low": pg/jsonb has no cast from pg/int2; it casts from pg/json`. The same holds for every number form under `pg/json@1` and `pg/jsonb@1` (10 cases). No other Postgres form that `main` accepted is refused. Booleans and `null` take the same path as on `main`; under `pg/bool@1` and the JSON codecs they throw `enumType("P"): CHECK constraint members must encode to strings or finite numbers` on both, which is the deferred item. Large numbers keep every digit under `pg/int8@1`, `pg/numeric@1`, `pg/unboundedint@1` and `sqlite/bigint@1`, which `main` refused as numbers.
- Change: when `readWrittenNumber` refuses a number member, read it with the codec's `decodeJson`, as `main` does, and report the written-value reason only when `decodeJson` refuses it too. That keeps the three rows of `domain-types-match-their-columns` true, because `pg/text@1` and the `int4` codecs refuse those numbers in `decodeJson` as well. Add tests for `Low = 1` and `Low = 1.5` under `pg/json@1` and `pg/jsonb@1`, storing what `main` stores.

### S2-rf2-R1-2 (low): a `sqlite/json@1` enum written for `main` no longer loads, and neither the text nor the script says so

- Where: `packages/3-targets/3-targets/sqlite/src/core/codecs.ts` (`sqlite/json@1` `decodeJson`); `upgrade-instructions/pending/data-type-in-contract/app/instructions.md`; the script's enum value rewrite (`data-type-in-contract.ts`, integer enums only).
- What is wrong: on `main`, every member form under `@@type("sqlite/json@1")` loads (`"low"`, `1`, `true`, `null`), because its `decodeJson` took any value. On this tip each is refused: strings, booleans and `null` because the codec now reads JSON text (dispatch b, design 9.3), numbers because no cast leads to `sqlite/text`. Only JSON text loads, such as `A = "1"`. The script rewrites the stored values of integer enums but not of JSON enums, so an upgraded contract keeps `["low"]` while a re-emit needs `"\"low\""`. S2-rf2-R1-1's fix does not cover this, because `decodeJson` refuses these forms too. Such enums are rare.
- Change: say in the app text that a `sqlite/json@1` enum member is written as the JSON text of its document, with an example, and let the script rewrite these enums' stored values to that text, as it does for integer enums. Or record the gap in `deferred.md`.

### S2-rf2-R1-3 (low): the script says a project is in the new format when it found no contract

- Where: `upgrade-instructions/pending/data-type-in-contract/{app,extension}/scripts/data-type-in-contract.ts`, `summary`.
- What is wrong: run on an empty folder, or from the wrong directory, it prints `The project is already in the new format; nothing changed.` and exits 0. The user is told the upgrade is done when nothing was looked at.
- Change: when the root holds no SQL contract, print that no contract was found under the root, with a test.

### Review fixes 2 round 1 status of S2-f-R1-6

- S2-f-R1-6: closed. `check:upgrade-coverage --mode pr --prev bot/data-types-completion` exits 0 on this tip.

### Review fixes 2 round 2 status of the round 1 findings

- S2-rf2-R1-1: closed (`ee348bc3a8`). When the written-value reader refuses a number member, the codec's `decodeJson` reads it; if the codec refuses it too, the reader's reason is reported. I reran the probe of 47 codecs and 11 member forms against the `main` results: under `pg/json@1` and `pg/jsonb@1`, every number form loads with the value `main` stores (`Low = 1` stores `1`, `Low = 1.5` stores `1.5`). The only forms `main` accepted that are still refused are the nine `sqlite/json@1` ones (S2-rf2-R1-2). When both paths refuse, the message is still the reader's (`pg/text has no cast from pg/int2`, `pg/int4 has no cast from pg/int8`, `pg/int8 has no cast from pg/numeric`), so the three rows of `domain-types-match-their-columns` stay true. Large numbers still keep every digit.
- S2-rf2-R1-2: closed (`adc4da5fbe`). The script rewrites the members and value sets of a `sqlite/json@1` enum to the canonical JSON text of each document, in `contract.json` and `contract.d.ts`, only in old-format contracts (fixture `sqlite-json-enums`; the hash test recomputes its hashes). The reader takes a member written as a string of JSON text and stores the same text the script writes (`'"low"'`, `'{"b": 2, "a": 1}'` stored as `{"a":1,"b":2}`, `"1"`). The app text names the change, with examples, and design 10.1 step 4 says it.
- S2-rf2-R1-3: closed (`78b09700d0`). On a folder with no SQL contract the script prints `No SQL contract was found under <root>; nothing changed.` and exits 0 (run by hand and tested). Both instruction texts say so.

## Round notes

### Review fixes 2, round 2

The three commits change only what the findings name, plus their tests, fixtures, design lines and instruction text. The two script copies are identical. No committed contract outside the script's fixtures changed. No `any`, bare `as` or new comment in production code. Checks: each touched test file run alone (`enum-block-members` 9, `interpreter.enum.member-values` 9, `psl.sqlite-written-values` 54, `psl-defaults-read-by-codec` 42, the six script test files) and `test/integration/test/upgrade-instructions/` (92): all pass. `turbo run typecheck --continue`: 171 of 171. `lint:agent`: exit 0. Logs and probe output in `wip/review-logs/r3-*`.

### Review fixes 2, round 1

Commits `c408e56420..ffb85f8f86` (20 commits, one a merge of the manual QA record). Every brief item is built, each in its own commit or a shared docs commit, and nothing outside the items changed. No committed `contract.json`, `contract.d.ts`, snapshot, migration or planner golden changed; the only new contracts are the script's `json-default-document` fixtures. No `any`, bare `as` or new comment in production code; no test name uses "should".

1. Enum members (CR2-F14): parsed blocks keep each number literal's source text (`numberTexts`), and a number member is read from it, so `A = 9007199254740993` under `pg/int8@1` stores `"9007199254740993"` and `B = 9007199254740992` is not a duplicate; `-9223372036854775808` and a 31-digit numeric keep every digit. A string member goes to `decodeJson`, so every string form `main` took under `pg/int8`, `pg/numeric`, `pg/json`, `pg/jsonb`, `sqlite/bigint` and `sqlite/bigintnumber` loads again. Number members under the JSON codecs are S2-rf2-R1-1; `sqlite/json@1` is S2-rf2-R1-2. The three edited rows of `domain-types-match-their-columns` now quote what this tip prints (checked by loading each schema); `main` prints the old messages. Editing them is right: that fragment is pending on `main` (#30451, after rc.14), so it ships in the same release as this change and must describe that release. If a release is cut before this branch merges, the edit moves with the fragment. Design 9.4 and 14.6 carry the note.
2. One lock (CR2-F17, SD2-F02): `MARKER_LOCK_KEY` is a constant; `markerLockKey`, the runner's `schemaName` option and the per-space `lockMarker` arguments are gone. No caller, doc or test uses them (`git grep`; the remaining `schemaName` hits are planner options). `spacesInApplyOrder` gives `migrate`, `migrate --show`, the aggregate planner and `db sign` their order. A lost compare-and-swap now reports that space as `conflict` and the other spaces commit, as design 8.1 now says; the `deferred.md` line is gone.
3. `MIGRATION.MARKER_CAS_FAILURE` (SD2-F04): one payload, `space`, `expectedStorageHash`, `foundStorageHash`, `destinationStorageHash`, from the three runners and `db sign`; the error reference has one payload line. The runners read the marker again inside their own transaction after the update matched no row. That read cannot change the outcome, only what `found` reports; under the lock only a writer that skips the lock can move the marker, so `found` is current enough for a message.
4. `SpaceSignature` (SD2-F05) has `status`: `created`, `updated` (with `previous`), `unchanged`, `conflict` (with `expected`, `found`). The CLI maps it to its JSON outcome, and the app and extension texts describe both shapes.
5. Enrichment (SD2-F09) copies only `aggregateDescriptors`, `codecTypes`, `operationTypes` and `queryOperationTypes`. Keeping `operationTypes`, which only pgvector declares and nothing reads, is fine: removing it changes committed contracts, and `deferred.md` records the deletion.
6. Refs not written (CR2-F18): the error names failed and conflicting spaces in `why` and `meta` (`failedSpaces`, `conflictSpaces`) and says signed markers "hold" their contracts; a test covers one signed, one failed and one conflicting space.
7. Script (CR2-F15, CR2-F16, QA 2 and 3): `nativeType` is rewritten only on columns (both layouts) and `storage.types` entries, in `contract.json` and `contract.d.ts`, never inside a default; directory links are followed with a real-path guard, including a link to a directory outside the root, which the tests expect; it prints a summary and runs with `node` (Node 24.16, no warning). The two copies are identical. The test file is split into six files, the largest 231 lines.
8. The rest: CR-F11 and CR2-F19 (comment on `writeLedgerEntry`), CR2-F20 (Ctrl-C), SD2-F03 (`conflict`; no `changed` status left), SD2-F08 and SD-F11 (`StorageTypeInstanceInput` derived and exported), SD2-F01 and SD-F07 (skill steps 4 and 5, one glob in three places, release step), SD2-F06 (slice 3 outline and halt condition), SD2-F07 (ADR 204), SD2-F10 (`deferred.md`).
9. Manual QA defects 1 to 5: the texts no longer say the application logs the mismatch, name `node`, describe the summary, and drop the `DEFAULT '42'` claim. Slice 1's detection for `ts-contract-lists-extension-codecs` matches a user `contract.ts` that imports an extension's column types beside `defineContract` and skips emitted `contract.d.ts` and `migration.ts` (checked on samples and every tracked example and extension file). It no longer flags a file that imports the column types while `defineContract` is in another file; acceptable, because the build error names the fix.

Telemetry backend: `apps/telemetry-backend/test/handler.test.ts` fails one test (`expected Temporal.Instant … to be an instance of Date`, line 116) on this tip and identically on slice 1's tip `f6a97fbd51` (run in a disposable checkout under `wip/`, removed). Slice 2 did not cause it. Since #30073 (`3af065ee50`, 2026-08-24) the contract stores `ingestedAt` with `pg/timestamptz-temporal@1`, which reads a `Temporal.Instant`; the test, last changed in `3dc98cbdd4`, still expects a `Date`. `main` has the same codec and test. No CI job runs it: `test:examples` filters `./examples/**` and the root Vitest projects are `packages/**`. It needs a ticket outside this project.

Checks: the 27 touched Vitest files and the script's unchanged hash test, each run alone, then `test/integration/test/upgrade-instructions/` (88) and `scripts/lint-single-import-root.test.mjs` (9): all pass. `turbo run typecheck --continue`: 171 of 171. `lint:deps`, `lint:agent`, `lint:skills`: exit 0. `check:error-reference`: 367 codes. `check:upgrade-coverage --mode pr --prev bot/data-types-completion`: exit 0. Logs in `wip/review-logs/`.

### Dispatch f, round 2

Extension flow rerun in a disposable linked checkout `wip/proof-review2` at `dc4e090968`, `packages/3-extensions/` restored to `3bb7dbe6a6`: script exit 0, prose applied with `wip/s2f/proof2/apply-prose.py` (its one addition is the quoted `CONTRACT-FIDELITY.md` sentence), formatter on the five changed source files. Step 4 prints nothing. Step 5: the only test files that differ from the base are the 12 script-written fixture contracts, each equal to the head; nothing untracked. Checkout removed. `wip/s2f/proof2/results.txt` agrees, including the app flow. Checks: `lint:agent`, `lint:docs`, `lint:skills` exit 0; `check:upgrade-coverage --mode pr --prev 1e9cc29f05` exit 0. Logs `wip/rev-f/r2-*.log`.

### Dispatch f, round 1

1. Instruction text: read both files against design 10.2 and every slice plan note for dispatch f; the two gaps and the `DEFAULT 42` line are S2-f-R1-1. The detection samples (`wip/s2f/detect/samples.mjs`) rerun: SAMPLES OK. Public exports changed by the slice (`*/exports/*` diff) are all covered by the text or additive (`executeDbSign`, `ControlClient.dbSign`, `tagEntryKey`).
2. Proof rerun in a disposable linked checkout `wip/proof-review` at `16f4682c19`, `examples/` and `packages/3-extensions/` restored to `bot/tml-3386-data-types-declare-names`, both scripts run (exit 0), the prose applied with `wip/s2f/proof/apply-prose.py` after reading it against the prose. Outside test directories the tree differs from the tip in five files by formatting only (import order and line width, which the formatter step settles; a hook blocks running Biome directly, so I compared by eye), plus `ContractView.test.tsx` (S2-f-R1-2) and `CONTRACT-FIDELITY.md` (S2-f-R1-4). Step 5 fails on the 12 fixtures (S2-f-R1-3). Checkout removed.
3. ADR 254: status Accepted; "Data types" carries the `sqlDataType` declaration of design 2 and the rule "a data type is what the database stores"; the old paragraph is gone. The SQLite paragraph and the `tagEntryKey('json')` entry match `packages/3-targets/3-targets/sqlite/src/core/data-type-entries.ts`. The stored column example matches committed contracts, and the refusal text matches `contract-stack-checks.ts:52`. Assembly lists the checks of design 5 plus the entry key check. The `pgInt8`/`pgNumeric` block typechecks against `@internal/sql-contract/data-type` with the four referenced names declared (`wip/rev-f/adr-tc`), and fails on a misspelt key. No object has two names.
4. Docs: every remaining `nativeType` in `docs` and Markdown is historical (superseded ADRs, release notes, archived upgrade guides) or names `SqlColumnIR.nativeType` (schema IR README, the CLI `db schema` JSON example), which slice 3 changes. The CLI README `db sign` section matches `src/orm/db/sign.ts` (options, tree lines, summary, exit code 4). Cited snapshot hashes in ADR 240 and `gotchas.md` exist. `CONTRACT.NATIVE_TYPE_INVALID` is gone.
5. Golden test deletion: the directory, its `emit-fixture-configs.mjs` root, its two Biome globs and the round-trip test's expected refusal for its fixture; nothing else names `planner-golden`.
6. Checks: `lint:agent` exit 0; `lint:deps` clean; `lint:docs` exit 0 (pre-existing README warnings); `check:error-reference` 361 codes; `turbo run typecheck --continue` 171 of 171; `check:upgrade-coverage` see S2-f-R1-6. Logs in `wip/rev-f/`.

### Dispatch e, rounds 1 and 2

1. Generated commits: every file in the eight generated commits is a generated kind (`contract.json`, `contract.d.ts`, `migration.json`, `migration.ts`, `ops.json`, ref files, the Prisma 7 `expected-contract.json`, `sqlite-contract.json`, `namespaced-contract.json`, `codec-instance.json`, `sql-contract.json`). Apart from `nativeType`/`dataType` and 64-character hashes, the only changed lines are key reordering (`dataType` sorts before `kind`, so a trailing comma moves) and, in `2422e3af3a`, whole files moved by snapshot directory renames. `codec-instance.json` lost its hand-written `"storageHash": "fixture-codec-instance"`: the script rehashed it from content, as design 10.1 step 2 says, and `snapshot-read-shapes.test.ts` passes. I found no hand edit.
2. `git grep -l '"nativeType"' -- '*.json'` lists the refusal fixture `supabase-before-dbgenerated-removal.contract.json`, the upgrade script's `before` fixtures, and one more: `upgrade-instructions/pending/data-type-in-contract/test/fixtures/postgres-extension-space/after/mongo/contract.json`, a Mongo contract kept on purpose to prove the script skips other families. No `contract.d.ts` outside the `before` fixtures has `readonly nativeType`, and no pack metadata has the key.
3. Files the script rewrote, checked with the real `createSnapshotContentVerifier(sqlContractCanonicalizationHooks)` and each codec's registered data type (`wip/review-s2a/e-check.mjs`): a `prisma-8-demo/fixtures/converging-branches` snapshot, `prisma7-adoption` (emitted and snapshot), a `telemetry-backend` snapshot, `sqlite-contract.json`, `codec-instance.json`, the value-objects `sql-contract.json`, `namespaced-contract.json`, and the `prisma-8-demo` snapshot the pgvector extension copy's migration points to. Every hash recomputes; every `dataType` is the codec's. The one exception is expected: the old `telemetry-backend` snapshot uses the retired `pg/timestamptz@1`, which the script maps to `pg/timestamptz` as design 10.1 step 3 says. The value-objects config does not emit because `schema.prisma` lacks the `// use prisma-8` directive, a requirement added by #30379 on 2026-09-24. That is older than this slice and not a regression of it.
4. Golden: `wip/s2e/golden-base-rec` holds 340 records from the slice 1 tip, and `manifest.json` holds 340 entries. `wip/s2e/compare-golden.mjs` groups records by path with the snapshot hash replaced by `*`, because snapshot directory names change, so several snapshots of one `migrations/snapshots` directory form one group. It compares the sorted list of planned SQL (hashes masked) per group, including the count. 295 groups therefore cover all 340 contracts, and no contract went uncompared. The one difference is the refusal fixture, now unreadable as intended. The golden test passes (686).
5. `7adefad95b` replaces only 64-character hex strings that are keys of the hash map, bounded so a longer hex run does not match; an unrelated hash is left (tested). `wip/s2e/script-red.log` shows the new test red before the fix.
6. Checks: `fixtures:check:agent` clean (exit 0, clean tree). `turbo run typecheck --continue`: 171 of 171. Previously red files, each run alone and green: `sql-orm-client` `orm.test.ts` and `model-types.test-d.ts`, `sql-builder` `builders.test.ts`, `postgres` `raw-lane.test.ts`, `contract-prisma7` `fixtures.test.ts`, `target-postgres` `postgres-migration.test.ts` and `snapshot-read-shapes.test.ts`, `target-sqlite` `sqlite-migration.test.ts`, `supabase` `supabase-facade.test.ts`, `cli-telemetry` `integration.test.ts`, four `test/integration/test/authoring/` files (`psl.pgvector-data-type-default`, `psl.pgvector-dbinit`, `psl.sqlite-written-values`, `side-by-side-contracts`), the golden test, and the `db sign` journeys including the one that now re-signs pgvector (6). The Postgres round-trip test fails: S2-e-R1-1.

### Dispatch d, round 2

The ruled `--data-type <codec id>=<data type id>` option (`54b62a3e30`): a value whose codec the table knows on any target is refused (`the script already maps …`), and the table is spread after the extra entries, so it would win anyway. A malformed value, an unknown option and an unknown codec all exit 1 before any file is written; the tests assert the whole tree unchanged for each. The stop line now names the option. Both script copies are byte-identical, as the test asserts. The two `instructions.md` files differ only where the audience differs: the extension file tells the author to publish the `--data-type` lines for their own codecs. Checks: the script's test file, 24 pass; the new integration test file passes. I touched nothing but this file; another implementer was working in the tree.

### Dispatch d, round 1

Steps 1 to 9 of design 10.1 against the script:

1. Every `*.json` under the root (skipping `node_modules`, `.git`, `dist`, `build`) whose `targetFamily` is `sql` is a contract, including the copies under `migrations/<extension>/`; a Mongo contract is left alone (tested).
2. The old hash is the snapshot directory name or `storage.storageHash`, recomputed from content; a mismatch prints the design's line and the file is still rewritten (`stale-hash` fixture).
3. The table is keyed by target. I checked every entry against the built registries: each Postgres and SQLite codec maps to its descriptor's `dataType`; `pg/vector@1`, `pg/geometry@1` and `arktype/json@1` match their extensions' sources; the five retired ids are present. An unknown codec stops (tested).
4. `nativeType` becomes `dataType`; `extensions.*.types.storage[].nativeType` is removed; the SQLite default rules match `slices/2/briefs/s2b-default-rewrites.md` (JSON to canonical text with `null` kept, integer numbers to digit text, digit text unchanged).
5. and 6. Hashes are recomputed with the copied rules (S2-d-R1-1); snapshot directories are renamed, a collision with different content stops, an identical one is merged (both tested); `from`, `to` and `migrationHash` in each `migration.json` and the hashes in ref files go through the map.
7. `snapshots/<hash>/` specifiers in `migration.ts` go through the map.
8. In `contract.d.ts`, each `readonly nativeType` line becomes the `dataType` line for its column's codec, a `nativeType` line inside an extension `types.storage` entry is deleted, hash literals go through the map, and a rewritten default's `DefaultLiteralValue` argument is replaced.
9. An emitted contract keeps its own final newline (amended design); a snapshot is one canonical line plus a newline. On a stop, nothing is written, one line per case goes to stderr, and the exit code is 1.

The choices:

1. The copied hash rules: acceptable, because the script must run in a project that cannot import internal packages. The proof is weak, see S2-d-R1-1.
2. Deleting the extension `nativeType` lines in `contract.d.ts`: right. The emitter writes `extensions` with `serializeValue` of the contract's own `extensions` object (`generate-contract-dts.ts:225`), and that object no longer carries `nativeType`.
3. Any SQL contract JSON is rewritten: this can rewrite a fixture kept old on purpose. In this repository, dispatch e runs the script on `examples/`, `apps/` and `packages/3-extensions/` only, and no JSON file there other than `contract.json` holds `nativeType`, so `test/integration/test/fixtures/contract-format/supabase-before-dbgenerated-removal.contract.json` is out of reach. For users, the instruction text must say it (S2-d-R1-2). An exclusion option is not needed if the text says to keep such files outside the root or restore them with git.
4. The formatter is not mentioned in either `instructions.md` (S2-d-R1-2).
5. Idempotency: each `after` tree run again is unchanged with exit 0, and a second run over an upgraded copy is unchanged. The stop cases assert the whole tree equals `before`, with exit 1 and the exact stderr. Each would fail if the script wrote before stopping or printed otherwise.
6. Unknown codec: design gap for the orchestrator. Design 10.1 step 3 only stops. A project that uses any codec outside the table (a third-party extension, or one of the user's own) cannot upgrade at all, and the stop message gives no way forward. I recommend the inventory's repeatable `--data-type <codec>=<id>` option, with the stop message naming it.

SQL data transforms are stored as lowered SQL in `ops.json`, so no SQL `ops.json` holds a storage hash; the one `ops.json` in the repository with a hash is Mongo (`examples/retail-store`), which the script skips.

Checks: `node --test` on the script's test file: 18 pass. `lint:deps`, `lint:agent` and `check:upgrade-coverage --mode pr --prev bot/data-types-completion` pass. The working tree held uncommitted dispatch e changes while I ran `lint:agent`; I did not touch them.

### Dispatch c, round 1

Design 8: `executeDbSign` loads the aggregate with `buildContractSpaceAggregate`, verifies every space with `strict: false` through `verifyMigration`, and passes the spaces that verified to `familyInstance.signSpaces` in one call. On SQL, `signSpaces` runs the marker bootstrap and every space's read, insert or compare-and-swap update inside one `withTransaction`. The CLI writes refs only after `client.dbSign` returns, so after commit. The app ref goes through `advanceRefSafely`, which writes its snapshot; an extension space's snapshot is already in the store, so only its ref file is written. A failed space keeps its marker, the others are signed, the command exits 4, and each space is named with `signed`, `unchanged` or `failed`.

The checks asked for:

1. Atomicity: `control-instance.sign-spaces.test.ts` "rolls back every marker write when one space loses the compare-and-swap" updates the app marker, fails on the extension's, and asserts `ROLLBACK` and both old markers. Its adapter is a fake whose transaction restores the table; real rollback is covered by the SQLite adapter test on an in-memory database. Refs are written after commit, as above.
2. `withTransaction`: `BEGIN`, `COMMIT` on success, `ROLLBACK` and rethrow on error, on both adapters. The control drivers hold one connection (`PostgresControlDriver` wraps one `pg` `Client`), and the migration runners already issue `BEGIN` on the same drivers. Nothing opens a transaction around `signSpaces`, so there is no nesting. S2-c-R1-1 is the one gap.
3. Output: the JSON document is now `{ ok, summary, spaces[], advancedRefs[] }`, one outcome per space. The previous single-space shape (`marker`, `contract`, `target` at the top level) is gone. This changes what a script reading `db sign --json` sees, so dispatch f's app-audience upgrade text must describe it. The human output is a header, a tree with one line per space, a summary, and one line per advanced ref. It returns diagnostics through `ctx.present` with exit code 4, which is how `db verify` reports drift, and structured errors through `notOk`, as `cli-error-handling.mdc` asks. One `CONTRACT.SCHEMA_VERIFICATION_FAILED` diagnostic per failed space, with `space` in meta; the error reference says so.
4. Choices: extension spaces get a ref file with empty invariants, and `--advance-ref <name>` names that ref in every signed space. That is fine, because design 8.1 says each signed space's `db` ref advances. Unchanged spaces advance their refs too: fine, as the ref then names the contract the database was just verified against, and the command stays idempotent. Mongo: `signSpaces` is a required member of the framework's `ControlFamilyInstance`, so Mongo must implement it. Signing space by space without a transaction is acceptable, because design 8 asks for a transaction only on Postgres and SQLite, and Mongo transactions need a replica set. The design should say so. The PGlite journey uses the test contract-space extension instead of pgvector. This is acceptable for now, because pgvector's committed contract space is in the old format and is refused until dispatch e regenerates it. Dispatch e can switch the journey to pgvector.
5. The `migrate` refusal's fix line and next action use the same words as `migration status` (`status-findings.ts:45,58`): "to overwrite the marker if the database already matches the contract".
6. The Mongo `signSpaces` test can fail: with the loop cut to the first space, it fails.

Checks: the 16 touched test files pass alone (the two `cli-journeys` files through `test:journeys`), including the three PGlite and SQLite journeys and the Mongo `db sign` end-to-end tests. Typecheck passes for framework-components, family-sql, family-mongo, adapter-postgres, adapter-sqlite and cli. `lint:deps`, `lint:agent` and `check:error-reference` pass.

### Dispatch b, round 2

`0c7ccebe6d` builds amended design 9.6. `diffSqliteSchema` decodes a reported literal default of a `sqlite/json@1` column through the codec and writes it back with `encodeJson` before comparing, so another key order or spacing is not drift and a different document still is. Text the codec cannot decode is left as reported. Only verify calls `diffSqliteSchema` (`verifySqliteDatabaseSchema`, `control-target.ts`); the planner builds its own diff, which the commit does not touch. Red first: with the commit's `diff-database-schema.ts` reverted and the target rebuilt, `data-type-verify.test.ts` fails 1 of 4; with it, all 4 pass. `lint:agent` passes.

### Dispatch b, round 1

Design 9 items: the target declares exactly the six data types, each with one written and catalog text; `sqlite/json`, `sqlite/datetime` and `sqlite/bigint` are gone from `packages/2-sql` and `packages/3-targets`. The codec-to-data-type table of 9.2 is built. `sqlite/integer@1`, `sql/int@1`, `sqlite/bigint@1` and `sqlite/bigintnumber@1` read and write digit text; `sqlite/json@1` writes `canonicalizeJson` of the document and reads JSON text; `sqlite/real` casts from `sqlite/integer`; blob and both character types cast from text. No SQLite constructor carries `inferred`. `data-type-verify.test.ts` plans, introspects and verifies one column of each of the six types, and a second test verifies integer and JSON defaults written in their earlier stored form.

The four choices:

1. `tagEntryKey('json')` and `CONTRACT.DATA_TYPE_ENTRY_KEY_INVALID`: fine. Authoring entries are a record keyed by data type id. Postgres never needs a second key, because no Postgres type has both a tag and a plain form (the `json` tag yields `pg/jsonb`, which has no plain entry). On SQLite the `json` tag and the plain string both yield `sqlite/text`, so one of them needs another key. A `tag:` prefix cannot collide with an `owner/name` id. A misfiled entry is a pack author's error found at assembly, like `CONTRACT.DATA_TYPE_ENTRY_DUPLICATE`, so a code of its own fits the existing checks. It is documented, and `check:error-reference` lists 361 codes. The design is silent; record it in design 9.4.
2. JSON key order: not a must-fix. The only comparison between a database default and the contract is verify (`literalValuesEqual`), and the database default was written by the planner from the contract's own canonical text, so the two are equal. Runtime `encode` writes rows, never defaults, and the projection is read back through `decodeJson`, which parses the text. Earlier stored defaults were sorted too, because contract canonicalization sorts every object key. Design gap: verify now compares a SQLite JSON default as two strings, where before it compared documents. A default written outside the planner (hand-written SQL with other key order or spacing) now shows drift. Slice 3's comparison should take the codec into account.
3. `DEFAULT 42` instead of `DEFAULT '42'`: no committed SQLite migration exists, and the three SQLite goldens contain only `DEFAULT 'unnamed'` and `DEFAULT (datetime('now'))`, so nothing committed changes. It does fall outside spec requirement 2. "Contract impact" allows the stored form to change, not the DDL, and the only DDL exception is the `typeRef` fix. Under `INTEGER` affinity both forms store 42, and an existing database still verifies. This is a design gap: `sqlite/integer@1` defaults were already written `DEFAULT 42`, and `sqlite/bigint@1` ones `DEFAULT '42'`, so one of them must change once both store digit text. I recommend accepting `DEFAULT 42` and adding the exception to spec requirement 2.
4. Blob hex: fine. Today's `encodeJson` writes uppercase hex (`codecs.ts:443` at `4031ad07ed`), so "as today" holds and the design's "base64" is the error.

Default rewrites (`wip/s2b-default-rewrites.md`) match the built codecs: JSON to `canonicalizeJson` with `null` kept; integer numbers to digit text; digit text unchanged; other codecs unchanged. The claim that no committed SQLite contract has a JSON, datetime or integer literal default is true: the only two are `sqlite/text@1` `"unnamed"`.

Tests written after the code can fail. I removed the `DATA_TYPE_ENTRY_KEY_INVALID` check and 3 assembly tests failed. The `default-mapping` test fails against the code before this dispatch, which threw on `dataTypeId('tag:json')`. The adapter verify and DDL tests have red logs (`wip/s2b/adapter-verify-red.log`, `ddl-red.log`).

Checks: the 25 changed test files pass alone (398 tests), the SQLite codec testkit passes (66), typecheck passes for framework-components, adapter-sqlite, family-sql, sql-contract-psl and sqlite-codec-testkit. target-sqlite fails only on the committed `contract.d.ts` files of round 1. `lint:deps` passes. `check:error-reference` passes. Framework vocabulary is 254 at 254.

### Dispatch a, round 3

`typecheck` for `@internal/adapter-sqlite`, `@internal/sqlite` and `@internal/family-sql`: all exit 0. The three changed test files pass alone (1, 8 and 43 tests). Both commits carry the two sign-offs and no AI attribution.

### Dispatch a, round 2

The machine was heavily loaded. I rebuilt only the touched packages (sql-contract, sql-contract-ts, target-postgres, target-sqlite, family-sql, both adapters; exit 0).

Value-object storage type: moving `valueObjectStorageType` from the adapters' `control.ts` to the targets' `descriptor-meta.ts` matches design 3.1, which gives the targets the type constructors and the other PSL authoring contributions; `Jsonb` and `Json` are target constructors. The stack still reads it from every descriptor and refuses a second declaration (`control-stack.ts:228-244`). The PSL value-object tests (10), the SQLite adapter descriptor test (8) and the Postgres adapter `control-mutation-defaults` test (19) pass. The builder reads the constructor's codec from `definition.target.authoring`, and `deserializeContract` uses the same refusal text, from `valueObjectStorageTypeMissingMessage` in `validators.ts`.

Explicit maps: the maps are per file, not shared. The only `sql/char@1` and `sql/varchar@1` entries are in Postgres-only files (`contract-to-schema-ir.test.ts`, the runtime `same-bare-table-name.test.ts`), and the one SQLite file (`planner.codec-field-event.test.ts`) maps only `sqlite/text@1` and a test codec. `pg/vector@1` maps to `pgvector/vector`, which is right. The one wrong file is S2-a-R2-2.

Checks: `turbo run typecheck --continue`: 22 tasks fail. 20 are the round 1 list, all committed `contract.d.ts`; `adapter-sqlite` and `sqlite` are new and are S2-a-R2-1. Each touched test file run alone: 20 pass; the two `sql-orm-client` files fail only on the committed fixture contract (expected until dispatch e), and the round-trip integration test was not run (it reads committed contracts). `lint:deps` and `lint:agent` pass.

### Dispatch a, round 1

Brief items against design 7:

1. Done. `StorageColumnSchema` and `StorageTypeInstanceSchema` require `dataType` matching `DATA_TYPE_ID_PATTERN` and keep `'+': 'reject'`. The refusal text is exactly the design's, reported per key with its path, under `CONTRACT.VALIDATION_FAILED` from both `validateStorage` and `validateSqlContractStructure`. It does not mention the upgrade script, and a test asserts that. `test/integration/test/contract-format/supabase-before-dbgenerated-removal.test.ts` passes (4 tests).
2. Done. `buildStorageColumn`, raw `storage.types`, `type.*` helpers and PSL `types {}` aliases all end in `dataType` from `sqlDataTypeOfCodec`. `unquotedSqlBaseName` stays for the schema IR, postcheck and PSL printer.
3. Done, with S2-a-R1-3. `ColumnTypeDescriptor` has no `nativeType`; `column()` takes three arguments; every helper dropped the field; helpers return `{ kind, codecId, typeParams }`.
4. Done. Junction columns compare by `dataType` and `canonicalizeJson` of `typeParams`; the `json`/`jsonb` set is deleted; `assertContractMatchesStack` runs in `deserializeContract` only, not at runtime.
5. Done. The emitter writes `readonly dataType`; the `contract-ts` type declares `readonly dataType: string`. The JSON Schema matches its generator: I reran `pnpm schemas:generate` and the file did not change.
6. Done. `StorageTypeMetadata.nativeType` and every pack's `types.storage[].nativeType` are gone; `contract-enrichment.ts` copies the metadata as it is, so the emitted `extensions` lose the key.
7. Done. `pgEnumDescriptor.columnFromEntity` returns only `typeParams`; the qualifier rewrites only `typeParams.typeName`.
8. Done. `DdlColumnRenderContext.typeText`; `assertSafeNativeType` and `CONTRACT.NATIVE_TYPE_INVALID` have no occurrence outside `projects/`.
9. Done. `ContractView.tsx` shows `column.dataType`, and its test asserts `pg/uuid` and `pg/text` appear.

No committed `contract.json`, `contract.d.ts`, snapshot, migration or planner golden changed; only the golden fixtures' `contract.ts` sources lost `nativeType`. The implementer's red logs (`wip/s2a/sqlc-red.log`, `fam-red.log`, `emit-red.log`) show tests red before the code, although tests and code share commits. No test name uses "should". Commits carry both sign-offs and no AI attribution. The merge `75b971783e` wrote `dataType: 'pg/bit'` in the planner golden refusal, which matches `refusals.ts`.

The implementer's seven choices:

1. Canonical JSON of `typeParams` without a stack: fine. `dataTypeParams` needs the data type's `params`, which only a stack has. Comparing all of `typeParams` is stricter only for codec-owned keys. The design should say this.
2. The check covers `storage.types` and skips an unknown codec: fine. Refusing would break contracts whose pack is not loaded (the golden test's `extensionsNotLoaded` contracts), and the planner already refuses a column whose codec it cannot find. The design should record it; S2-a-R1-4 asks for a test.
3. A value-object column in a stack with no value-object storage type is refused: fine. It follows from design 7.4. The messages name the path, the codec and the constructor.
4. PSL aliases no longer write a type name: fine. One writer is simpler, and PSL tests show `dataType` on the built entries.
5. Value objects on SQLite through TypeScript: not a regression. No test, example or fixture builds one: the 12 committed SQLite contracts have no value object, and `contract-builder.value-objects.test.ts` uses Postgres only. The one SQLite value-object test (`contract-psl/test/interpreter.value-objects.test.ts:390`) is PSL, which uses the stack's `valueObjectStorageType` (`sqlite/json@1`) and still passes. Before this dispatch the builder wrote `pg/jsonb@1` into a SQLite contract, which the SQLite stack could not run. Design gap for the orchestrator: the TypeScript builder hard-codes `pg/jsonb@1`, while `deserializeContract` now requires the stack's value-object storage type codec. The builder should take the codec from `valueObjectStorageType` as PSL does.
6. Renames: fine for the grep check. `DefaultRenderer`'s third argument and `DdlColumnRenderContext.typeText` are exported (`packages/2-sql/9-family/src/exports/control.ts`, relational-core), so the extension-audience upgrade text in dispatch f must name both.
7. Threshold 262 to 254: fine. The count is 254; the halt condition is only a raise.

Checks:

- `pnpm build`: 86 of 87 tasks pass. `prisma-8-postgis-demo#build` fails with 31 errors, all from its committed `contract.d.ts`.
- `test:packages:agent` (`wip/test-packages.20260930-223309.30607.log`): 99 files fail. 96 are expected fixtures: 69 `sql-orm-client` (runtime tests refused at `test/helpers.ts` deserialize, type tests on the committed `contract.d.ts`), 12 `extension-supabase` (committed contract and contract space), 6 `sql-builder` and 1 `postgres` (`raw-lane`) on the committed fixture, `sql-contract-prisma7` `fixtures.test.ts` (35 committed `expected-contract.json`), `target-postgres` `postgres-migration`, `snapshot-read-shapes`, `postgres-contract-view`, `target-sqlite` `sqlite-migration`, `sqlite-contract-view`, and `cli-telemetry` `integration` and `cli-e2e` (committed `apps/telemetry-backend` contract). 3 are environmental: `all-shells-tarball`, `module-identity`, `cross-shell-tarball` fail in `pnpm install`, as in slice 1. No real defect.
- `typecheck:agent` stops at the first failure, so I ran `turbo run typecheck --continue` (`wip/review-s2a/typecheck-continue.log`): 20 tasks fail, all from committed `contract.d.ts` files: `extension-supabase` (including `src/pack/index.ts` and `src/runtime/supabase.ts`, which import the extension's committed `contract.d.ts`), `postgres`, `sql-builder`, `sql-orm-client`, `target-postgres`, `target-sqlite`, `bundle-size`, `e2e-tests`, `integration-tests`, `multi-extension-monorepo`, `paradedb-demo`, `prisma-8-cloudflare-worker`, `prisma-8-demo`, `prisma-8-demo-sqlite`, `prisma-8-postgis-demo` (build and typecheck), `prisma7-adoption`, `react-router-demo`, `supabase-example`, `telemetry-backend`.
- `lint:agent`, `lint:deps`, `check:error-reference` (360 codes), `lint:casts` (delta 0): pass. `lint:framework-vocabulary`: 254 at threshold 254.
- The golden planner test, `fixtures:check` and the Postgres round-trip test read committed contracts and are expected red until dispatch e. I did not run the full integration or e2e suites.
