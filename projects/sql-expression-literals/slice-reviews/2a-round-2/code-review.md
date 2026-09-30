# Code review, round 2: slice 2a review fixes

Range: `f768a4e831..77fa856832` on branch `tml-3296-sql-expression-data-type` (Linear TML-3296), read at HEAD `ce5dacdbb5`, which merges `origin/main` (`d501bfbe69`) on top. Lens: principal engineer (failure modes, blast radius, operability, tests that can fail). Scratch output: `wip/review-2a-r2/`.

## Summary

The fixes do what the brief decided. The family descriptor registers `sql/expression`, the targets no longer list it, and `createSqlFamilyInstance` refuses a stack whose data types cast from `sql/expression`. Every round 1 finding is fixed as decided. The new tests fail when the behaviour they name is removed. The code has no `any`, no bare `as` in production code and no new comments beyond doc comments on exports.

What is left is evidence and prose, not code. The recorded manual QA run was made before A01, so it shows the old tag order and contradicts its own expected table (G01). One sentence of the extension upgrade fragment names the wrong error code for the case it describes (G02). ADR 254 says `@default` reports the unknown-tag code at the attribute, but it is reported at the literal (G03). The spec's "Adapter impact" section still says each target registers `sql/expression` (G04).

The merge of `origin/main` does not touch slice code. It changed three files the slice also changed (`ADR-INDEX.md`, `error-reference.md`, `orm-postgres/package.json`), each in hunks the slice does not touch. The `./family-contract/sql-expression` subpath is still exported.

## What looks solid

- A01. `SqlFamilyDescriptor` carries `dataTypes: [sqlExpressionDataType]` and the entry under `SQL_EXPRESSION_DATA_TYPE_ID` (packages/2-sql/9-family/src/core/control-descriptor.ts lines 24-31). `createControlStack` assembles the family first (packages/1-framework/1-core/framework-components/src/control/control-stack.ts line 809), so the control stack, the PSL interpreter, the Prisma 7 reader, `contract print` and the language server's `pipelineInputsFromStack` see the type and entry. `contract infer` does not read the stack; design section 11.1 (design.md line 404) and status.md record this, and it changes no output because infer prints SQL through `printSqlExpressionLiteral`.
- F03. `assertNothingCastsFromSqlExpression` checks both `casts` and `listCast.of`, names the type and the rule, and uses `runtimeError`, the same kind `enforceDataTypeInvariants` throws. The check sits in `createSqlFamilyInstance` (packages/2-sql/9-family/src/core/control-instance.ts lines 512-516), which every CLI command that emits, prints, infers, plans, verifies or migrates goes through (`config.family.create(...)` in `contract-emit.ts`, `contract-print.ts`, `client.ts`, `migration-plan.ts`, `migration-new.ts`, `migration-check.ts`, `orm/migrate.ts`, `orm/db/verification.ts`, `orm/migration/show.ts`). The language server does not create a family instance, and the error reference says so. The framework's own `CONTRACT.DATA_TYPE_NOT_WRITABLE` check does not catch such a cast, because the family's entry makes `sql/expression` writable, so this family check is the only one; the tests in `control-instance.sql-expression-casts.test.ts` fail if the call is removed.
- The descriptor list the check reads (`family, target, adapter, ...extensions`) is the same set `createControlStack` assembles. `DataTypeLookup` has only `get` and `has`, so reading the descriptors is the only way to list the types; design section 3 records this.
- `runtimeError` is newly exported from the shared-plane `@internal/framework-components/codec` entry. It was already exported from `/runtime`; `@internal/sql-contract` is shared plane and cannot import `/runtime`, so the second export is needed. Both are in `exports/`.
- A02. `test/integration/test/authoring/sql-expression-registration.test.ts` assembles Postgres with all five SQL extension packs the repository ships and SQLite, asserts `toBe` on the declaration and the entry, and runs `sql.create(stack)`. Passes (`wip/review-2a-r2/t-int.log`).
- A03. `@default` passes `sqlTextFromCanonical(read.typed.value)` to `sqlExpressionDefault`. The new test with a parenthesizing `parse` (interpreter.defaults.tagged-literal.test.ts lines 122-134) fails if the code goes back to the written text.
- F04. The Postgres and SQLite entry tests restore every classifier bound, the boolean refusals, JSON read and print and numeric print that the deleted adapter tests held (17 and 41 tests pass, `wip/review-2a-r2/t-pg.log`, `t-sqlite.log`). SQLite has no boolean entry, so there is nothing more to restore.
- F05. The refusal table now asserts whole messages, and the two `unreadable` rows (a throwing cast and a throwing list cast) assert `PSL_INVALID_LITERAL` (65 tests pass, `wip/review-2a-r2/t-psl.log`).
- F07. The infer round trip adds a `jsonb` default holding a backtick and a backslash, printed by the real printer and parsed by the real parser.
- F01. The detection pattern matches every row of the round 1 table. I reran the table plus four more cases (`wip/review-2a-r2/regex.log`).
- Blast radius of removed names: `grep` finds no reference to `sqlTextReadsBack`, `PSL_DEFAULT_TYPE_INCOMPATIBLE` (outside released notes and the upgrade table), `lowerTaggedLiteral` or the `writingSurface` skip in source. `canonicalizeTaggedLiteralBody`, `describeTaggedLiteralFailure` and `resolveTemplateTagEscapes` are still exported from `/control`, where their callers import them; the removed `/authoring` exports were added by this slice and never released.
- Test names omit "should". Test files only use casts in hand-built stacks.

