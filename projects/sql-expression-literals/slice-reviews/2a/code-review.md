# Code review: slice 2a, `sql` is the data type `sql/expression`

Range: `git diff origin/main...HEAD` on branch `tml-3296-sql-expression-data-type` (merge base `18e3711cbb`), Linear TML-3296. Lens: principal engineer (failure modes, blast radius, tests that can fail, cost).

## Summary

The code does what design sections 2, 3, 10, 10.1 and 11.1 ask, and all four "Done when" items of TML-3296 pass. The gaps are in what ships around the code: the upgrade detection pattern misses real uses of `pg.sql`, the upgrade text misstates one changed diagnostic, the rule "nothing casts from `sql/expression`" is not enforced, and some tests were lost or do not prove what they name.

## What looks solid

- The slice removes a mechanism instead of adding one. The second kind of authoring entry, its reserved keys and its three helper functions are gone, and `enforceDataTypeInvariants` loses two special cases (packages/1-framework/1-core/framework-components/src/control/control-stack.ts lines 432-452). The new test at packages/1-framework/1-core/framework-components/test/data-type-assembly.test.ts line 86 proves that a `lowering:sql` key now fails assembly.
- The `@default` SQL path follows the design order: unknown tag, canonicalization, type, reserved text, unsafe text (packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts lines 561-589 and 669-726). Refusals are reported at the literal, and the tests assert the exact code, message and span (packages/2-sql/2-authoring/contract-psl/test/interpreter.defaults.tagged-literal.test.ts lines 137-188).
- The contract-psl test fixture now registers the real `sqlExpressionAuthoringEntry`. The hand-written copy of the family entry, and the test that compared the copy with the original, are deleted. There is one source of truth.
- `lowerDataTypeDefault` maps refusal kinds to codes exactly as the design 10.1 table says (packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts lines 399-448).
- `printTaggedLiteral` is correct. I ran six texts through the real PSL parser, each with and without an extra indent on continuation lines (12 runs). They held backticks, backslashes, quotes, line breaks and an internal blank line. Each one read back unchanged (`wip/review-2a/roundtrip.log`).
- No contract changes. The parity fixture `test/integration/test/authoring/parity/default-sql-literal/expected.contract.json` is untouched, and `cli.emit-parity-fixtures.test.ts` passes (58 tests, run during this review, `wip/review-2a/parity.log`). `fixtures:check` leaves the tree clean.
- The published shells expose the new subpath, and the build produced the files (`dist/contract__sql-expression.mjs` in `orm-family-sql`, `dist/family-contract__sql-expression.mjs` in `orm-postgres` and `orm-sqlite`).
- Conventions hold. `lint:casts` shows a delta of 0. The new source has doc comments only on exports. Test names omit "should". Docs and READMEs mention `pg.sql` and `sqlite.sql` only to say they are unknown.

## Findings

### F01: The `prefixed-sql-tags-are-removed` detection pattern misses real uses and matches file names

Location: upgrade-instructions/pending/sql-is-a-data-type/app/instructions.md lines 3-9; upgrade-instructions/pending/sql-is-a-data-type/extension/instructions.md lines 3-9.

Issue: The pattern `\b(pg|sqlite)\.sql\s*[\x60"']` needs the dot directly after `pg` and a quote directly after `sql`. It misses two cases that PSL accepts:

