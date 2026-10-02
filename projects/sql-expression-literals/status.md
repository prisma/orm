# Status and handoff

Read this first when you resume the project. It records where the work stands and the context that is not in the spec, design or plan. Update it at the end of every slice.

## State on 2026-09-30

- Slice 2t (TML-3367) is on branch `tml-3367-data-type-value`, stacked on the 2a branch. Pull request: https://github.com/prisma/orm/pull/30539 (opened 2026-09-30, base `main` since #30534 merged; approved for merge by Will, auto-merge on). Two review rounds done, every finding fixed. Next: slice 2b (TML-3288) once 2a merges; its "Carried over" list in plan.md holds the deferred items from both 2t reviews.

- Planning is finished. Slice 2a merged on 2026-09-30.
- PR #30349 (the binder) merged on 2026-09-25 and PR #30381 (block specs) on 2026-09-28. Nothing outside the project blocks it.
- Slice 2a (TML-3296) is implemented on branch `tml-3296-sql-expression-data-type`, which also carries these project files. Two review rounds are done and every finding is fixed. Pull request https://github.com/prisma/orm/pull/30534 merged to `main` on 2026-09-30 as `d0ec42633f`. [handover.md](handover.md) is the earlier handover and is superseded by this file.
- Slice 2a changed nothing in `examples/` or `packages/3-extensions/`, so `check:upgrade-coverage` required no declaration; the two fragments under `upgrade-instructions/pending/sql-is-a-data-type/` are the ones design section 20 names.
- The three publish-shell tarball tests (`all-shells-tarball`, `module-identity`, `cross-shell-tarball`) fail on this machine because `pnpm install` in the scratch project refuses `@vercel/detect-agent@1.2.5` as a "high-risk trust downgrade". That is the registry, not this branch. Check them in CI.

## Slice 2a review, 2026-09-30

- The implementer finished and committed but hit the Fable usage limit before it reported. Its verification logs are under `wip/v/`. Rerun on the tip: the render round-trip, two CLI tests and the relation-mode integration test pass (`wip/v/rerun-*.log`). The packaging and tarball tests fail only because of the registry trust-downgrade problem above.
- `/drive-code-review` (no walkthrough) wrote to `reviews/slice-2a/`, which `.gitignore` excludes. Copies are committed in `slice-reviews/2a/`.
- The architect review is done: `slice-reviews/2a/system-design-review.md`, findings A01 to A14. The main one, A01: the family defines `sql/expression` but each adapter registers it; register it from `SqlFamilyDescriptor` (the family descriptor can carry `dataTypes`), or record the alternative in ADR 254.
- The code review is done: `slice-reviews/2a/code-review.md`, findings F01 to F09; 32 PASS, 4 WEAK, 0 FAIL, 1 NOT VERIFIED (the tarball tests, which only CI can run). The main findings: the upgrade detection pattern for `pg.sql`/`sqlite.sql` misses escaped backticks and spaced dots and matches file names (F01); the upgrade text wrongly says messages did not change (F02); nothing enforces that no data type casts from `sql/expression` (F03); deleting the adapter test removed the only tests of the number classifiers (F04).
- The review fixes are done, except A01. Brief: `dispatches/2a-review-fixes-brief.md`. Verification logs: the gitignored `wip/v2/`.

### Review fixes, 2026-09-30