## Findings

### G01: The recorded manual QA run predates A01 and contradicts the expected table

Location: projects/sql-expression-literals/manual-qa.md lines 67, 111-140; projects/sql-expression-literals/status.md, "Review fixes" bullet "Manual QA rerun recorded".

Issue: The expected row for case 2 now says the known tags are `sql, json`, because the family is assembled before the target. The run of 2026-09-30 was recorded in `d9583a7ed6`, before A01 (`273731b288`). Its case 2 output shows `Known tags: json, sql.` (line 121), yet its result line says every case gave the expected result. status.md repeats the claim. No automated test shows the tag order on a real assembled stack either: the completion test builds the order by hand (`withFamilyEntry` in completion-provider.test.ts lines 1368-1372 puts the family entry first itself), and contract-psl tests use the fixture, which mirrors the order by hand. The upgrade fragments promise users the new order (`sql, json`) in the message, in completion and in "Expected one of". From the code the promise holds (family first at control-stack.ts line 809, merged in insertion order), but nothing that ran shows it.

Suggestion: Rerun the manual QA script on HEAD and record the run. Add one assertion to `sql-expression-registration.test.ts` that pins the order a user sees:

```ts
expect(Object.keys(stack.authoringContributions.dataTypes)[0]).toBe(SQL_EXPRESSION_DATA_TYPE_ID);
```

Correct the status.md sentence.

### G02: The extension fragment names the wrong error for a target that also registers `sql/expression`

Location: upgrade-instructions/pending/sql-is-a-data-type/extension/instructions.md line 89.

Issue: The fragment says "a target that registered it too fails assembly with `CONTRACT.DATA_TYPE_DUPLICATE`". A target that registers `sql/expression` registers the entry too, because a type without its entry is useless for PSL. `createControlStack` merges authoring contributions (control-stack.ts line 811) before it assembles data types (line 813), so such a target fails with `CONTRACT.DATA_TYPE_ENTRY_DUPLICATE` first. `DATA_TYPE_DUPLICATE` appears only when the target registers the type without the entry. An agent following the fragment searches its logs for a code it will not see.

Suggestion: Write "fails assembly with `CONTRACT.DATA_TYPE_ENTRY_DUPLICATE` (or `CONTRACT.DATA_TYPE_DUPLICATE` if it registers only the type). Remove both from the target."

### G03: ADR 254 says `@default` reports the unknown-tag code at the attribute; it is reported at the literal

Location: docs/architecture docs/adrs/ADR 254 - Data types and casts.md line 151; projects/sql-expression-literals/plan.md line 91.

