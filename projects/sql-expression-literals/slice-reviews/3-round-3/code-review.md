# Slice 3 code review, round 3 (TML-3289)

Range: `git diff origin/main...HEAD` on `l65-3` (pushed as `tml-3289-sql-expression-ts`, PR #30558), merge base `7ae50f13f9`, tip `090dc1c1a2`. Reviewer lens: principal engineer. Focus: the merges `b3f0ca7a04` and `ba45958509`, the ADR rename `fc10468cd3` and the follow-main commit `bd80bf468a`. Logs and scratch output are in `wip/3-round-3-review/`. Every scratch test and fixture I wrote was deleted; `git status` shows only this review folder.

## Summary

The merges are resolved correctly. The `sql` tag, lowering, `fullTextIndex` (now with several weight groups), the policy lowering and the `contract print` refusal all behave as design sections 2 and 15 and the error reference say. PSL and TypeScript emit identical contracts for hostile layouts the fixture does not cover (`--` comments inside interpolated values, backticks, backslashes, tab indentation). The regenerated `expected.contract.json` changed only in what `main` changed.

The most important finding is C02: the recorded manual QA run for slice 3 is out of date. Its expected text and its recorded output say `Index "where"`, while the code now says `Index "u_a" where`, and it has no case for the full-text message the merge decided. The other findings are small: lowering trusts the text of any object that carries the marker (C01), two documents still describe the single-column `fullTextIndex` (C03), and the parity fixture does not lock the comment and backtick cases (C04).

## What looks solid

- Round 2's G01 is fixed the right way: the indentation comes from the template pieces only. `sql` with two multi-line values on one indented line stores `(x\n  OR y) AND (p\nq)\nAND z`, as design section 2 says.
- Every untyped caller gets a coded, named refusal. A string, number, boolean, `null` or `{ text: 'x' }` in index `where`, index `expression` or check `expression` throws `CONTRACT.ARGUMENT_INVALID` with the object's name; inside `${…}` each throws `CONTRACT.SQL_EXPRESSION_INTERPOLATION` with its index.
- The merge resolution in `full-text-index.ts` is sound. `fullTextIndexOwner` lists every field in order when there is no `name` or `map`, the error reference documents it, and a test covers three fields in two weight groups.
- The `contract print` refusal now has one owner type (`SqlTextOwner`) for index, check, policy and default. The meta shapes match the error reference.
- `.default()` keeps a string as a literal default, so `.default('draft')` is unaffected. `sql` values go through the reserved and unsafe checks first.
- Each fix I removed made at least one test fail (see "Removing each fix"), except one guard that only extension code can reach.

## Findings

### C01. Lowering and `.default()` trust the text of any object that carries the marker

- Location: `packages/2-sql/1-core/contract/src/sql-expression.ts`, lines 129–135 (`isSqlExpression`) and 173–178 (`requireSqlExpression`); used by `packages/2-sql/2-authoring/contract-ts/src/contract-lowering.ts` lines 854, 966–969, 991–994, `contract-dsl.ts` line 215, and `packages/3-targets/3-targets/postgres/src/core/authoring.ts` line 973.
- Issue: The `Symbol.for` marker exists so a `SqlExpression` from a second installed copy of the package is accepted. That copy may be a different version, whose constructor canonicalized differently or not at all. Lowering then stores `.text` exactly as it finds it, so the rule "a TypeScript `sql/expression` value is always canonical" (spec requirement 4, ADR 268) depends on the other copy. A marked object whose `text` is not a string fails deep inside lowering with a `TypeError` and no code. Probe (a scratch test in `contract-ts/test`, output in `wip/3-round-3-review/probe-contract-ts.out`):

  ```text
  index.where forgedIndented => OK "where":"\n    a = 1\n      AND b\n  "
  default forgedNul => OK "default":{"kind":"function","expression":"a\u0000b"}
  check.expression forgedNonString => THROW TypeError  "authored.expression.trim is not a function"
  ```

  Here `forgedIndented` is `{ [Symbol.for('@prisma/sql-expression')]: true, text: '\n    a = 1\n      AND b\n  ' }`. A real value from a second copy of the same version is canonical, so the risk is limited to version skew and hand-made objects. The fix is cheap.
- Suggestion: `isSqlExpression` also requires `typeof text === 'string'`. `requireSqlExpression` returns the value when it is an instance of this copy's class, and otherwise `new SqlExpression(value.text)`. Canonicalizing is idempotent, so a canonical text is unchanged and anything else is cleaned up or refused with `CONTRACT.SQL_EXPRESSION_INVALID`. `.default()` reads through the same function. Add a unit test with a marked plain object holding indented text and one holding a number.

### C02. The slice 3 manual QA script and its recorded run are out of date

- Location: `projects/sql-expression-literals/manual-qa.md`, lines 755–880 (slice 3 script, "Expected" and "Run, 2026-10-01").
- Issue: The plan's done conditions require a script that reads each new message as a user would, and a recorded run. The "Expected" line says ``Index "where" must be a sql`...` value.``, and the recorded run shows `Index "where"`, `Check "expression"` and `Policy "using"`. That was the wording before round 1's A04 fix. The `tsc` output quotes an overload `(column: ColumnRef, …)` that the merge removed, since `fullTextIndex` now takes weight groups. The script has no run-time case for `fullTextIndex`, so the merge's decision (`Full-text index on "title", "subtitle" where`) has never been read as a user sees it. I reran the run-time part on the tip (`wip/3-round-3-review/manual-qa-runtime.log`):

  ```text
  a string in index where: CONTRACT.ARGUMENT_INVALID Index "u_a" where must be a sql`...` value. {"what":"Index \"u_a\" where"}
  a string in a policy using: CONTRACT.ARGUMENT_INVALID Policy "u_read" using must be a sql`...` value. {"what":"Policy \"u_read\" using"}
  ```

  The other run-time cases match the recorded run. I could not rerun the `tsc` step: a repository hook blocks calling `tsc` directly.
- Suggestion: Correct "Expected" to name the object (`Index "u_a" where`, `Index on "U" where` for an unnamed one). Add two run-time cases: an untyped `fullTextIndex` with a string `where` and a `name`, and one over two fields with neither `name` nor `map`. Rerun both steps on the tip and replace the recorded run. `status.md` already lists manual QA as a step after this review, so this may be planned; the wrong "Expected" text must be fixed either way.

### C03. Two documents still describe the single-column `fullTextIndex`

- Location: `projects/sql-expression-literals/design.md`, line 616 (section 15.3); `upgrade-instructions/pending/sql-expression-literals-ts/extension/instructions.md`, line 98.
- Issue: Design 15.3 says an unnamed full-text index is named `Full-text index on "<field>" where`, "`<field>` being the indexed column's field name". Since the merge, the helper takes weight groups and the code and error reference list every field: `Full-text index on "title", "subtitle", "text" where`. The extension fragment says "the built-in `fullTextIndex` renders one canonical line and is not affected". Since the merge, `fullTextIndex` has no `render`: it emits an index of type `fullText` whose body comes from its options. The conclusion (not affected) still holds, but the reason given is no longer true, and an extension author reading it would look for a `render` that does not exist.
- Suggestion: Design 15.3: "with neither, it is `Full-text index on "<field>", "<field>" where`, listing the fields of its weight groups in order". Fragment: "the built-in `fullTextIndex` has no `render`; its index body comes from its options, so it is not affected."

### C04. The parity fixture does not lock comments, backticks or tabs inside interpolated values

- Location: `test/integration/test/authoring/parity/sql-expressions/contract.ts` and `schema.prisma`.
- Issue: The plan's fixture list is met (multi-line, quoted identifiers, a backslash, interpolation). But the interpolation rule is where TypeScript and PSL can drift, and three layouts interact with it and have no test: a `--` comment on a line of an interpolated multi-line value, an escaped backtick, and tab indentation. I built a scratch parity case with all three plus a policy predicate ending in a `--` comment, and an empty `where` and default. TypeScript and PSL emitted equal contracts (`wip/3-round-3-review/parity-probe.log`, `parity-empty.log`; the cases failed only on the placeholder `expected.contract.json`). So the behaviour is correct today, and nothing keeps it so.
- Suggestion: Extend the fixture: interpolate a multi-line value whose first line ends in `-- comment` into an indented index `where`, add `'x\`y'` to a check, and indent one check body with tabs in both files. Regenerate `expected.contract.json` with `UPDATE_AUTHORING_PARITY_EXPECTED=1` and confirm the diff touches only the new texts.

## Removing each fix

Each fix was removed in place, the package's tests were run, and the file was restored with `git checkout`. Script: `wip/3-round-3-review/mutate.py`; logs `wip/3-round-3-review/M*.log`.

| Fix removed | Tests that fail |
| --- | --- |
| Interpolated lines take the template line's indentation (G01) | 2 tests in `sql-expression.test.ts` |
| Interpolated lines are indented at all | 5 tests in `sql-expression.test.ts` |
| The constructor canonicalizes | 8 tests in `sql-expression.test.ts` |
| Rendered index text is canonicalized (A07) | 2 tests in `contract-ts` |
| Index `where` is checked in lowering | 3 tests in `contract-ts` |
| `.default()` refuses `sql\`now()\`` | 3 tests in `contract-ts` |
| `fullTextIndex` checks its `where` | 3 tests in `@internal/postgres` |
| Policy predicates are checked in lowering | 4 tests in `@internal/postgres` `rls-entities.test.ts`, after mutating the built `target-postgres` dist (the extension tests read the dist, so a source-only mutation showed nothing) |
| `contract print` refuses a default that does not read back | 1 test in `target-postgres` |
| `contract infer` notes such a default | 1 test in `target-postgres` |
| `coveredFieldNames` skips a non-object expression (`contract-lowering.ts` line 895) | none |

The last guard has no test. It is reached only when an index has an `options` function, no `fields` and a string `expression`, which only extension code that is not type-checked can produce. Without it the build fails with a `TypeError` instead of `CONTRACT.ARGUMENT_INVALID`. Not worth a finding; noted so nobody assumes it is covered. C01's behaviour (a marked object stored as it is) also has no test.

## Other checks run

- `check:error-reference`, `lint:throws`, `lint:casts`, `lint:deps`, `lint:framework-vocabulary`, `fixtures:check` (tree clean afterwards) and `check:upgrade-coverage --mode pr` pass.
- `typecheck` passes in `@internal/sql-contract`, `@internal/sql-contract-ts`, `@internal/postgres` and `@internal/target-postgres`. This covers the `.test-d.ts` files, which are in each `tsconfig.json`.
- Package tests: `contract-ts` 585 pass, `@internal/postgres` `test/contract-builder` 124 pass, `target-postgres` 3891 pass, `contract-psl` 714 pass, `sql-expression.test.ts` 59 pass.
- Integration files the slice touches, alone: `ts-psl-rls-parity`, `family.schema-verify.index-drift`, `typescript-contract-roundtrip`, `rls-helper-invisibility`, `rls-ts-walking-skeleton`, `cli.emit-parity-fixtures`, `sql-expression-registration`: 14 files, 130 tests pass. `check-lifecycle-e2e.integration.test.ts` in the Postgres adapter: 22 pass.
- Not run by me: `pnpm build` and `pnpm lint` at the root, and `test:packages`.

## Deferred (out of scope)

- **An empty `sql` text is accepted for index `where` and for `.default()`, in both languages.** `where: sql\`\`` and `.default(sql\`   \`)` emit `"where": ""` and a function default `""` from TypeScript and from PSL alike, so parity holds. The DDL will be invalid. This is PSL behaviour since slice 2a; requirement 3 puts such checks with the consumer. It belongs in the project's deferred list, not in this slice.
- **Two installed versions of the package give incompatible `SqlExpression` types.** Each `.d.mts` declares its own `unique symbol`, so a value from one copy does not type-check where the other copy's type is expected; at run time it is accepted. The public packages hold one copy (`@prisma/orm-family-sql`), so this needs version skew. Out of scope.
- **A `render` that returns a non-string fails with a `TypeError`.** `render` is typed to return a string and is written by extension authors. Same reasoning as round 2's deferred item on renderer messages.

## Already addressed

| Item | Fixing commit | Verified |
| --- | --- | --- |
| G01 indentation from the template line | `b1b2c9ab74` | Probe and 2 failing tests on removal |
| G02 unnamed `fullTextIndex` names its fields | `e4d3fcc85f`, extended to several fields in `b3f0ca7a04` | Tests for one and three fields; C03 for the design text |
| G03 single detection glob | `7c9950b8b1` | Both fragments use `**/*.{ts,mts,cts}`; `check:upgrade-coverage` passes |
| G04 rendered text is canonicalized, in README and fragment | `7c9950b8b1` | README line 263, fragment line 108 |
| B03 rendered NUL or oversize text names the index | `a0aabd1605` | Probe: `Index "i" expression: Tagged literals must not contain NUL characters.` |
| B05 registration frozen | `b1b2c9ab74` | `sql-expression.test.ts` |
| Round 1 A01–A09, F01–F07 | see `3-round-2/code-review.md` | Unchanged by the merges; their tests pass |

## Acceptance-criteria verification

| AC | Verdict | Detail |
| --- | --- | --- |
| AC1: `sql` returns a `SqlExpression` whose constructor canonicalizes; other `sql` values may be interpolated | **PASS** | `sql-expression.ts` lines 110–171. `sql-expression.test.ts` asserts exact texts for escapes, empty text, joined interpolation, constructor canonicalization and NUL refusal; removing indentation or canonicalization fails 5 and 8 tests. `sql-expression.test-d.ts` asserts `not.toBeAny()` and `toEqualTypeOf<SqlExpression>()`. |
| AC2: a string, number or boolean in any raw-SQL builder field does not compile | **PASS** | `raw-sql-fields.test-d.ts` (index `where`, `expression`, check, `IndexConstraint.where`), `rls-handles.test-d.ts` (each policy helper), `full-text-index.test-d.ts`. Each call is otherwise valid, so the `@ts-expect-error` can only be the predicate. Typecheck passes. |
| AC3: an untyped caller is refused at run time with a named, coded error | **PASS** | `contract-lowering.sql-expression.test.ts`, `full-text-index.test.ts`, `rls-entities.test.ts` assert code, message and meta. Removing each check fails 3, 3 and 4 tests. My probe confirms number, boolean, `null` and `{ text }`. C01 covers marked objects. |
| AC4: `.default()` takes a `sql` value and runs the default checks | **PASS** | `contract-dsl.default-sql-expression.test.ts` asserts the exact `CONTRACT.DEFAULT_INVALID` messages and meta for `now()`, `autoincrement()` and unsafe SQL, and that `now()` still works. Removing the reserved check fails 3 tests. |
| AC5: PSL and TypeScript emit byte-identical contracts, multi-line included | **PASS** | `cli.emit-parity-fixtures.test.ts` compares the two emitted contracts and hashes before the expected file; the `sql-expressions` case passes. My scratch case with comments, backticks, tabs and empty texts also gave equal contracts. C04 asks to keep those cases. |
| AC6: the parity fixture covers a partial index, expression index, full-text `where`, check, policy `using` and `withCheck`, a raw default, multi-line, quoted identifiers, a backslash and interpolation | **PASS** | All present in `sql-expressions/contract.ts` and `schema.prisma`. The regenerated `expected.contract.json` differs from the pre-merge one only by `main`'s changes (`dataType`, `fullText` index type, new capabilities); its SQL texts are unchanged. |
| AC7: carried over: `sqlExpressionRegistration` is one frozen value used by the family and the four fixtures | **PASS** | `control-descriptor.ts` and the four fixtures spread it. `sql-expression.test.ts` checks the deep freeze; the integration `sql-expression-registration.test.ts` passes. |
| AC8: carried over: `contract print` refuses a default that would not read back; `contract infer` prints it with a note | **PASS** | `refusals-sql-text.test.ts` asserts the full error; `infer-sql-expression-literals.test.ts` asserts the printed line and the note, and no note for a default that reads back. Removing either fails one test. |
| AC9: refusal messages and codes match the design and error reference | **PASS** | Probes match every documented message and meta: `ARGUMENT_INVALID` per field, `SQL_EXPRESSION_INTERPOLATION` with `index`, `SQL_EXPRESSION_INVALID` with `reason` and `offset`, the prefixed render form, and `PRINT_UNSUPPORTED` with `coordinate`. `check:error-reference` passes. |
| AC10: done conditions: lint, typecheck, fixtures, upgrade coverage, touched integration files | **PASS** | All the checks listed under "Other checks run" pass. Root `build`, `lint` and `test:packages` were not run by me. |
| AC11: a manual QA script reads each new message, with a recorded run | **FAIL** | The script exists, but its "Expected" text and the recorded run show messages the code no longer produces, and it has no `fullTextIndex` case. See C02. |
| AC12: no string arguments to the TypeScript raw-SQL fields remain in docs, skills or READMEs | **PASS** | `git grep` over Markdown finds only the before-and-after tables of the pending upgrade fragments and released upgrade sources, which are excluded or intended. |

### Summary

| Result | Count | ACs |
| --- | --- | --- |
| PASS | 11 | AC1–AC10, AC12 |
| FAIL | 1 | AC11 |
| NOT VERIFIED | 0 | |
| WEAK | 0 | |

## Fixes check, 2026-10-08

Checked: code `cab6bcce23`, docs `79e9498810`, and the uncommitted slice 3 "Script" and "Expected" in `manual-qa.md`. Logs in `wip/3-round-3-review/fixes-*.log`, probe output in `fixes-probe.out`. The scratch probe test was deleted.

Tests on the tip: `sql-expression.test.ts` 63 pass, `contract-ts` 584 pass, `@internal/postgres` `test/contract-builder` 124 pass, `cli.emit-parity-fixtures.test.ts` 64 pass (both projects).

| Finding | Verdict | Evidence |
| --- | --- | --- |
| C01 marked values trusted | **Partly fixed** | Through lowering and `.default()` a marked foreign value is now rebuilt with this copy's constructor. Indented text is stored as `a = 1\n  AND b` in index `where`, index `expression`, check and default. A NUL or text over 65536 bytes throws `CONTRACT.SQL_EXPRESSION_INVALID`. A number as `text` is `CONTRACT.ARGUMENT_INVALID` (`Index "i" where must be a sql\`...\` value.`). In `.default()` it becomes the literal `{ text: 42 }`, as any non-`sql` object does. New tests cover the indented text, the NUL and the number. The `sql` tag still reads interpolated values raw: see C05. |
| C02 manual QA (script only) | **Fixed** | The revised "Expected" names the object (`Index "u_a" where`, `Index "u_e" expression`, `Check "u_c" expression`, `Policy "u_read" using`). It adds the unnamed two-field full-text case (`Full-text index on fields "title", "email" where`) and marked objects with indented text (stored `email IS NULL`) and with a number (`ARGUMENT_INVALID`). It runs typecheck through the example's `typecheck` script. Each expected line matches what my probes got from the code. I did not check the recorded run, as asked. |
| C03 single-column `fullTextIndex` docs | **Fixed** | Design section 15.3 says `Full-text index on fields "<field>", "<field>" where`, listing every weight group's fields. The error reference says the same. The extension fragment says `fullTextIndex` "stores its fields and language as data, renders no SQL, and is not affected". The new word "fields" is in the code, the tests and the error reference. |
| C04 parity fixture | **Fixed, with one gap** | The fixture adds an interpolated value whose first line ends in `-- live rows only` inside an indented `where`, a tab-indented check, a two-group full-text index with a multi-line `where`, and an escaped backtick in TypeScript. The regenerated `expected.contract.json` changes only those entries and the storage hash. The gap: the PSL side writes the backtick check as `sql"\"email\" <> 'x`y'"`, the double-quoted form, so the PSL `` \` `` escape in a backtick literal is still not in the fixture. My earlier scratch case showed that it gives the same text. |

### C05. The `sql` tag still interpolates a foreign value's text without canonicalizing it

- Location: `packages/2-sql/1-core/contract/src/sql-expression.ts`, lines 150–166 (`sql`).
- Issue: The tag checks each value with `isSqlExpression` and inserts `value.text` as it is. A value from another copy with text that is not canonical gets prefixed with the template line's indentation before canonicalization. So the stored text differs from what the same value made here gives. Probe, with `foreign = { [Symbol.for('@prisma/sql-expression')]: true, text: '\n    a = 1\n      AND b\n  ' }` and `local = new SqlExpression(` that same text `)`:

  ```text
  sql`\n      x AND (${foreign})\n    `.text => "x AND (\n    a = 1\n      AND b\n  )"
  sql`\n      x AND (${local})\n    `.text   => "x AND (a = 1\n  AND b)"
  ```

  C01's goal (a foreign value's text is canonicalized here) holds for lowering and `.default()`, but not for interpolation. Interpolation is the common way TypeScript contracts reuse predicates.
- Suggestion: In `sql`, read each value with `readSqlExpression` and refuse `undefined` with `CONTRACT.SQL_EXPRESSION_INTERPOLATION`. Add a unit test with the probe above.

### C06. The error reference does not list the new raise site for a foreign value's text

- Location: `docs/reference/error-reference.md`, `CONTRACT.SQL_EXPRESSION_INVALID` and `CONTRACT.ARGUMENT_INVALID`.
- Issue: `CONTRACT.SQL_EXPRESSION_INVALID` is now also raised when a raw-SQL field or `.default()` gets a `sql` value from another installed copy whose text has a NUL character or is too large. The entry names only the constructor, the tag and rendered index text. Unlike the rendered case, this message does not name the field: index `where` with such a value gives only `Tagged literals must not contain NUL characters.`. `CONTRACT.ARGUMENT_INVALID` also does not say that a marked object whose `text` is not a string is refused.
- Suggestion: Add one sentence to each entry. Optionally, prefix the message with the `what` string, as `renderedSqlText` does, by catching the refusal in `requireSqlExpression`.