- **A01 is done** (commits `273731b288`, `54680fc713`, `d94c4db032`). The SQL family descriptor registers `sql/expression`; the targets no longer list it. `contract infer`'s default mapping still builds from the target's own lists and does not see family or extension types; that is existing behaviour, out of scope, and changes no output (`dispatches/2a-review-fixes-findings.md`, design section 11.1).
- Code: `@default` reads the `sql/expression` value through `sqlTextFromCanonical` (A03). `writingSurface` has no `sql` skip (A04). `PSL_DEFAULT_TYPE_INCOMPATIBLE` is `PSL_DEFAULT_LIST_EXPECTED` (A05). `sql/expression` is defined as a SQL expression (A06). `lowerTaggedLiteral` is `readTaggedLiteral` with its own result type (A10). `PSL_INVALID_DEFAULT_SQL` is declared in `psl-column-resolution.ts` (A11). `sqlTextReadsBack` and the unused `authoring` exports are gone, including `canonicalizeTaggedLiteralBody`, which only `sqlTextReadsBack` used (A14). `assertNothingCastsFromSqlExpression` in `@internal/sql-contract/sql-expression` throws `CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION`; `createSqlFamilyInstance` runs it on every registered data type. `runtimeError` is now exported from the shared `@internal/framework-components/codec` entry for it (F03).
- Tests: an assembled-stack test per SQL target, Postgres with all five shipped extension packs (A02); framework parser tests use `postgis.geometry` (A12); target entry tests restored in `3-targets/3-targets/{postgres,sqlite}/test/data-type-entries.test.ts` (F04); two `unreadable` rows and whole-message assertions (F05); the renamed test (F06); a `jsonb` default with a backtick in the infer round trip (F07).
- Docs: ADR 129 retitled and rewritten around "the tag names the data type of the text", with one prefix rule in ADR 254 (A07); body and text told apart (A08); ADR 254 says `@default` reports at the attribute (A09); the data-type-support header (A13); error reference without "a list holding another list" (F08); design line reference (F09); both fragments with the new detection pattern, tested in `wip/v2/f01-detection.log` (F01), and the list-literal row, the rename row and the `DefaultRefusal` change (F02).
- Manual QA was rerun before A01 landed. Its case 2 output listed the tags as `json, sql`, which did not match the expected `sql, json`, although the run said every case matched. The round 2 rerun on the tip replaces it in `manual-qa.md`, and there every case gives the expected result.
- Verification on the tip: `build`, `typecheck`, `lint`, `lint:deps`, `lint:casts` (delta 0), `lint:throws` (delta 0), `check:error-reference`, `lint:framework-vocabulary` (272 of 272), `fixtures:check` (tree clean) and `check:upgrade-coverage` pass. `test:packages`: 1417 files pass; `operation-preview.test.ts` failed because its hand-built stack had no family, and passes after the fix; the three tarball tests fail on the registry refusal. `test:integration`: 873 files pass; only the two packaging files fail, on the same registry refusal. Check the tarball and packaging tests in CI.
- Verification after A01 (`wip/v3/`, local only): `build`, `typecheck`, `lint`, `lint:deps`, `check:error-reference`, `lint:framework-vocabulary`, `fixtures:check` and `check:upgrade-coverage` pass. `test:packages`: two failures pass on rerun (`completion-provider.test.ts`, the telemetry e2e test); the three tarball tests fail on the registry refusal. **`test:integration` did not finish** before the session was stopped for a rate limit. Run it again.
- The two review reports are committed in `slice-reviews/2a/`, because `.gitignore` excludes `reviews/`.

## Slice 2a review, round 2

The second review is in `slice-reviews/2a-round-2/` (findings B01 to B05 and G01 to G04). Brief: `dispatches/2a-round-2-fixes-brief.md`. All findings are fixed; nothing needed the findings file.

- **B01** (`5b5ce1b89b`, `2142987972`): `ControlStack` has `declaredDataTypes`, the list `assembleDataTypes` builds, with each type's contributor. `assertNothingCastsFromSqlExpression` takes that list and names the contributor in its message and payload. `createSqlFamilyInstance` and the registration test use the list. The message keeps "a list cast" for a list cast, as design 3.5 says. Tests, error reference and design 3.5 updated. The operation preview test's hand-built stack got the field; the other hand-built stacks are partial casts that never reach the family.
- **B02** (`d671f9ae0b`): ADR 254's Assembly section says the SQL family runs its own check when it creates its control instance, so the CLI reports it and the language server does not.
- **B03** (`597a20c65d`): `runtimeError`, `isRuntimeError` and `RuntimeErrorEnvelope` are exported from `@internal/framework-components/components`; `/codec` no longer exports `runtimeError`. `lint:deps` passes. Design 3.5 updated. The fragments did not name `/codec`.
- **B05, G03** (`3911ae54cc`): the `json` entry documentation says "Reads the text" on both targets, in ADR 254, in the codec authoring guide and in the two test copies. ADR 254 says `@default` reports `PSL_UNKNOWN_LITERAL_TAG` at the literal; plan.md's carry-over list no longer names it.
- **B04, G04, G02** (`7870e28f59`): spec "Adapter impact" says the family registers `sql/expression` and the targets do not. The extension fragment names `CONTRACT.DATA_TYPE_ENTRY_DUPLICATE`.
- **G01** (`0fbf1f6414`): the registration test checks that the `sql/expression` entry comes first on both targets. The manual QA run on the tip replaces the old run; every case gives the expected result, and case 2 lists `sql, json`. The wrong status sentence is corrected.

