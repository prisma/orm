# Status and handoff

Read this first when you resume the project. It records where the work stands and the context that is not in the spec, design or plan. Update it at the end of every slice.

## State on 2026-10-08

lagertha-65 took over from hammurabi-31 on 2026-10-08.

- Merged: slice 2a (#30534), slice 1 (#30546), slice 4 (#30554), slice 2t (#30539, shipped in 8.0.0-rc.16) and slice 2b (#30550, squash `7ae50f13f9`, 2026-10-08). TML-3288 and TML-3367 are Done in Linear.
- Slice 3 (TML-3289) is https://github.com/prisma/orm/pull/30558, base `main`, branch `tml-3289-sql-expression-ts` (local name `l65-3`). 2b's final commit `a044872a36` and then `main` are merged in (`b3f0ca7a04`, `ba45958509`); every reference to its ADR says ADR 268 (`fc10468cd3`); `bd80bf468a` fixes what `main` added since. Brief: `dispatches/3-merge-2b-and-main-brief.md`; logs in `wip/3-merge/`. All checks pass except the three tarball tests below. One decision in the merge: an unnamed full-text index's `where` refusal names every field of its weight groups, `Full-text index on fields "title", "subtitle" where` (TML-3431, #30562, made full-text indexes span several fields; "on fields" added in review round 3). Review round 3 (`slice-reviews/3-round-3/`, A01–A07, C01–C06) is done and every finding is fixed: docs in `79e9498810` and the close-out commit of this round, code in `cab6bcce23` and `b368f8c449` (briefs `dispatches/3-round-3-fixes-brief.md` and the follow-up message for C05 and the PSL backtick case; logs `wip/3-round-3-fixes/`, `wip/3-round-3-fixes-2/`). Notable code change: `readSqlExpression` rebuilds a `sql` value made by another installed copy of the package, so its text is canonicalized wherever it is read, including interpolation. Manual QA rerun on 2026-10-08 with a revised script: every case matches. Next: Will reviews #30558; then slice 5.
- Slice 5 (TML-3297): Will confirmed on 2026-10-08 that it is built, after slice 3 is with him. Not before.
- The decision's ADR is ADR 268, because #30641 claims 267. Mentions of "ADR 260" in the slice 3 history below mean this ADR under its old number.
- The three publish-shell tarball tests (`all-shells-tarball`, `module-identity`, `cross-shell-tarball`) fail on this machine because `pnpm install` in the scratch project refuses `@vercel/detect-agent` as a "high-risk trust downgrade". That is the registry, not the branch. Check them in CI.

## Known limits

- On SQLite, `Json`, `String` and `DateTime` columns all have the data type `sqlite/text`, and the target registers the `json` tag under the key `tag:json`. So a refused default on a SQLite `Json` column says `Expected a quoted string`, not ``Expected json`...` ``. Decided on 2026-10-07 to keep it: a quoted JSON string works on such a column, and offering ``json`...` `` would also show on `String` and `DateTime` columns.

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

## Slice 2b, dispatches (a) and (b), 2026-09-30

Branch `tml-3288-sql-expression-places`, on top of slice 2t. Not pushed; no pull request. Brief: `dispatches/2b-places-brief.md`. Findings: `dispatches/2b-findings.md`. Commits `7833c3d94f` to `c0abc48222`.

### What was built

- **Dispatch (a)** (`65bfc09b5b`): `BlockSpecContext.dataTypes`. `interpretExtensionBlocks`, `interpretExtensionBlock`, `interpretExtensionBlockAttributes` and the binder put the stack's data types into every block spec and block attribute context. The SQL and Mongo interpreters pass theirs; the language server passes `source.dataTypes ?? EMPTY_DATA_TYPES`. Tests: `block-spec-context.test.ts` in psl-parser (binder and interpreter), contract-psl (SQL provider and interpreter), Mongo contract-psl (provider) and the language server (block key and block attribute completion).
- **Carried over from 2t**: `ControlDefaultRegistries` is deleted and the context carries `defaultFunctionRegistry` (`0e83ea5e3f`). The `@default` literal arms yield written scalars with spans through the new `writtenScalar` and `writtenList` combinators, `lowerDataTypeDefault` reports at the spans it is given, and `writtenScalar`, `defaultValueExpression` and `listElements` in `psl-column-resolution.ts` are gone (`3196bb9ddd`, `f91b12183f`). `dataTypeValue` offers the exact rewrite only when it reads back, otherwise `write it as a sql literal`, and its doc comment cites ADR 256 (`c2ff027bb5`).
- **The six places**: `@@index` and `@@check` (`984720a786`), `@@fullTextIndex(where:)` and policy `using`/`withCheck` (`907dfcb6cc`) receive `sql/expression` through `dataTypeValue`; lowering stores the canonical text. Guard test `postgres/test/sql-expression-places.test.ts`. Tests: `interpreter.sql-expression-places.test.ts`, `psl-full-text-index.test.ts`, `psl-policy-predicates.test.ts`, `sql-expression-wire-names.test.ts` (`913b8ba458`).
- **Printers** (`f4cc10e9c2`): `contract infer` and `contract print` write index, check and policy SQL with `printSqlExpressionLiteral`; `contract infer` skips an object whose SQL does not read back, with the note of design 11.2. `sqlTextReadsBack` and the `canonicalizeTaggedLiteralBody` export (`1560661485`). Test: `psl-infer/infer-sql-expression-literals.test.ts`.
- **Artefacts**: codemod `scripts/codemods/rewrite-sql-strings.mjs` with its test in `test:scripts` (`a0dbcbde3c`). Supabase pack contract regenerated; `contract.json` and `contract.d.ts` unchanged (`c50b808aa0`). The listed `.prisma` fixtures rewritten with the codemod (`44817e0e58`); `no-policy/contract.prisma` has no plain-string place. Inline PSL in package and integration tests rewritten. New journey `test/integration/test/cli-journeys/sql-expression-literals.e2e.test.ts` (`ce5991c385`).
- **Docs**: ADR 262 (then numbered 255) amended (`caa1f38065`). Placeholder fragments `upgrade-instructions/pending/sql-expression-literals-psl/{app,extension}` with the change ids and detection patterns of design 20 (`dee2c93553`).

### Design corrections

- The index and check printers are in `psl-build/index-attributes.ts`; the policy printer function is `buildIntrospectedPolicyBlocks`.
- `AttributeSpecContext` has no `parsedBlocks`, so `modelSpecContext` copies none.
- The binder also builds block spec contexts; `interpretExtensionBlock` and `interpretExtensionBlockAttributes` take `dataTypes` too.
- `contract print` prints the six places too. It now writes `sql` literals but does not check read-back (finding 1, open).
- The rewrite check in `dataTypeValue` calls `canonicalizeTaggedLiteralBody`, because the parser cannot import `sqlTextReadsBack` (design section 6).
- The journey test leaves out the `--` comment case until slice 1 lands (finding 2, open).
- The language server's `@@check(` snippet expectation now reads `check(expression: ${1:expression})`; dispatch (c) makes it a `sql` literal.

### Verification

Logs in the gitignored `wip/2b/`.

- `build` (`build.log`), `typecheck` (`typecheck.log`), `lint` (`lint.log`), `lint:deps` (`lint-deps.log`), `check:error-reference` (`check-error-reference.log`, 361 codes), `fixtures:check` (`fixtures-check.log`, tree clean), `test:scripts` (`test-scripts.log`, 577 pass) and `check:upgrade-coverage` (`check-upgrade-coverage.log`) pass.
- `lint:casts` delta 0, `lint:throws` delta 0, `lint:framework-vocabulary` 272 of 272.
- `test:packages` (`test-packages.log`): 1446 files pass, 8 fail. The three tarball tests fail on the registry refusal. `language-server` `server.test.ts` and `completion-provider.test.ts`, `cli-telemetry` `integration.test.ts` and `cli-e2e.test.ts`, and `mongo` `mongo.enum.e2e.test.ts` pass when rerun alone (`rerun-ls.log`, `rerun-cli-telemetry.log`, `rerun-mongo-enum.log`).
- Integration, run alone (`integration.log`): `test/authoring`, `test/number-defaults`, `test/date-time-defaults`, the new journey, `infer-roundtrip-fidelity*`, `sign-the-database`, `expression-index-migration`, `rls-exact-name-adoption` and the two `psl-print` round trips: 60 files, 342 tests pass.
- Supabase pack tests (`supabase-tests.log`): 18 files pass. Adapter RLS integration tests (`b8-adapter-rls.log`): pass.
- Done-condition grep (`grep-prisma.log`, `grep-md.log`): in `.prisma` files only a Prisma 6 Mongo fixture and a Prisma 7 `dbgenerated(expression:)` fixture remain, both out of scope. In ```` ```prisma ```` blocks, `contract-psl/README.md` and `skills/prisma-8/references/{contract,queries-postgres,supabase}.md` remain for dispatch (d).

### Still owed

- Dispatch (c): language-server completion and colouring (design section 12), including the `@@check(` snippet.
- Dispatch (d): ADR 256, the ADR 129/231/249/234/236/243/244 amendments (ADR 249 still names `ControlDefaultRegistries`), docs and skills from the grep above, the error reference, the upgrade fragments' prose and codemod copies, and the manual QA script for the new messages.
- Findings 1 and 2 need decisions.

## Slice 2b, dispatches (c) and (d), 2026-09-30

Same branch, not pushed, no pull request. Brief: `dispatches/2b-tooling-docs-brief.md`. Commits `1b66c15bad` to the status commit.

### What was built

- **Finding 1** (`1940a65a24`): `contract print` refuses an index, check or policy whose SQL a `sql` literal cannot write back unchanged, with `CONTRACT.PRINT_UNSUPPORTED` from `refuseSqlTextThatDoesNotReadBack`. Test: `postgres/test/psl-print/refusals-sql-text.test.ts`. Listed in the error reference.
- **Finding 2** (`2437389302`): slice 1 adds the `--` case to the journey test; `plan.md` moved it. Both decisions are recorded in `dispatches/2b-findings.md`.
- **Dispatch (c)** (`13e27e6cfd`, `9931bbbea7`): the language server colours a tagged literal (namespace, keyword tag, string per line), completes `sql` at every argument typed by a data type, and completes `@@check(` to ``check(expression: sql`${1:expression}`)``. Tests in `completion-provider.test.ts` and `semantic-tokens.test.ts`.
- **ADR 268** (`558f77e1fa`), "Raw SQL is a value of the data type `sql/expression`". First numbered 260, then 267, because `main` took 260 for the `afterTransaction` stage, then 268, because #30641 also claimed 267. Every reference in code, docs, design, plan, spec and README says 268. ADRs 129, 231, 234, 236, 243, 244, 249, 254 and 262 (then numbered 255) are amended; ADR 262's policy example now matches the code. `ADR-INDEX.md` has rows for 129, 254 and 268.
- **Docs** (`738289a20e`): the error reference, the editor tooling brief, the extensions subsystem doc, `docs/README.md`, the contract-psl and Postgres READMEs, and the `prisma-8` skill references.
- **Upgrade fragments** (`6287c89999`): full prose for `raw-sql-is-a-sql-literal` (with the codemod as `script:`), `storage-hash-may-change-once`, `spec-contexts-carry-data-types` and `supabase-contract-writes-sql-literals`. The codemod copies are byte-identical to `scripts/codemods/rewrite-sql-strings.mjs`.
- **Manual QA** (`0d43e333de`): slice 2b script and run in `manual-qa.md`; every case gave the expected result.

### Verification

Logs in the gitignored `wip/2b-cd/`.

- `build`, `typecheck`, `lint`, `lint:deps`, `lint:skills`, `check:error-reference` (361 codes), `fixtures:check` (tree clean), `test:scripts` (577 pass): pass. `lint:casts` delta 0, `lint:throws` delta 0, `lint:framework-vocabulary` 272 of 272.
- `test:packages` (`test-packages.log`): 1449 files pass, 6 fail. The three tarball tests fail on the registry refusal. `render-typescript.roundtrip.test.ts` and the two `cli-telemetry` files pass alone (`rerun-render-roundtrip.log`, `rerun-cli-telemetry.log`).
- Integration, alone: the new journey and `test/authoring` (`integration.log`, 30 files); `test/psl-print` and the `contract-print` journey (`integration-psl-print.log`, 16 files). Supabase pack tests pass (`supabase-tests.log`, 18 files).
- Fragments (`fragment-validation.log`): the codemod copies, run on `examples/` and `packages/3-extensions/` as they were at the merge base, reproduce the committed files exactly; those are the only non-test changes in either directory. Detection patterns tested against true positives and nearest false positives (`detection-check.log`).
- Done-condition grep (`grep-done-condition.log`): what remains is the preserved historical example in ADR 126, the refused form quoted on purpose in ADR 129 and ADR 268, a TypeScript schema in the codec guide, the Prisma 6 and Prisma 7 fixtures, and the TypeScript examples in the contract-ts README, which are slice 3's.

### Still owed

- The wording of a number of the wrong size (`pg/int4 has no cast from pg/int8; write a number`) and of `write no written form`, carried over from slice 2t. No place in slice 2b receives a number-typed or formless data type, so neither message can appear yet.
- `/drive-code-review` of slice 2b.

### Slice 2b review fixes, 2026-09-30

Brief: `dispatches/2b-review-fixes-brief.md`. Reviews: `slice-reviews/2b/`. Commits `5f44720063` to the status commit. Not pushed, no pull request.

- **A01, A02, A14, F07**: the framework has one tag-agnostic `taggedLiteralTextReadsBack`, exported from `authoring`; `canonicalizeTaggedLiteralBody` is no longer exported from `control`. `sqlTextsReadBack` is the one predicate infer and print call. `printSqlExpressionLiteral` throws for text that does not read back. Column defaults print with `printTaggedLiteral`, because they print unconditionally (`dispatches/2b-review-fixes-findings.md` finding 1). The skip note lives in `psl-infer/infer-sql-text.ts`.
- **A03**: infer skips only exact-named objects, with the new note. A wire-named index is printed with its canonical text under the same name. Tests in `infer-sql-expression-literals.test.ts` and `infer-parse-emit.test.ts` (absent from the emitted contract).
- **A04 to A07, A17, F03**: ADRs 129, 231, 267, the editor tooling brief, the error reference and both fragments.
- **A08, A09**: `@default` argument values carry `kind` (`scalar`, `list`, `function`, `member`); a written scalar has no `ok` field; `writtenList` is generic.
- **A10**: every `sqlAttributeSpecs` factory takes the context, and every call site passes it. ADR 249 says so.
- **A11**: `blockSpecContext` builds every `BlockSpecContext`.
- **A12**: the guard test collects every `str()` argument and compares it with a list of non-SQL arguments.
- **A13**: deferred to slice 3, in `plan.md`.
- **A15, F02**: the codemod skips `//` and `///` comments; its test checks both fragment copies and compares its printer with the framework's. Rerun on the merge-base schemas, it reproduces every committed rewrite (`wip/2b-review-fixes/codemod-rerun/`).
- **A16**: `createSqlBinder` requires `defaultFunctionRegistry`.
- **F04**: `test/migrations/sql-text-canonical-planner.test.ts`. Wire-named objects: no operations. An exact-named index and check: `migration plan` stops with a conflict asking for `migration new`. An exact-named policy is dropped and created again (corrected in round 2, finding B01). The fragments and ADR 268 say so.
- **F05, F06**: whole assertions. **F08**: nothing in code; the pull request description says the hook change rode in `0e83ea5e3f`.
- Build fix: `EnumMemberDefault` and `FunctionDefault` are exported from `@internal/sql-contract-psl/attribute-specs`, so `family-sql` declarations can name them.

Verification at HEAD (F01), logs in `wip/2b-review-fixes/`: `build`, `typecheck`, `lint`, `lint:deps`, `lint:skills`, `check:error-reference`, `lint:framework-vocabulary`, `fixtures:check` (tree clean) pass; `lint:casts` and `lint:throws` delta 0. `test:scripts`: 590 pass. `test:packages`: 1452 files pass, 7 fail; the three tarball tests are the known failures, and the other four pass alone (`rerun-failed.log`). Integration files alone: 60 files, 982 tests pass (`integration.log`). Supabase pack: 18 files pass (`supabase-tests.log`). `check:upgrade-coverage` after committing: pass (`upgrade-coverage.log`).

### Slice 2b review fixes, round 2, 2026-09-30

Brief: `dispatches/2b-round-2-fixes-brief.md`. Reviews: `slice-reviews/2b-round-2/`. Commits `589b2b4913` to the status commit. Not pushed, no pull request.

- **G02**: canonicalization was not idempotent: it dropped one blank first line and one blank last line, so `"\n\n(a > 0)"` became `"\n(a > 0)"`, which does not read back. The canonicalizer changed: it now drops every blank line at the start and end. Canonical text is now its own canonical form and reads back once printed, so `printSqlExpressionLiteral` never throws on it; tests in `framework-components/test/tagged-literal.test.ts` and `sql-contract/test/sql-expression.test.ts`. No re-check was added to `printableIndex`. ADR 129 and ADR 268 state the rule; both fragments say the stored text changes once for a literal with two or more blank lines at an end.
- **B01, G01**: a planner test with only a `@@map` policy whose text becomes canonical: `migration plan` drops the policy and creates it again. ADR 268 and both fragments say so.
- **B02**: the skip note, ADR 129 and the app fragment say that a hand-written literal still differs from the database, and give the two ways out: change the SQL in the database, or name the object without `map:` or `@@map`.
- **B03**: the `@default` arm is `DefaultFunctionCall` with kind `default-function`; the exports stay, with a doc comment.
- **B04, G03**: ADR 129, design section 11.2, `mapDefault` and the test name say defaults compare with case and whitespace ignored. `plan.md` records the string-constant default under slice 3 and under "Deferred beyond this project", because infer can produce it: Postgres reprints string constants unchanged.
- **B05**: `TaggedLiteralCanonicalization` is exported from `/authoring` only.
- **B06**: `mapArg` in `psl-parser`; `writtenScalar`, `writtenList` and the two `@default` arms use it.
- **B07**: `canonicalSqlText` lives in `@internal/sql-contract/sql-expression`.
- **G04, G05**: the codemod test finds fragment copies anywhere under `upgrade-instructions/` and fails when there are none; two tests pin `//` inside a string.

Verification, logs in `wip/2b-round-2-fixes/`: `build`, `typecheck`, `lint`, `lint:deps`, `check:error-reference`, `lint:framework-vocabulary`, `lint:skills`, `fixtures:check` (tree clean) pass; `lint:casts` and `lint:throws` delta 0. `test:scripts`: 593 pass. `test:packages`: 1454 files pass, 5 fail: the three known tarball tests and two `cli-telemetry` files, which pass alone (`rerun-cli-telemetry.log`). Integration files: 44 files, 928 tests pass (`integration.log`). `check:upgrade-coverage` after committing: pass (`upgrade-coverage.log`).

## Slice 3, 2026-10-01

Branch `tml-3289-sql-expression-ts`, on top of slice 2b (`ed1df11285`). Not pushed; no pull request. Brief: `dispatches/3-implementer-brief.md`. Commits `7db66e9278` to the status commit. No findings file: nothing in the design was wrong against the code.

### What was built

- **The value and the tag** (`29aa1fb121`): `SqlExpression`, `isSqlExpression`, `sql`, `requireSqlExpression` in `@internal/sql-contract/sql-expression`; subcodes `SQL_EXPRESSION_INTERPOLATION` and `SQL_EXPRESSION_INVALID`; `describeTaggedLiteralFailure` and `resolveTemplateTagEscapes` exported from the framework's `authoring` entry. Tests: `sql-expression.test.ts` (extended), `sql-expression.test-d.ts`.
- **contract-ts** (`49d5ee392e`): `sql-default-literal.ts` and `DEFAULT_SQL_INTERPOLATION` deleted; the entry exports `sql` and `type SqlExpression`. `.default()` takes a `SqlExpression` and runs the reserved-function and unsafe-SQL checks. Index `where`/`expression`, `IndexConstraint.where` and `check` `expression` are `SqlExpression`; lowering reads them through `requireSqlExpression`, testing `isSqlExpression` before `'render' in`. Tests: `raw-sql-fields.test-d.ts`, `contract-dsl.default-sql-expression.test.ts`, `contract-lowering.sql-expression.test.ts`. The old tag tests moved into the sql-contract test.
- **Postgres** (`2af0096d89`): policy handles and descriptors, `fullTextIndex` `where`, and the target's `RlsPolicyHandleShape` hold `SqlExpression`; the target lowers predicates through `requireSqlExpression`. Both facades export `type SqlExpression`. `rls-handles.test-d.ts` and `full-text-index.test-d.ts` assert strings are type errors.
- **Call sites** (`46fd2ddc68`, `8ebe465a9c`): every TypeScript test and fixture that passed a string, including the RLS parity fixture, `contract-expression-authored.ts`, the sql-builder fixture and the walking skeleton, which now composes its edited predicate by interpolation.
- **Parity fixture** (`c80d9a8519`): `test/integration/test/authoring/parity/sql-expressions/` covers a partial index and a raw default over indented lines, an expression index, a full-text index with `where`, a check with a backslash, and a policy whose TypeScript `withCheck` interpolates its `using`.
- **Carried over, registration** (`b4b8a95264`): `sqlExpressionRegistration = { dataTypes, authoring }`, used by the family descriptor and spread in the four fixtures.
- **Carried over, defaults that do not read back** (`03a1daaada`): `contract print` refuses such a default through `refuseSqlTextThatDoesNotReadBack` with kind `default` and the column's coordinate. `contract infer` prints it and adds `// prisma: default of "<column>" holds text a sql literal cannot write back unchanged; check its string constants before applying a migration`. Tests in `refusals-sql-text.test.ts` and `infer-sql-expression-literals.test.ts`. Recorded in ADR 129, ADR 260, design 11.2, the error reference and the app fragment.
- **Upgrade fragments** (`1dab1c6edb`): `upgrade-instructions/pending/sql-expression-literals-ts/{app,extension}` with the change ids of design 20.
- **Docs** (`dfc4539e9b`): ADRs 129, 234, 236, 243, 244, 254, 260; the error reference; the contract-ts README; `skills/prisma-8/references/contract.md`; the adapters subsystem doc; design 11.2 and the plan's "Carried over" entries. The codec authoring guide has no TypeScript raw-SQL place.
- **Manual QA** (`fdecb64281`): slice 3 script and run in `manual-qa.md`; every case gave the expected result.

### Design corrections

- `canonicalizeTaggedLiteralBody` returns `text`, not `body` (renamed in slice 2t); the constructor uses `canonical.text`.
- `.default()` is typed through `DefaultArgumentOf<State>`, not one parameter type; `SqlExpression` joins its non-enum arm.
- The default checks are `reservedSqlDefaultText` and `checkSqlDefaultText` (renamed in slice 2a).

### Verification

Logs in the gitignored `wip/3/`.

- Pass: `build.log`, `typecheck.log`, `lint.log`, `lint:deps.log`, `lint:skills.log`, `check:error-reference.log` (362 codes), `fixtures:check.log` (tree clean). `lint:casts` and `lint:throws` delta 0. `lint:framework-vocabulary` 272 of 272. `test:scripts`: 593 pass.
- `test:packages` (`test-packages.log`): 1453 files pass, 7 fail. The three tarball tests are the known failures. `render-typescript.roundtrip.test.ts`, the two `cli-telemetry` files and `cli` `lsp.test.ts` pass alone (`rerun-render-roundtrip.log`, `rerun-cli-telemetry.log`, `rerun-cli-lsp.log`).
- Integration files alone (`integration.log`): `test/authoring`, `test/sql-builder`, the walking skeleton, the two journeys, `test/psl-print`, `rls-helper-invisibility`, `family.schema-verify.index-drift`: 92 files, 1276 tests pass. Postgres extension 25 files and Supabase 18 files pass (`ext-postgres.log`, `ext-supabase.log`). Adapter `check-lifecycle-e2e.integration.test.ts` passes (`check-lifecycle.log`).
- Fragments (`fragment-validation.log`): the extension prose, applied to `packages/3-extensions/` restored to `ed1df11285`, reproduces every non-test change; tests stay at the base. No `examples/` change. Detection patterns: 62 true-positive and nearest-false-positive cases pass (`detection-check.mjs`).
- Done-condition grep (`grep-done-condition.log`): empty.
- `check:upgrade-coverage`: `upgrade-coverage.log`, run after the status commit.

### Slice 3 review fixes, 2026-10-01

Brief: `dispatches/3-review-fixes-brief.md`. Reviews: `slice-reviews/3/`. Commits `a96c781ef6` to the status commit. Not pushed, no pull request. No findings file: no decision was wrong against the code.

- **A01**: in the `sql` tag, each line of an interpolated value after its first is prefixed with the spaces and tabs at the start of the last line of the text joined so far. That is not always the template line the `${…}` sits on: after a multi-line value on the same line it is the value's last line. Round 2 (B01) changed the code to use the template line. The joined text is then canonicalized once. Unit tests compare with `canonicalSqlText` of the same SQL written out. The parity fixture adds `post_admin_write`, a multi-line predicate interpolated into an indented `withCheck`; it fails with the old join (`parity-red-old-join.log`). Design section 2, ADRs 129 and 260, the README and both fragments state the rule.
- **A02, A03**: ADR 129's infer bullet ends at the print refusal; the default bullet names `.defaultSql()` too. ADR 260 has a section "Column defaults that do not read back" that says what each command keeps unchanged. ADR 129, the error reference, design 11.2 and the app fragment link to it.
- **A04 and the deferred item**: the `what` strings are `Index "<name>" where`, `Index "<name>" expression`, `Check "<name>" expression`, `Full-text index "<name>" where`, `Policy "<name>" using`, `Policy "<name>" withCheck`. `<name>` is `name`, else `map`. An unnamed index or check is `Index on "<Model>"` or `Check on "<Model>"` (the check form extends the decision the same way). `fullTextIndex` checks its own `where`, because lowering cannot tell a full-text index from another index. Design 15 and the error reference record the strings.
- **A05**: the doc comment sits on `refuseSqlTextThatDoesNotReadBack` and names column defaults.
- **A06, F05, frozen registration**: `sqlExpressionRegistration` is `{ dataTypes, authoring: { dataTypes } }`, frozen at its containers (round 2, B05, freezes the data type and the entry too). The family descriptor, the language-server test and six fixtures read it.
- **A07**: lowering canonicalizes the text `render` returns with `new SqlExpression(...)`. Test in `contract-builder.deferred-index-expression.test.ts`.
- **A08**: ADR 254 names `sql/expression` as the one type without a codec.
- **A09**: app change `infer-notes-defaults-that-do-not-read-back`, detection `**/contract.prisma` with `@default(sql` whose backtick text does not close on its line, or a double-quoted text holding `\r` or `\n`. The extension fragment keeps one sentence.
- **F01**: both raw-SQL detections use `glob: ["**/*.{ts,mts,cts}", "!**/migrations/**"]`; the prose says migration files keep strings.
- **F02**: `rls-entities.test.ts` refuses a string `using` and `withCheck` on `policyUpdate`, asserting code, message and meta.
- **F03, F04, F07**: several interpolated values, oversize `meta`, `not.toExtend`, and the whole inferred default line.
- **F06**: the extension import detection matches only imports that name `sql`.
- **Deferred items**: ADR 260's example defines `Post` and compiles against `@prisma/orm-postgres` (`adr-260-example-tsc.log`). The plan lists a public way to build a `sql` value from a computed string under "Deferred beyond this project".

Verification, logs in `wip/3-fixes/`: `build`, `typecheck`, `lint`, `lint:deps`, `lint:skills`, `check:error-reference` (362 codes), `fixtures:check` (tree clean) pass; `lint:casts` and `lint:throws` delta 0; `lint:framework-vocabulary` 272 of 272. Detection check: 81 cases pass (`detection-check.log`). Integration files: 88 files, 1262 tests pass (`integration.log`). Postgres extension: 25 files pass (`ext-postgres.log`). `test:packages` (`test-packages.log`): 1450 files pass, 10 fail. The three tarball tests are the known failures. The two `language-server` files and `mongo-orm` `polymorphism.test.ts` pass alone (`rerun-language-server.log`, `rerun-mongo-polymorphism.log`). `render-typescript.roundtrip.test.ts`, the two `cli-telemetry` files and `driver.buffered-release.integration.test.ts` failed again alone with timeouts while the machine's load average was about 230 (`rerun-render-roundtrip.log`, `rerun-cli-telemetry.log`, `rerun-driver-buffered.log`); none of them is touched by these fixes, and different tests time out on each run. CI must confirm them. `check:upgrade-coverage` after the status commit: `upgrade-coverage.log`.

### Slice 3 review fixes, round 2, 2026-10-01

Brief: `dispatches/3-round-2-fixes-brief.md`. Reviews: `slice-reviews/3-round-2/`. Commits `2f54391c64` to the status commit. Not pushed, no pull request. Findings file: `dispatches/3-round-2-fixes-findings.md` (B04).

- **B01, G01**: the `sql` tag takes the indentation for a value's later lines from the template pieces only. It is the leading spaces and tabs of the last line of the most recent template piece that holds a line break; inserted text never changes it. Two values on one template line both take that line's indentation. New tests: two multi-line values on one line, a value after one that ends on an indented line (also adjacent placeholders), and a value on the next template line. Design section 2 states the rule once; the round 1 A01 bullet is corrected.
- **B02, G04**: the README says lowering canonicalizes the rendered string. Both fragments' `storage-hash-may-change-once` say a `render` that returns text that is not canonical stores different text once, and that `fullTextIndex` is not affected. The app fragment and the extension fragment's API list say the rendered text is canonicalized.
- **B03**: lowering catches the canonicalizer's refusal of a rendered index text and throws `CONTRACT.SQL_EXPRESSION_INVALID` with `Index "<name>" expression: ` in front of the message and `what` added to `meta`. Tested with a NUL character. The error reference and design sections 13 and 15.3 say so.
- **B04, G02**: `fullTextIndex` receives a `ColumnRef`, which has no model name, so it cannot write `Full-text index on "<Model>" where` (findings file). Decided: option 1. A full-text index with neither `name` nor `map` reports `Full-text index on "<field>" where`, using the column's field name. Tested with an untyped call that passes a string `where` and no name or map; design section 15.3 and the error reference record the string.
- **B05**: frozen now: the registration, its array and two records, `sqlExpressionDataType` and its `casts`, and `sqlExpressionAuthoringEntry` and its `written` object. No consumer mutates them; the readers spread copies. The test name lists exactly these.
- **B06**: design section 2 shows `SqlExpressionRegistration` and `sqlExpressionRegistration`, and the `sql` doc comment matches the code. Section 3.1 says the descriptor reads the registration.
- **G03**: both fragments' raw-SQL detections use the single glob `**/*.{ts,mts,cts}`. The prose says to skip files under a `migrations/` folder, because migration functions keep taking strings. No committed helper gave the list form meaning.

Verification, logs in `wip/3-round-2/`: `build`, `typecheck`, `lint`, `lint:deps`, `check:error-reference` (362 codes) and `fixtures:check` (tree clean) pass. `pnpm test`: sql-contract 452 tests, sql-contract-ts 535, Postgres extension 287, all pass. `test/integration` `test/authoring`: 28 files, 198 tests pass. `test:packages` was not run this round, as the brief says. `check:upgrade-coverage` after the status commit: `upgrade-coverage.log`.

## Slice 1, 2026-09-30

Built in the linked worktree `wip/wt-1` from `main`, since it depends on no other slice. Briefs: `dispatches/1-implementer-brief.md`, `dispatches/1-review-fixes-brief.md`. Reviews: `slice-reviews/1/` and `slice-reviews/1-round-2/`. Round 1 found a real bug: the SQLite migration-file renderer passed the `OpaqueSql` object to the JSON printer. Round 2 corrected the app fragment: only the wire name changes, not a policy's stored body, and the plan drops and recreates the object. PR https://github.com/prisma/orm/pull/30546.

### Slice 2t wording: refusals lead with what to write, 2026-10-06

Brief: `dispatches/2t-wording-brief.md`. Serhii's review of #30539 found `pg/int4 has no cast from pg/text; write a number` worse than `Expected a number`; Will agreed. Design notes item 15 records it.

- `describeRefusal(refusal, support, guidance)` takes `RefusalGuidance`, `{ forms, rewrite }`. `forms` are the phrases of the new `admittedFormPhrases`; `describeAdmittedForms` joins them.
- Messages: `Expected <forms>`; `Expected <forms>; write <literal>` for a quoted string on a type with a tag; `Expected <forms> that <type> can hold; got <value type>` when the value's written form is one of the forms; `Expected <forms>; this target has no data type for a <syntax> value`.
- `lowerDataTypeDefault`: `no-list-cast` is `Expected <forms>; got a list`; `no-element-cast` goes through the `no-cast` rule of `describeRefusal`.
- The brief named `taggedLiteralTextReadsBack`, which did not exist. It is new in `tagged-literal.ts`, beside `printTaggedLiteral`: it holds when the printed literal's canonical text equals the text. A string with leading indentation, for example, now gets no rewrite. The `it as a sql literal` fallback the brief mentions did not exist in the code either, so nothing was removed for it.
- `NO_WRITTEN_FORM` is no longer exported.
- Docs: ADR 231, ADR 254, `error-reference.md`, the contract-psl README, the pending `arguments-typed-by-data-type` and `sql-is-a-data-type` fragments, and design sections 4, 6 and 7. The `default-refusals-say-what-to-write` detection pattern for `this target has no data type` now requires `: ` or a quote before it, so it no longer matches the new messages.

Review fixes (brief `dispatches/2t-wording-fixes-brief.md`, reviews in `slice-reviews/2t-wording/`): the framework's `exactRewrite` decides the exact rewrite for `dataTypeValue` and `@default` alike, so `meta Jsonb @default("{}")` says ``Expected json`...`; write json`{}` ``; it is offered only when the receiving type takes the rewritten literal. `RefusalGuidance.forms` holds `WrittenForm` values (kind, tag, phrase), and the range rule compares kinds, not phrases. `describeExpected` builds every `Expected <forms>` sentence, and `describeRefusedValueType` words the `no-cast` rule for both callers and the list-element arm, which no longer invents a refusal. The not-a-literal refusal reads ``Expected sql`...`; got an identifier``. `dataTypeValue` throws an `InternalError` for a registered type nothing writes. `taggedLiteralTextReadsBack` is now `printedTaggedLiteralReadsBack`. New tests: the round trip of the offered rewrite through the PSL parser, a narrow list cast that reaches the range rule, the value type on each assembled stack, and one message for the same refusal as `@default` and as an argument. B07 accepted as is. Logs in `wip/2t-wording-fixes/`.

Round two (`slice-reviews/2t-wording-round-2/code-review.md`) confirmed every finding fixed and raised four small ones (H01 to H04), fixed the same day: ADR 231 names the "receiving type takes it" condition and the no-written-form internal error; the `dataTypeValue` label uses `tagForm`; `printedTaggedLiteralReadsBack` is no longer exported; the extension fragment lists `WrittenForm`, `RefusalGuidance` and `tagForm`. The deferred items in that review (codec check of a rewrite, newlines in a multi-line rewrite, one tag per type) are accepted costs. `main` (`45c3b5b076`) was merged in the same day.

## Slice 2b review, round 3, 2026-10-07

hammurabi-31 took over from marconi-29. Brief: `dispatches/2b-round-3-review-brief.md`. Reviews: `slice-reviews/2b-round-3/` (C01 to C08, D01 to D09). Code fixes brief: `dispatches/2b-round-3-fixes-brief.md`.

- `main` merged again (`7fa9184840`); no conflicts, no released fragment touched. The ADR moved from 267 to 268 (`20f0af8117`), because #30641 claims 267.
- No merge dropped behaviour. The findings were text the merges left behind, two untested paths, one test that could not fail, and one file outside the slice.
- **Code and tests** (implementer): block value completion and block keyword snippets are tested to receive the source's data types, and `using = |` in a `policy_select` block offers `sql` on the real Postgres stack (D03, C04); the block spec factory test is named for what it checks and asserts the data types by identity (D04); the Postgres tests build block spec contexts with `blockSpecContext` (D05); the codemod's unclosed-backtick test fails without its fix (D06); the print refusal says "blank lines at the start or end" (C05). Every new test was shown to fail with its defect planted; logs in `wip/2b-round-3-fixes/`.
- **Docs** (orchestrator): ADR 268 no longer says a line comment renames anything or that the line-comment rule is unbuilt (C01, D01); ADR 129 and the ADR index say only exact-named objects are skipped (C07, D01); the extension fragment's `BlockSpecContext` is `{ symbols, dataTypes }`, its stale supersede sentence is gone and its change id is `block-spec-context-carries-data-types` (C02, C03, D02); the error reference (C05); the editor tooling brief says a policy's `using` completes `sql` (C04, D03); the Supabase skill reference states the escapes (D08); the spec and the manual QA table quote the current messages (C06, D09); the Data Contract subsystem doc's tagged-literal section matches ADR 129; this file.
- **Fixes check:** both reviewers confirmed every finding fixed and added one, D10: the test that a policy's `using` completes `sql` on the real Postgres stack loaded Postgres's source from the language server's tests. It moved to `test/integration/test/authoring/lsp-sql-completion-in-blocks.integration.test.ts`, which drives the language server over its protocol in a Postgres project.
- **Line comments in the journey:** the plan gave slice 1 the job of adding a `--` case to `sql-expression-literals.e2e.test.ts`, but slice 1 merged before that file existed. The journey's partial index, CHECK and `withCheck` texts now end in a `--` comment, and the journey passes. A run with `renderOpaqueSql` broken was not done (the permission check refused editing production code for it); slice 1's unit and PGlite tests cover that function.
- **Not changed:** the Bash hook in `.claude/scripts/enforce-tools.mjs` (C08, D07). Will asked for it, round 1 (F08) kept it in this pull request, and the description names it as unrelated.

## Slice 4, 2026-10-01

Built in the linked worktree `wip/wt-1`, stacked on slice 1. Briefs: `dispatches/4-implementer-brief.md`, `4-review-fixes-brief.md`, `4-round-2-fixes-brief.md`. Reviews: `slice-reviews/4/` and `4-round-2/`. Round 1 found three column-default render sites the design missed (`setDefault`, SQLite `addColumn` and `recreateTable`); round 2 made every hand-listed renderer typed over its input's keys. PR https://github.com/prisma/orm/pull/30554.

## Slice order and tickets

| Order | Plan slice | Ticket | State |
| --- | --- | --- | --- |
| 1 | 2a: `sql` is the data type `sql/expression` | TML-3296 | Merged 2026-09-30 (#30534) |
| 2 | 2t: an argument declares the data type it receives | TML-3367 | Merged 2026-10-07 (#30539), shipped in rc.16 |
| 3 | 2b: the six places take `sql` literals | TML-3288 | Merged 2026-10-08 (#30550) |
| 4 | 3: the TypeScript builder takes `sql` values | TML-3289 | #30558 against `main`, up to date; review round 3 next |
| On the side | 1: line comments in raw SQL | TML-3287 | Merged (#30546) |
| Last | 4: migration files write template literals | TML-3290 | Merged (#30554) |
| Stretch | 5: migration files write `sql` values | TML-3297 | Confirmed by Will 2026-10-08; starts after slice 3 is with him |

TML-3282 was the decision ticket and is done.

## Why slices 2a and 2t go first

The Linear project "Data types own column types" finishes ADR 254. Its last slice types default-function arguments by data type, for example the `8` in `@default(nanoid(8))`. Will decided on 2026-09-29 that this project builds the argument type `dataTypeValue` and that project reuses it. That project is blocked until TML-3367 merges. Its requirements are listed in TML-3367 and in design-notes decision 14.

Two notes were sent to that project's agent:

- `dataTypeValue` is used as a parameter of a `funcCall`, not as a bare arm of `oneOf`. A `funcCall` claims a call to its name (`ArgType.claims`), and when exactly one arm claims the argument `oneOf` keeps that arm's diagnostics, so `@default(nanoid("8"))` can report the cast refusal at `"8"` (updated 2026-09-30).
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