1. PSL inside a TypeScript template literal, where the backtick is escaped: `` @default(pg.sql\`now()\`) ``. This is how tests embed PSL, for example packages/3-targets/3-targets/postgres/test/psl-infer/inferred-psl/inferred-psl.defaults-and-types.test.ts line 333. The `**/*.ts` glob is there for these files, but the pattern can never match inside them.
2. A tag with spaces around the dot, `pg . sql "y"`. This repository had one until this slice changed it: packages/1-framework/2-authoring/psl-parser/test/format/fixtures/tagged-literal/input.prisma.

The pattern also matches file names in strings, such as `readFileSync('./seed.pg.sql')`. The skill requires testing each pattern against a true positive and the nearest false positive (skills-contrib/record-upgrade-instructions/SKILL.md line 42). I ran the shipped pattern and a corrected one on these cases (`wip/review-2a/detection-regex.log`):

| Case | Shipped | Suggested |
| --- | --- | --- |
| `` @default(pg.sql`x`) `` | match | match |
| `@default(sqlite.sql "x")` | match | match |
| `@default(pg . sql "y")` | no match | match |
| `` @default(pg.sql\`now()\`) `` in a TS template | no match | match |
| `readFileSync('./seed.pg.sql')` | match | no match |
| `import q from "./init.sqlite.sql"` | match | no match |
| `` mypg.sql`x` `` and `` pg.sqlx` `` | no match | no match |

Suggestion: Use this pattern in both fragments, and change the design section 20 row to match.

```yaml
matches:
  - '(?<![\w./-])(pg|sqlite)\s*\.\s*sql\s*\\?[\x60"'']'
```

### F02: The upgrade text says messages did not change, but one case changed its code, message and location; one exported type change is missing

Location: upgrade-instructions/pending/sql-is-a-data-type/app/instructions.md lines 40-54; upgrade-instructions/pending/sql-is-a-data-type/extension/instructions.md lines 52-66 and 109.

Issue:

- Both fragments say "The messages did not change." That is not true for a `sql` literal inside a list literal. Before this slice it was `PSL_INVALID_DEFAULT_LITERAL`, `Literal tag "sql" produces a default of its own and cannot be an element of a list literal.`, reported at the element. Now it is `PSL_VALUE_TYPE_INCOMPATIBLE`, `Field "T.tags" at element 1: pg/text has no cast from sql/expression; it casts from nothing`, reported at the whole `@default` attribute (psl-column-resolution.ts lines 644-650 use `source.at()` with no span; manual QA case 5 shows column 17). The code table has no row for this case. Its row "Text an authoring entry or a cast refused" maps `PSL_INVALID_DEFAULT_LITERAL` to `PSL_INVALID_LITERAL`, so a reader who follows the table rewrites an assertion for this case to the wrong code.
- The extension fragment names the `WrittenValue` rename but not the other change to an exported type: the `unreadable` arm of `DefaultRefusal` lost its `json` field (packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts lines 60-66). Both types are exported from `@internal/sql-contract-psl/resolution`, but the fragment names the package without the subpath.

Suggestion: Change the sentence to "The messages did not change, except for a `sql` literal inside a list literal." Add a row: "A `sql` literal inside a list literal | `PSL_INVALID_DEFAULT_LITERAL`, at the element | `PSL_VALUE_TYPE_INCOMPATIBLE`, at the `@default` attribute". In the extension fragment, add that `DefaultRefusal`'s `unreadable` arm has no `json` field, and name `@internal/sql-contract-psl/resolution`.

### F03: Nothing enforces that no data type casts from `sql/expression`

Location: packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts lines 698-726; packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts lines 189-219; packages/1-framework/1-core/framework-components/src/control/control-stack.ts lines 445-470; upgrade-instructions/pending/sql-is-a-data-type/extension/instructions.md line 107.

Issue: Design section 1 says no type casts from `sql/expression`, and the extension fragment tells authors not to declare such a cast. The only checks are two tests of the in-repo targets (packages/3-targets/3-targets/postgres/test/data-types.test.ts line 104, packages/3-targets/3-targets/sqlite/test/data-types.test.ts line 43). Assembly accepts such a cast: `sql/expression` is registered and has an entry, so it passes the "writable" check at control-stack.ts lines 445-470. If an extension declares one, the same `sql` literal behaves differently by position:

- `` geom Geometry @default(sql`ST_Point(0, 0)`) `` takes the SQL expression path (psl-column-resolution.ts line 722) and is stored as a function default.
- `` geoms Geometry[] @default([sql`ST_Point(0, 0)`]) `` goes through `castInto` (data-type-default.ts line 189), and the extension's cast turns the SQL text into a literal value.

The contract then stores a literal where the author wrote SQL, with no diagnostic. The rule is an assumption written in docs, not a constraint the code holds.

Suggestion: Make it a constraint. The framework cannot name `sql/expression`, so check it in SQL-family code where the stack's data types are known, for example where contract-psl builds `DataTypeSupport` (packages/2-sql/2-authoring/contract-psl/src/interpreter.ts lines 2164-2167): throw an internal error that names the type and the rule. A cheaper option that covers the `@default` case: in the list path, refuse an element whose type is `sql/expression` before any cast, with the same `PSL_VALUE_TYPE_INCOMPATIBLE` message.

### F04: Deleting the adapter test files removed the only unit tests of both targets' authoring entries

Location: packages/3-targets/6-adapters/postgres/test/data-type-authoring.test.ts and packages/3-targets/6-adapters/sqlite/test/data-type-authoring.test.ts (deleted). The code they tested is kept: packages/3-targets/3-targets/postgres/src/core/data-type-entries.ts lines 28-86 and packages/3-targets/3-targets/sqlite/src/core/data-type-entries.ts lines 22-66.

Issue: Design section 18.3 says to delete these files, because they tested the adapter's lowering entries. But most of their cases tested the target's own entries, which this slice keeps unchanged:

- the Postgres number classifier at each boundary (32767 and 32768, 2^31, 2^63, fractions, `NaN`, `Infinity`, and `1e3`, `0x10` refused);
- the SQLite classifier (the 2^53 split between `sqlite/integer` and `sqlite/bigint`; the words and numbers past 64 bits refused);
- the boolean reader refusing `TRUE`, `yes` and `1`; JSON read and print; numeric print of `1e21`.

No test calls these classifiers or readers any more. `grep -rn "classify(" packages/3-targets --include='*.test.ts'` finds nothing, and the remaining uses of `postgresDataTypeEntries()` and `sqliteDataTypeEntries()` in tests read keys and tags or a few mid-range numbers (`inferred-psl.round-trip.test.ts`). The shared classifier is tested in relational-core, but the target's bounds decide whether `SmallInt @default(32768)` is admitted. A wrong bound now passes every test.

Suggestion: Move the classifier and read/print cases into new files, packages/3-targets/3-targets/postgres/test/data-type-entries.test.ts and the SQLite twin, calling `postgresDataTypeEntries()` and `sqliteDataTypeEntries()`. Drop only the cases about lowering keys.

### F05: Two refusal kinds of the design 10.1 table have no test, and the table asserts message fragments

Location: packages/2-sql/2-authoring/contract-psl/test/interpreter.defaults.data-types.test.ts lines 120-256.

Issue: The plan asks this file to split its table "by the code table in design 10.1, asserting each code and message". The `unreadable` row is tested only for a tag's parse (a `json` body at line 230, and the `bool` tag in the tagged-literal test). No test asserts `PSL_INVALID_LITERAL` for:

- a cast that throws, such as `ratio Float @default(<a 400-digit whole number>)`, where the fixture's `asNumber` cast throws `CONTRACT.CAST_REFUSED`;
- a list cast that throws, such as `embed pgvector.Vector(3) @default([1, 2, <a 400-digit whole number>])`, which fails in `readListIntoScalar` (data-type-default.ts lines 330-386).

The error reference names the first case as an example of `PSL_INVALID_LITERAL`. The removed `json` flag was exactly a split of `unreadable` by origin; if a split like that came back, these paths could get another code and every test would stay green. The table also asserts `expect.stringContaining` with fragments, so a change at the start or end of a message goes unnoticed.

Suggestion: Add the two rows with `PSL_INVALID_LITERAL` and their messages. Assert `{ code, message }` with the whole message.

### F06: The test "never as a sql literal" passes without the rule it names

Location: packages/2-sql/9-family/test/psl-build/default-mapping.test.ts lines 227-231; packages/2-sql/9-family/src/core/psl-build/default-mapping.ts lines 96-97 and 121-139.

Issue: The test prints `'now()'` on a text column and expects `"now()"`. It passes with or without the skip of `SQL_EXPRESSION_DATA_TYPE_ID` in `writingSurface` (line 97). `classifications` puts the plain-string candidate before every tag candidate (lines 132-137), and the text column takes it, so the `sql/expression` candidate is never tried. The test gives confidence in a rule it does not check (`.agents/rules/non-vacuous-verification.mdc`).

Suggestion: Test the case the skip exists for: a column whose data type is `sql/expression`. With the skip, `mapDefault` finds no written form and returns `undefined` (checked during this review, `wip/review-2a/writing-surface-skip.log`). Without the skip, it prints `` @default(sql`now()`) ``, which reads back as a function default instead of the stored literal.

```ts
it('never writes a stored literal as a sql literal', () => {
  expect(
    mapDefault({ kind: 'literal', value: 'now()' }, forColumn(sqlExpressionDataType)),
  ).toBeUndefined();
});
```

### F07: No test reads the double-quote form back

Location: packages/1-framework/1-core/framework-components/test/tagged-literal.test.ts lines 125-171; packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts lines 143-161.

Issue: The read-back tests cover only the backtick form: they strip the fence and call `resolvePslBacktickEscapes` and `canonicalizeTaggedLiteralBody`. `contract infer` now prints the double-quote form for every text that holds a backtick, for example a `json` default. That form is checked only by string equality. It reads back only while the private `escapeQuotedText` stays the inverse of the parser's `decodeStringLiteral` (packages/1-framework/2-authoring/psl-parser/src/syntax/ast/expressions.ts lines 90-167), which is in another package. It reads back today (my script above), but no test fails if either side changes.

Suggestion: Add a `jsonb` column whose default holds a backtick, for example `'{"a": "`"}'::jsonb`, to the table in packages/3-targets/3-targets/postgres/test/psl-infer/inferred-psl.round-trip.test.ts. That test already prints with the real printer and parses with the real parser.

### F08: The error reference lists a refusal that PSL cannot produce

Location: docs/reference/error-reference.md line 802.

Issue: The new `PSL_INVALID_LITERAL` entry lists "a list holding another list". PSL cannot write one. A `@default` list element is a string, a number, a boolean or a tagged literal (packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts lines 270 and 290-291), so `@default([[1]])` is refused by the argument grammar before any value is read. The refusal `a list holds values, not other lists` (data-type-default.ts lines 314 and 357) is reachable only from other callers of `readDataTypeDefault`, and the Prisma 7 reader reports its refusals as `PSL.PRISMA7_UNKNOWN_DEFAULT` (packages/2-sql/2-authoring/contract-prisma7/src/defaults.ts line 173). A reader looks for a case that does not exist.

Suggestion: Remove "a list holding another list" from the entry.

### F09: One line reference in the corrected design is still wrong

Location: projects/sql-expression-literals/design.md line 391.

Issue: Commit `ce2f5760c1` corrected this slice's file and line references, but section 11.1 still points at `psl-printer/src/serialize-print-document.ts:160-170` for `wrapNamespaceBlock`. The function is at lines 155-165. Slice 2b depends on this printer behaviour (section 11.2).

Suggestion: Change the reference to `:155-165`.

## Deferred

- The `@default` list arm still offers `` sql`...` `` as a list element (packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts lines 290-291). The "Expected one of" message and completion inside `[` advertise a form that the cast rule always refuses. Out of scope: design section 10 chose to refuse it through the cast rule, so changing the grammar is a design decision. It fits slice 2t or 2b, which build typed arguments.
- The ADR 254 row of design section 19 also asks for "Only the scalar cast rule moves to the framework; list casts stay in the family's default reader". This slice does not add it. It describes the move that slice 2t makes, so it belongs in slice 2t's ADR edit. Add it to slice 2t's plan so it is not lost.
- The `unknown-tag` arm of `lowerDataTypeDefault` (data-type-default.ts lines 419-424) cannot be reached from PSL, because `lowerTaggedLiteral` refuses an unknown tag first. Slice 2t replaces this code with the framework's `readWrittenValue`.

## Acceptance-criteria verification

Paths in this table are shortened: `contract-psl/` is packages/2-sql/2-authoring/contract-psl, `9-family/` is packages/2-sql/9-family, and target and adapter paths start at packages/3-targets.

| ID | Criterion (source) | Verdict | Detail |
| --- | --- | --- | --- |
| A1 | `sql/expression` is a data type the SQL family defines and both targets register (plan outcome; spec requirement 1) | PASS | packages/2-sql/1-core/contract/src/sql-expression.ts lines 11-23 define the id, tag, type and entry. Postgres `data-types.ts` line 149 and `data-type-entries.ts` line 84, and SQLite `data-types.ts` line 82 and `data-type-entries.ts` line 64, register the same objects. Target tests assert the id is in the sorted list. Adapter tests (Postgres `control-mutation-defaults.test.ts` line 333, SQLite line 12) assert the last key is `sql/expression` and the tags are exactly `json, sql`; they fail if a prefixed tag or lowering key returns. |
| A2 | The lowering-entry kind, `pg.sql` and `sqlite.sql` are gone (plan outcome) | PASS | `DataTypeLoweringAuthoringEntry`, `AuthoringDataTypeEntry`, `loweringEntryKey`, `isLoweringEntryKey`, `isDataTypeLoweringEntry`, `TaggedLiteralValue` and `sqlDefaultLiteralTagEntry` are deleted; typecheck passes, so no caller is left. `data-type-assembly.test.ts` line 86 fails if the `lowering:` skip returns. `pg.sql` and `sqlite.sql` are asserted unknown in `contract-psl/test/interpreter.defaults.tagged-literal.test.ts` line 137 and `interpreter.defaults.data-types.test.ts` line 248. |
| A3 | `@default` stores a `sql/expression` value as a default expression and keeps its own checks (plan outcome; spec requirement 3) | PASS | `psl-column-resolution.ts` lines 669-684 and 715-726. Tests: function default on scalar and list columns (tagged-literal test lines 77-123), reserved text on scalar and list columns (190-201), unsafe text with exact message and span (178-188), `NOW()`, `gen_random_uuid()` and `uuid()` kept verbatim (203-209). |
| A4 | `@default` refusals that come from the cast rule use the general codes (plan outcome; spec requirement 2 for `@default`) | PASS | `data-type-default.ts` lines 412-448 match the design 10.1 table row by row. Tests cover `no-cast`, `unwritable`, `not-a-list`, `undecodable`, and `unreadable` from a parse. The missing `unreadable` rows are recorded under P6 and F05. |
| A5 | `contract infer` prints raw defaults through the one tagged-literal printer (plan outcome; spec requirement 6 for defaults) | PASS | `9-family/src/core/psl-build/default-mapping.ts` line 66 uses `printSqlExpressionLiteral` and line 184 uses `printTaggedLiteral`; a grep finds no other raw-SQL printer in `src/`. `contract print` reaches the same code through `postgres/src/core/psl-print/column-defaults.ts` line 59. The printed forms read back through the real parser (my script). |
| A6 | No `contract.json` changes (plan outcome; spec "Contract impact") | PASS | `fixtures:check` passes and the tree is clean afterwards; no `contract.json` is in the diff. |
| T1 | `` @default(sql`gen_random_uuid()`) `` still stores the same default (TML-3296) | PASS | The parity fixture `expected.contract.json` line 145 holds `gen_random_uuid()` as a function default and is unchanged; `cli.emit-parity-fixtures.test.ts` passes (run during this review). Manual QA case 1 shows the stored default from the real Postgres stack. |
| T2 | `` pg.sql`...` `` is an unknown tag listing `json, sql` (TML-3296) | PASS | Tagged-literal test lines 137-146 assert the exact code, message `Unknown literal tag "pg.sql". Known tags: json, sql.` and span. Manual QA case 2 shows the same message from the real Postgres stack. |
| T3 | The framework has no lowering-entry kind (TML-3296) | PASS | `framework-authoring.ts` has no lowering types or helpers; `AuthoringContributions.dataTypes` is `Readonly<Record<string, DataTypeAuthoringEntry>>`; `control-stack.ts` has no lowering skip. |
| T4 | `fixtures:check` shows no contract change (TML-3296) | PASS | `wip/v/fixtures-check.log` passes; `git status` is clean. |
| S1 | One type owned by the family; no prefixed tag exists (spec requirement 1) | PASS | See A1 and A2. |
| S2 | `@default` keeps its SQL checks in PSL and in TypeScript (spec requirement 3) | PASS | PSL: see A3. TypeScript: `contract-ts/src/sql-default-literal.ts` is unchanged and still runs `reservedSqlDefaultBody` and `checkSqlDefaultBody`. |
| S3 | The same SQL default emits the same contract from PSL and TypeScript (spec requirement 4, for defaults) | PASS | The `default-sql-literal` parity fixture now writes `sql` instead of `pg.sql` and still matches the TypeScript contract and the unchanged expected contract. |
| S4 | Names and stored text do not change (spec requirement 5, for this slice) | PASS | No stored text changes: canonicalization and the stored `expression` are unchanged (A6). |
| S5 | `contract infer` prints raw defaults as `sql` literals (spec requirement 6) | PASS | See A5. |
| S6 | Breaking changes are documented for both audiences (spec requirement 9) | WEAK | Both fragments exist and `check:upgrade-coverage` passes. The detection pattern misses real cases (F01), and the text misstates one changed diagnostic and omits one type change (F02). |
| S7 | `` pg.sql`...` `` and `` sqlite.sql`...` `` are refused as unknown tags (project DoD) | PASS | See A2 and T2. On the real SQLite stack, the adapter test shows only `json` and `sql` are registered. |
| P1 | `sql-expression.test.ts`: id, no casts, no list cast, tag, parse/print round trip, `sqlTextFromCanonical` throws, `sqlTextReadsBack` (plan tests) | PASS | packages/2-sql/1-core/contract/test/sql-expression.test.ts covers every item with exact values. Each assertion fails if its behaviour changes. |
| P2 | `data-type-assembly.test.ts`: lowering keys gone; an entry keyed by an unregistered id fails (plan tests) | PASS | Line 86 expects assembly to throw for `lowering:sql` and names the contributor. |
| P3 | Target `data-types.test.ts`: no type names `sql/expression` in `casts` or `listCast.of` (plan tests) | PASS | Postgres line 104, SQLite line 43. The filter returns any offending type, so a new cast fails the test. |
| P4 | Target `data-types.test.ts` and adapter `control-mutation-defaults.test.ts` per design 18.3 (plan tests) | PASS | Sorted id lists include `sql/expression`; the adapter tests assert keys equal the target's and the last key and tags. |
| P5 | `interpreter.defaults.tagged-literal.test.ts` updates (plan tests) | PASS | Function defaults on scalar and list columns; `pg.sql` exact message; reserved and unsafe texts; a `sql` element in a list with `PSL_VALUE_TYPE_INCOMPATIBLE` and the exact design message (lines 255-264). |
| P6 | `interpreter.defaults.data-types.test.ts`: table split by the design 10.1 codes, asserting each code and message (plan tests) | WEAK | Codes are asserted per row. There are no rows for `unreadable` from a throwing cast or a throwing list cast, and messages are matched by fragment (F05). |
| P7 | `tagged-literal.test.ts`: single-line, multi-line and double-quote forms, backslashes, read-back including indented lines (plan tests) | PASS | Lines 125-171. The double-quote form is not read back (F07), which the plan did not require. |
| P8 | `default-mapping.test.ts`: function defaults through `printSqlExpressionLiteral`, `json` text with a backtick, multi-line function default (plan tests) | PASS | Lines 169-231. One added test does not prove what it names (F06). |
| P9 | `completion-provider.test.ts`: `@default(` offers `json` and `sql` on Postgres and SQLite (plan tests) | PASS | Lines 1349-1415 load the real target entries and assert the exact item list for both targets, with and without snippets. |
| P10 | Existing assertions of changed codes are updated (plan tests) | PASS | `psl-pg-enum-column.test.ts` line 271, `psl-number-defaults.integration.test.ts` lines 224 and 238, tagged-literal test lines 241, 248 and 280. |
| P11 | `sql-attribute-specs.test.ts`: the tag arm has `tags: ['sql']` and the entry's documentation (plan tests) | PASS | Lines 321-326. |
| D1 | `build`, `typecheck`, `lint`, `lint:deps`, `lint:casts`, `lint:throws`, `check:error-reference` pass (done conditions) | PASS | Exit code 0 in `wip/v/summary.txt` and the logs. |
| D2 | `test:packages` and `test:integration` pass (done conditions) | NOT VERIFIED | Locally, 6 package test files and 3 integration test files failed. The render round-trip, two CLI tests and relation-mode test pass on rerun (`wip/v/rerun-*.log`). The publish-shell and packaging tarball tests could not run, because `pnpm install` on this machine refuses `@vercel/detect-agent@1.2.5`. Those tests pack the shells whose `package.json` this slice changed, so CI must show them green before merge. |
| D3 | `fixtures:check` passes with no `contract.json` change (done conditions) | PASS | See T4. |
| D4 | `lint:framework-vocabulary` count equals the threshold (done conditions) | PASS | 272 of 272. The slice removed no counted site, so the threshold stays. |
| D5 | `check:upgrade-coverage` passes and fragments are validated by execution (done conditions) | WEAK | The check passes. The slice changed nothing in `examples/` or `packages/3-extensions/`, so validation by execution has nothing to reproduce. The detection patterns were not tested against the nearest false positive or the TypeScript case (F01). |
| D6 | A manual QA script and a recorded run for the changed diagnostics (done conditions) | PASS | projects/sql-expression-literals/manual-qa.md: nine cases on the real Postgres stack, with expected results and a recorded run whose output matches. |
| D7 | A grep over docs, skills, READMEs and `src/` comments finds no `pg.sql` or `sqlite.sql` (done conditions) | PASS | `wip/v/grep-prefixed-tags.log` finds only sentences that say these tags are unknown. |
| X1 | Design sections 3.2, 3.3 and 18.2: file deletions, moved `checkSqlDefaultBody` tests, fixture and doc-example edits | PASS | All files named are deleted or edited as specified; `default-sql-body.test.ts` holds the moved cases. The deletion lost unrelated tests (F04). |
| X2 | Design section 19 doc rows for slice 2a | WEAK | ADRs 129 and 254, the ADR index, the subsystem doc, the error reference, the editor tooling doc, the codec guide and the contract-psl README are updated. The error reference lists an unreachable case (F08). One ADR 254 sentence is left for slice 2t (Deferred). |

| Verdict | Count |
| --- | --- |
| PASS | 32 |
| WEAK | 4 |
| FAIL | 0 |
| NOT VERIFIED | 1 |