Verification (logs in the gitignored `wip/v4/`): `build`, `typecheck`, `lint`, `lint:deps`, `lint:casts` (delta 0), `lint:throws` (delta 0), `check:error-reference` (361 codes), `lint:framework-vocabulary` (272 of 272), `fixtures:check` (tree clean) and `check:upgrade-coverage` pass. Tests: framework-components 794 pass, family-sql 372 pass (after the operation preview fix; the first run failed on that stub), the integration registration test 16 pass, language server 734 pass, `sql-expression.test.ts` and `sql-attribute-specs.test.ts` pass. Manual QA: `wip/v4/manual-qa.log`. The orchestrator still has to run `test:packages` and `test:integration`.

## Slice 2t, 2026-09-30

Implemented on branch `tml-3367-data-type-value`, on top of slice 2a. Not pushed; no pull request. Brief: `dispatches/2t-implementer-brief.md`. Two findings (`dispatches/2t-findings.md`) are decided and fixed; see "Findings fixes" below.

### What was built

- **Section 4** (`6ce7f897a9`): `framework-components/src/shared/written-value.ts`, exported from `/authoring`, holds the cast rule for one written value. `contract-psl/src/data-type-default.ts` keeps the list handling, `DefaultRefusal`, `readDataTypeDefault` and `lowerDataTypeDefault`, and imports the rest. `contract-prisma7` imports `entryForTag`, `WrittenValue` and `DataTypeSupport` from the framework.
- **Section 5** (`1e47750cf6`): `readWrittenLiteral` in `psl-parser/src/written-literal.ts`.
- **Section 6** (`0f3d47efb9`): `dataTypeValue`, `ParsedTypedValue`, `DataTypeValueArgType`. The language server's `completion-values.ts` returns no items for it; completion is section 12, slice 2b.
- **Section 7** (`42b9fc44b5`): `AttributeSpecContext.dataTypes`, `EMPTY_DATA_TYPES`, `ControlDefaultRegistries` with only the function registry. Every construction site passes the stack's data types, including the binder.
- **Carried over from the 2a review:** ADR 254 has the scalar cast rule sentence (`32837b1c52`). `TaggedLiteralCanonicalization.text`, `TaggedLiteralExprAst.text()`, `parseJsonText` and `printJsonText` (`24c934710f`). `@default` reports `PSL_VALUE_TYPE_INCOMPATIBLE` and `PSL_INVALID_LITERAL` at the written value or the list element; the two default-only codes stay at the attribute (`32837b1c52`). The `@default` list arm no longer offers `sql` (`32837b1c52`). No name about lowering a tag is left. The `unknown-tag` arm of `lowerDataTypeDefault` stays and is now the one place that reports an unknown tag: see finding 1 and "Findings fixes".
- **Docs** (`bcae07f564`, `32837b1c52`): ADR 231 (`dataTypeValue`, the `oneOf` rule), ADR 249 (the context carries `dataTypes`), ADR 254, the error reference and the editor tooling brief.
- **Upgrade instructions** (`55f5c11982`): `upgrade-instructions/pending/arguments-typed-by-data-type/{app,extension}`. The detection patterns are tested against a true positive and the nearest false positive (`wip/2t/detection.log`). The extension entry was validated by execution: with `packages/3-extensions/` restored to the merge base, no non-test path differs and the Mongo extension tests pass (`wip/2t/fragment-validation*.log`).
- **Manual QA** (`907248634f`): the slice 2t script and run in `manual-qa.md`. Every case gives the expected code, message and start.

### Design corrections

- The language server has no `pipeline.ts`, `PipelineInputs` or `server.ts` edit. `LspControlStack.dataTypes` is set in `lspControlStackFromStack`, and `project.ts` spreads it into both `candidates` objects. Design section 7 is corrected.
- The binder is a construction site that research Part B missed. `CreateBinderOptions` gains a required `dataTypes`; `createSqlBinder` takes an optional one and `createMongoBinder` a required one. Design section 7 is corrected.
- Mongo tests pass `EMPTY_DATA_TYPES`, which is the value the design wrote out.
- `TaggedLiteralExprAst.body()` returned the canonical text, so it is renamed `text()` with the field.

### Verification