Issue: A09's fix ends the bullet with "`@default` reports each of these codes at the `@default` attribute", and "these codes" includes `PSL_UNKNOWN_LITERAL_TAG`. But `readTaggedLiteral` reports an unknown tag at the literal (`source.at(literal.span)`, psl-column-resolution.ts line 575). The error reference says "Reported at the literal" (error-reference.md line 790), and manual QA case 2 shows column 21, the literal. The slice 2t carry-over in plan.md line 91 lists `PSL_UNKNOWN_LITERAL_TAG` among the codes to move to the written value, although it is already there. The brief's A09 decision was to state where `@default` reports; the sentence states it wrongly for one code.

Suggestion: In ADR 254, write "`@default` reports `PSL_UNKNOWN_LITERAL_TAG` at the literal and the other codes at the `@default` attribute." Drop `PSL_UNKNOWN_LITERAL_TAG` from the plan.md carry-over list.

### G04: The spec's "Adapter impact" still says each target registers `sql/expression`

Location: projects/sql-expression-literals/spec.md line 89.

Issue: Commit `d94c4db032` updated requirement 1 ("The family registers the declaration and the entry itself") but left "Each target registers the family's `sql/expression` declaration and entry." in the "Adapter impact" section. The two sentences contradict each other, and slices 2t, 2b and 3 read this spec.

Suggestion: Replace the sentence with "The SQL family registers `sql/expression` and its entry; the targets do not."

## Deferred (out of scope)