Logs are in the gitignored `wip/2t/`.

- `build` (`build.log`), `typecheck` (`typecheck.log`), `lint` (`lint.log`), `lint:deps` (`lint-deps.log`), `check:error-reference` (`check-error-reference.log`, 361 codes), `fixtures:check` (`fixtures-check.log`, tree clean) and `check:upgrade-coverage` (`check-upgrade-coverage.log`) pass.
- `lint:casts`: delta 0. `lint:throws`: delta 0. `lint:framework-vocabulary`: 272 of 272.
- `test:packages` (`test-packages.log`): 1422 files pass. Seven failed. The three tarball tests fail on the registry refusal. `render-typescript.roundtrip.test.ts`, the two `cli-telemetry` files and `cli` `migration-plan.test.ts` pass when rerun alone (`rerun-*.log`).
- Integration, run alone: `test/authoring`, `test/number-defaults` and the four Mongo and value-object files whose imports changed, 36 files, 244 tests, pass (`integration.log`).

### Findings fixes, 2026-09-30

Brief: `dispatches/2t-findings-fixes-brief.md`.

- **Finding 1, option A** (`3facad43e0`): `@default` no longer checks a tag before it reads the value. `readTaggedLiteral` is gone; an unknown tag is reported by the `unknown-tag` arm of `lowerDataTypeDefault` at the written value or the list element. Messages and spans are unchanged; a new test covers a list element.
- **Finding 2** (`c294bfd4f1`, `3ac77e2800`): `oneOf` returns the result of the one `funcCall` alternative that names the called function. `@default(uuid(5))` now reports `Expected one of: 4 | 7` at `5`, and `@default(nanoid("8"))` with a `dataTypeValue` parameter would report the cast refusal at `"8"`. ADR 231, design section 6, the app upgrade fragment and the manual QA script are updated; the run is recorded.
- Verification, logs in `wip/2t-fixes/`: `build`, `typecheck`, `lint`, `lint:deps`, `check:error-reference` (361 codes), `fixtures:check` (tree clean), `check:upgrade-coverage` pass. `lint:casts` delta 0, `lint:throws` delta 0, `lint:framework-vocabulary` 272 of 272. `test:packages` (`test-packages.log`): 1423 files pass, 6 fail; the three tarball tests fail on the registry refusal, and `completion-provider.test.ts`, `cli-telemetry` `cli-e2e.test.ts` and `render-typescript.roundtrip.test.ts` timed out and pass alone (`rerun-*.log`). Integration `test/authoring test/number-defaults`: 28 files, 174 tests pass (`integration-authoring-number-defaults.log`). Manual QA: `manual-qa.log`.

### Slice 2t review fixes, 2026-09-30

Brief: `dispatches/2t-review-fixes-brief.md`. Reviews: `slice-reviews/2t/`. Commits `e4ca38ef56` to `b90636f40e`.

- **A01** (`d60177aeed`): no code change. Design-notes decision 14 and the note to "Data types own column types" above record the mechanism: a default-function signature becomes `(dataTypes: DataTypeSupport) => FuncCallSig`, resolved in `scalarDefaultArms`.
- **A02** (`e6c2815e36`): the pair is the field `dataTypes` everywhere. `DataTypeSupport` keeps its name; its doc comment says what it holds.
- **A03** (`93d49f733e`): `ControlStack.dataTypes` is built once. `ContractSourceContext` had two production construction sites, so it replaces `dataTypeLookup` with `dataTypes`, and the SQL and Prisma 7 interpreter inputs do the same. Every test that built a context or an interpreter input was updated; a test that passed a lookup without entries passes `{ entries: {}, lookup }`, and contract-psl tests now pass the fixture's entries. ADR 249 and the extension fragment are updated.
- **A04, A07**: carried over to slice 2b in `plan.md`.
- **A05, A13** (`4d7d7a6fa7`): ADR 254 states the end state; ADR 231 lists all six codes and the label rule.
- **A06, A12** (`f70a219d11`): the doc comment cites ADR 231 and ADR 254. A tagless label is `describeAdmittedForms` (`a number`, `true or false`), tested.
- **A08** (`87581a7e0a`): `DefaultRefusal` is `ReadRefusal | CastRefusal` plus `not-a-list`, `no-list-cast` and `undecodable`. The brief said two default-only arms; a third, `no-list-cast`, was needed because a list written on a scalar column whose type has no list cast has no `DataTypeId` for `valueType`. Prisma 7 reads `receivingType`.
- **A09** (`249c4d760d`): the sentence is on `WrittenValue`.
- **A10** (`d5117ef66b`): `readWrittenScalar`, `WrittenScalarResult`, files `written-scalar.ts` and its test; design section 5 updated.
- **A11** (`a2c75c6ba7`): `checkSqlDefaultText`, `reservedSqlDefaultText`, `UNSAFE_DEFAULT_TEXT`, file `default-sql-text.ts`; `default-mapping.ts` and `sql-default-literal.ts` say text. Extension fragment updated.
- **A14** (`1360f60594`): `test/integration/test/authoring/data-type-value.test.ts` parses `8`, `"8"` and `` sql`x` `` on the assembled Postgres and SQLite stacks.
- **A15** (`cbd529fb90`, `f70a219d11`, `87581a7e0a`, `47db2ee790`): `describeRefusal` in `written-value.ts` is the one wording. `@default` passes the forms of the receiving types and adds only `Field "X.y": `; for an element read through a list cast, the forms are those of the list cast's element types. `@default` words `no-list-cast` itself in the same pattern. Tests, `error-reference.md`, design sections 4, 6, 10.1 and 13, and the app fragment (detection `; it casts from `, before and after table) are updated. Manual QA cases 13 and 14 added and the script rerun.
- **F01, F02, F07** (`cbd529fb90`, `f70a219d11`): casts with a visible effect, the admitted-tag order, and the `an expression` refusal are tested. Planted defects (returning the value before the cast) fail the new tests.
- **F03** (`47db2ee790`): the extension fragment describes the `oneOf` rule and the binders that require `dataTypes`.
- **F04** (`5929d57073`): the dead named-argument fallback is gone.
- **F05** (`87581a7e0a`): the codec-refusal test asserts the whole diagnostic with the `@default` span.
- **F06** (`f70a219d11`, `980f83e74b`): dotted and colon-qualified callees list the arms; a colon-qualified callee cannot be written in argument position (`a:` opens a named argument), so its test builds the tree of the dotted form with a colon. The Mongo `@@index([email(sort: Up)])` case reports `Expected one of: Asc | Desc` at `Up`.
- **F08** (`93d49f733e`): the config-resolution test asserts the stack's pair is passed by identity.
- **F09** (`30a4523acf`): `createSqlBinder` requires `dataTypes`; design section 7 corrected.
- **F10** (`47db2ee790`, `d60177aeed`): the order is kept; the app fragment and finding 1's outcome say so.
- The code review's first four deferred items and one new observation are in `plan.md` slice 2b: a type with no written form gives the message ending `write no written form`.

Verification, logs in `wip/2t-review-fixes/`: `build`, `typecheck`, `lint`, `lint:deps`, `check:error-reference` (361 codes), `fixtures:check` (tree clean) and `check:upgrade-coverage` pass. `lint:casts` delta 0, `lint:throws` delta 0, `lint:framework-vocabulary` 272 of 272. `test:packages` (`test-packages.log`): 1425 files pass, 4 fail; the three tarball tests fail on the registry refusal, and `cli-telemetry` `cli-e2e.test.ts` passes alone (`cli-telemetry-rerun.log`). Integration `test/authoring test/number-defaults`: 30 files, 198 tests pass (`integration-authoring-number-defaults.log`). Manual QA: `manual-qa.log`, recorded in `manual-qa.md`.

### Slice 2t review fixes, round 2, 2026-09-30

Brief: `dispatches/2t-round-2-fixes-brief.md`. Reviews: `slice-reviews/2t-round-2/`. Commits `9f8bd38248` to `9b21e77bf2`.