- The detection pattern of F01 still matches a bare file name in quotes, such as `readFileSync('pg.sql')` or `"sqlite.sql"`, and misses a comment between the tag and the string (`pg.sql // x` then a newline and a backtick) (`wip/review-2a-r2/regex.log`). The operator settled the pattern in the brief (F01), and a false positive only makes the consumer's agent read one line, so I do not reopen it.
- `contract infer` builds its default mapping from the target's own lists (packages/3-targets/3-targets/postgres/src/core/psl-infer/postgres-default-mapping.ts), so it sees no family or extension data type. This is existing behaviour, recorded in design section 11.1 and the fix findings, and changes no output in this slice. It belongs to the project "Data types own column types", which owns how infer reads data types, or to slice 2b if its printers ever need an entry from the stack.
- The check runs in `createSqlFamilyInstance`, which `contract emit` and `contract print` call after they interpret the schema. With a bad pack, PSL diagnostics from the interpretation, if any, show first, and the pack error shows only once the schema is clean. No wrong contract is written, because the command still fails before it writes. Moving the check earlier would need the PSL interpreter to run SQL-family code at stack time, which slice 2t (spec contexts carry the stack's data types) is the natural place to decide.

## Already addressed

| Round 1 finding | Fixed in | Matches the brief's decision |
| --- | --- | --- |
| A01 family registers `sql/expression` | `273731b288`, `54680fc713`, `d94c4db032` | Yes. The infer gap was reported and resolved as the brief asked. One stale spec sentence remains (G04) |
| A02 assembled-stack test | `f747b80f48` | Yes, `toBe` on both, both targets, all five Postgres packs |
| A03 `@default` reads the value | `7b3e2215a7` | Yes, with a test that fails on the old code |
| A04 delete the `writingSurface` skip | `02c6e2e66e` | Yes, test renamed, F06 test not added |
| A05 rename to `PSL_DEFAULT_LIST_EXPECTED` | `ba2d9617cf` | Yes: code, tests, error reference, ADR 254, fragments, manual QA, design 10.1 |
| A06 "a SQL expression" | `2cbb418972` | Yes: code comment, entry documentation, ADR 254, subsystem doc 6 |
| A07 one prefix rule | `6e4c5f16f0` | Yes: rule in ADR 254, linked from ADR 129, new H1, index row, TypeScript sentence |
| A08 body and text | `6e4c5f16f0`, `ebb9ba2f52` | Yes, `TaggedLiteralCanonicalization.body` kept and recorded for slice 2t |
| A09 where `@default` reports | `6e4c5f16f0` | Partly: the sentence is wrong for `PSL_UNKNOWN_LITERAL_TAG` (G03) |
| A10 `readTaggedLiteral` | `37d3335e2d` | Yes, own result type |
| A11 `PSL_INVALID_DEFAULT_SQL` next to its user | `37d3335e2d` | Yes |
| A12 framework tests use `postgis.geometry` | `269b34a1f5` | Yes |
| A13 `data-type-support.ts` header | `c75af45986` | Yes |
| A14 no pointers to slice 2b | `8f58899b56` | Yes: ADR 254 pointer, `sqlTextReadsBack` removed, unused `authoring` exports removed, plan and design 2 updated |
| F01 detection pattern | `3d9ef85ae9` | Yes, the reviewer's pattern in both fragments and design 20 |
| F02 fragment text | `3d9ef85ae9`, `54680fc713` | Yes, with one new misstatement (G02) |
| F03 cast check in code | `6806e547c0`, `f3c8637354`, `b8cbc6d152` | Yes, in `createSqlFamilyInstance`, `runtimeError`, tested |
| F04 target entry tests | `0758b260fc` | Yes |
| F05 two `unreadable` rows, whole messages | `2452519d88` | Yes |
| F06 test name | `02c6e2e66e` | Yes, renamed; no new test, as decided |
| F07 double-quote form read back | `c14ff89da5` | Yes |
| F08 unreachable case in error reference | `6e4c5f16f0` | Yes |
| F09 design line reference | `02c6e2e66e` | Yes, design.md line 397 says `:155-165`, which matches the function |

## Acceptance-criteria verification

Paths are shortened: `contract-psl/` is packages/2-sql/2-authoring/contract-psl, `9-family/` is packages/2-sql/9-family.

| ID | Criterion (source) | Verdict | Detail |
| --- | --- | --- | --- |
| A1 | `sql/expression` is a data type the SQL family defines and registers (plan outcome; spec requirement 1) | PASS | `9-family/src/core/control-descriptor.ts` lines 24-31. The integration test asserts `toBe` on the assembled Postgres and SQLite stacks; adapter tests assert the targets hold no `sql/expression` key and only the `json` tag. |
| A2 | The lowering-entry kind, `pg.sql` and `sqlite.sql` are gone (plan outcome) | PASS | Unchanged since round 1; `pg.sql` asserted unknown with the whole message `Known tags: sql, json.` (tagged-literal test line 159). |
| A3 | `@default` stores a `sql/expression` value as a default expression and keeps its own checks (plan outcome; spec requirement 3) | PASS | Reads the canonical value (A03); reserved and unsafe checks unchanged; test at tagged-literal test lines 122-134. |
| A4 | `@default` refusals from the cast rule use the general codes (plan outcome) | PASS | `data-type-default.ts` maps every kind as design 10.1 says; every row, including both `unreadable` origins, asserts code and whole message. |
| A5 | `contract infer` prints raw defaults through the one tagged-literal printer (plan outcome; spec requirement 6) | PASS | `writingSurface` has no key-based skip; the infer round trip reads the double-quote form back. |
| A6 | No `contract.json` changes (plan outcome) | PASS | No `contract.json` in the range; status.md records `fixtures:check` clean after A01. |
| T1 | `` @default(sql`gen_random_uuid()`) `` stores the same default (TML-3296) | PASS | Manual QA case 1 and the unchanged parity fixture. |
| T2 | `` pg.sql`...` `` is unknown and lists the known tags (TML-3296) | WEAK | Asserted on the fixture stack with `sql, json`. On a real stack the only recorded run shows `json, sql`, from before A01 (G01). The code gives `sql, json`. |
| T3 | The framework has no lowering-entry kind (TML-3296) | PASS | Unchanged since round 1. |
| T4 | `fixtures:check` shows no contract change (TML-3296) | PASS | status.md, `wip/v3/`. |
| S1 | One type owned and registered by the family; no prefixed tag (spec requirement 1) | PASS | See A1. The spec's "Adapter impact" text is stale (G04), but the code meets the requirement. |
| S2 | `@default` keeps its SQL checks in PSL and TypeScript (spec requirement 3) | PASS | Unchanged since round 1. |
| S3 | Same SQL default emits the same contract from PSL and TypeScript (spec requirement 4) | PASS | Parity fixture unchanged. |
| S4 | Names and stored text do not change (spec requirement 5) | PASS | No canonicalization change. |
| S5 | `contract infer` prints raw defaults as `sql` literals (spec requirement 6) | PASS | See A5. |
| S6 | Breaking changes documented for both audiences (spec requirement 9) | WEAK | Pattern, list-literal row, rename row and `DefaultRefusal` change are in. One sentence names the wrong code (G02). |
| S7 | `pg.sql` and `sqlite.sql` refused as unknown tags (project DoD) | PASS | See A2. |
| P1 | `sql-expression.test.ts` (plan tests) | PASS | Id, no casts, tag, round trip, `sqlTextFromCanonical`; `sqlTextReadsBack` moved to 2b as the plan now says; plus the three `assertNothingCastsFromSqlExpression` cases with whole messages. |
| P2 | `data-type-assembly.test.ts` (plan tests) | PASS | Unchanged since round 1. |
| P3 | Target `data-types.test.ts`: no type casts from `sql/expression` (plan tests) | PASS | Postgres line 103, SQLite line 42; plus the stack-level check in `9-family/test/control-instance.sql-expression-casts.test.ts`. |
| P4 | Target `data-types.test.ts` and adapter tests per design 18.3 (plan tests) | PASS | Id lists no longer hold `sql/expression`; adapter tests assert `hasSqlExpression: false` and tags `['json']`. |
| P5 | `interpreter.defaults.tagged-literal.test.ts` (plan tests) | PASS | Whole-message assertions, `sql, json` order on the fixture, list-element refusal. |
| P6 | `interpreter.defaults.data-types.test.ts`: table by design 10.1, code and message (plan tests) | PASS | Was WEAK. Both `unreadable` rows added; messages asserted whole. |
| P7 | `tagged-literal.test.ts` (plan tests) | PASS | Unchanged; the double-quote read-back is now covered by the infer round trip (F07). |
| P8 | `default-mapping.test.ts` (plan tests) | PASS | Test renamed to what it checks. |
| P9 | `completion-provider.test.ts`: `sql` and `json` on Postgres and SQLite, in that order (plan tests) | WEAK | Items and documentation asserted exactly, but the test builds the order itself with `withFamilyEntry`, so it does not show the order a real stack gives (G01). |
| P10 | Existing assertions of changed codes updated (plan tests) | PASS | `PSL_DEFAULT_LIST_EXPECTED` replaces the old name everywhere in tests. |
| P11 | `sql-attribute-specs.test.ts`: tag arm and documentation (plan tests) | PASS | Asserts the new documentation text and `sql` before `json`. |
| D1 | `build`, `typecheck`, `lint`, `lint:deps`, `lint:casts`, `lint:throws`, `check:error-reference` (done conditions) | PASS | status.md, `wip/v2/` and `wip/v3/`. |
| D2 | `test:packages` and `test:integration` (done conditions) | NOT VERIFIED | The coordinator reports the whole suite passed on this tip; I reran only the targeted files above, which pass. The publish-shell and packaging tarball tests cannot run on this machine because `pnpm install` refuses `@vercel/detect-agent@1.2.5`; CI must show them green. |
| D3 | `fixtures:check`, no `contract.json` change (done conditions) | PASS | See T4. |
| D4 | `lint:framework-vocabulary` equals the threshold (done conditions) | PASS | 272 of 272 (status.md). |
| D5 | `check:upgrade-coverage`; fragments validated (done conditions) | PASS | Was WEAK. The check passes; the pattern was tested against true positives and nearest false positives (`wip/v2/f01-detection.log`, `wip/review-2a-r2/regex.log`). The slice changes nothing in `examples/` or `packages/3-extensions/`, so execution has nothing to reproduce. |
| D6 | Manual QA script and a recorded run (done conditions) | FAIL | The latest run predates A01 and its case 2 output contradicts the expected table while claiming it matches (G01). |
| D7 | Grep finds no `pg.sql` or `sqlite.sql` in docs, skills, READMEs, `src/` comments (done conditions) | PASS | Only sentences saying they are unknown; framework tests now use `postgis.geometry`. |
| X1 | Design 3.2, 3.3, 18.2 deletions and moves | PASS | The lost classifier tests are restored (F04). |
| X2 | Design 19 doc rows for slice 2a | WEAK | Was WEAK for F08, which is fixed. Now WEAK for the ADR 254 unknown-tag sentence (G03). |

| Verdict | Count |
| --- | --- |
| PASS | 31 |
| WEAK | 4 |
| FAIL | 1 |
| NOT VERIFIED | 1 |