- **Merge** (`9f8bd38248`): the slice 2a branch merged cleanly. It brings `656249c3d9`, which is G01.
- **B01 and G06** (`5adf991e77`): `SqlPslBuildContext` and `DefaultMappingOptions` take `dataTypes: DataTypeSupport`. `SqlPslBuildContext.authoringContributions` no longer includes `dataTypes`. `ControlStack.dataTypeLookup` is gone; readers use `stack.dataTypes.lookup`. Inside `default-mapping.ts` the private helpers call the lookup `lookup`. Tests, the extension fragment (new change `print-path-carries-data-types`) and design section 7 are updated.
- **B02** (`39bb27db90`): new family arm `no-element-cast` (`receivingType`, `valueType`, `elementTypes`). `contract-psl` words it `<type> has no cast from a list holding <value type>; write <forms of the element types>`. Prisma 7 words it `holds a <value type> value at element n, which the list cast of <type> does not take; it takes <element types>.` `ReadDefaultResult.receivingTypes` is now `suggestedTypes`. The Prisma 7 test gives `pg/float8` a list cast in the lookup, because no Prisma 7 column type has one. Before the fix it printed `which pg/float8 has no cast from; it casts from pg/int2`, which is false: `pg/float8` has no such cast. Design section 4, `error-reference.md` and both fragments are updated.
- **B03** (`f1ab5abb9d`): the parameter is `guidance`, and the doc comment says it follows `write `. Design section 4 is updated.
- **B04** (`6d361db9ef`): the slice 2b carry-over names `@default` and manual QA case 4.
- **B05** (`6d361db9ef`): the ADR 254 call bullet is in the future tense, and line 181 says a data type declares its list cast and the family's default reader reads a written list through it.
- **G01**: fixed by the merge.
- **G02** (`39bb27db90`): two tests on a `pgvector.Vector(3)` column assert the whole diagnostic at element 2: text (`write a number`, which also covers de-duplication of the forms) and an unknown tag.
- **G03** (`3494a37620`): the extension fragment has `default-refusals-say-what-to-write` with the app fragment's detection patterns and table, and no longer says the messages are unchanged. Both tables have a row for the vector element.
- **G04** (`39bb27db90`): Prisma 7 tests for `count Int @default([1, 2])` and for the new arm.
- **G05** (`6d361db9ef`): the contract-psl README says the message ends with what to write.
- **G07** (`2d788c2342`): `dispatches/2t-findings.md` has an A08 entry with the decision and its reason.
- Manual QA (`9b21e77bf2`): four cases with the pgvector extension, recorded in `manual-qa.md`.

Verification, logs in `wip/2t-round-2-fixes/`: `build`, `typecheck`, `lint`, `lint:deps`, `check:error-reference` (361 codes), `fixtures:check` (tree clean) and `check:upgrade-coverage` pass. `lint:casts` delta 0, `lint:throws` delta 0, `lint:framework-vocabulary` 272 of 272. `test:packages` (`test-packages.log`): 1438 files pass, 6 fail. The three tarball tests fail on the registry refusal. `cli-telemetry` `cli-e2e.test.ts` and `integration.test.ts` timed out and pass alone (`rerun-cli-telemetry.log`); `cli` `migration-cli.exit-scheme.test.ts` failed once and passes alone (`rerun-cli-exit-scheme.log`). Integration `test/authoring test/number-defaults test/date-time-defaults`: 34 files, 230 tests pass (`integration.log`). Manual QA: `manual-qa.log`.

## Slice order and tickets

| Order | Plan slice | Ticket | State |
| --- | --- | --- | --- |
| 1 | 2a: `sql` is the data type `sql/expression` | TML-3296 | Merged 2026-09-30 (#30534) |
| 2 | 2t: an argument declares the data type it receives | TML-3367 | PR #30539 open against the 2a branch; two review rounds done, all findings fixed |
| 3 | 2b: the six places take `sql` literals | TML-3288 | Waiting for 2t |
| 4 | 3: the TypeScript builder takes `sql` values | TML-3289 | Waiting for 2b |
| On the side | 1: line comments in raw SQL | TML-3287 | Not started; depends on nothing |
| Last | 4: migration files write template literals | TML-3290 | Waiting for 1 |
| Stretch | 5: migration files write `sql` values | TML-3297 | Waiting for 3 and 4 |

TML-3282 was the decision ticket and is done.

## Why slices 2a and 2t go first

The Linear project "Data types own column types" finishes ADR 254. Its last slice types default-function arguments by data type, for example the `8` in `@default(nanoid(8))`. Will decided on 2026-09-29 that this project builds the argument type `dataTypeValue` and that project reuses it. That project is blocked until TML-3367 merges. Its requirements are listed in TML-3367 and in design-notes decision 14.

Two notes were sent to that project's agent:

- `dataTypeValue` is used as a parameter of a `funcCall`, not as a bare arm of `oneOf`. When exactly one arm of `oneOf` names the called function, `oneOf` keeps that function's diagnostics, so `@default(nanoid("8"))` can report the cast refusal at `"8"` (updated 2026-09-30).
- `dataTypeValue` throws an internal error when the stack does not register the named data type. A family spec must choose the type id from the stack, not hard-code one target's id.
- A default-function signature is built from the stack's data types: `ControlMutationDefaultEntry.signature` becomes `(dataTypes: DataTypeSupport) => FuncCallSig` (or the entry offers that form beside the static one), resolved in `scalarDefaultArms` with `ctx.dataTypes`. That project makes the change when it types `nanoid(8)`; see design-notes decision 14 (added 2026-09-30).
- The label of a `dataTypeValue` without a tag is the forms it admits, such as `a number`. A refusal is worded by the framework's `describeRefusal`; a caller adds only its location prefix and chooses the forms to suggest (added 2026-09-30).

## The design is older than `main`

The design was written against commit `47d727b70d`, the head of PR #30381 before its author rebuilt it. After that, 57 files changed in `psl-parser`, the SQL PSL interpreter, the language server and the Postgres policy code. Only section 9.1 was rewritten for the merged code. So each slice starts by re-checking its own design sections against `main`:

- A file, line or function that moved: correct the design and continue.
- A difference in behaviour or in a type the design depends on: stop and raise it with Will.

What is known about `main` on 2026-09-29 (commit `d13613775f`):

- Policy blocks are `structBlock` specs in `packages/3-targets/3-targets/postgres/src/core/authoring.ts`. `using` and `withCheck` are `optional(str())`. The design calls them `fixedBlock` specs in one place; the name on `main` is `structBlock`.
- Block values are parsed by `interpretExtensionBlocks` in `psl-parser/src/block-spec/interpret.ts`. Only the SQL interpreter (`contract-psl/src/interpreter.ts`, about line 2104) and the Mongo interpreter (about line 1190) call it. The symbol table no longer parses block values, so the language server does not parse them either.
- `BlockSpecContext` is `{ symbols, block }`. It has no `dataTypes` field. Slice 2b adds it.
- `interpretExtensionBlocks` takes a `binder`. The design does not mention the binder.
- The largest changes are in `contract-psl/src/interpreter.ts`, `psl-column-resolution.ts` and `psl-field-resolution.ts`, which slices 2a, 2t and 2b edit.

## Related work outside the project

- **TML-3302** (date and time defaults are stored as different text by PSL and TypeScript) is not addressed by this project. It may edit `readDataTypeDefault` in `contract-psl/src/data-type-default.ts`, which slice 2t moves into the framework. If it does, it should merge before slice 2t, or slice 2t rebases on it.
- **TML-3286** removes `.defaultSql()` at 8.0.0. It is a non-goal here.
- The open PRs that touch the same files are listed at the end of [plan.md](plan.md). That list is from 2026-09-25; check it again before each slice.

## Proposals discussed but not decided

Will has not agreed to these. Do not act on them without asking.

- Run slice 3's `SqlExpression` class in parallel with slice 2b, and add the parity fixture in whichever merges second.
- Move slices 4 and 5 out of this project into their own tickets, so the project closes when slice 3 merges.
- Skip a second full verification pass of the design.

## Rules from Will that apply to every slice

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all` in full locally (Will, 2026-09-30). Run the integration files the slice touches alone; CI runs the full suites.

- Plain strings are refused everywhere; there is no fallback.
- A `sql` literal is a value of a data type. Other literals are refused by the cast rule, never by a syntax check. Prisma never parses the SQL inside a literal.
- Checks on SQL content, such as "no SELECT", belong to the place that receives the value. Only `@default` has them.
- The tag is `sql` only. There is no `pg.sql` or `sqlite.sql`.
- The implementer has no design freedom. The design fixes every name, signature and message.
- Commits carry no AI attribution lines. Never amend, squash, rebase or force-push. Pull request titles are "TML-NNNN: sentence".

## History

- 2026-09-24: decisions made with Will; first design; architect and principal-engineer reviews (in [research/](research/)); design rewritten.
- 2026-09-25: design verification found 23 issues ([research/design-verification.md](research/design-verification.md)); 21 applied. Project put on hold until PR #30349 and PR #30381 merged.
- 2026-09-29: both merged. Section 9.1 rewritten to one path, which closed the last two findings. Slice 2t split out of slice 2b as TML-3367. Slice 2a started and implemented; design file and line references corrected against `main`.
