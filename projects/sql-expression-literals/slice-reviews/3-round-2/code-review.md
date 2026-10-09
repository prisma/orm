# Slice 3 code review, round 2 (TML-3289)

Range: `0efa27e370..f23bee0e68` on `tml-3289-sql-expression-ts`. Reviewer lens: principal engineer. Code read at HEAD. Decisions checked against `dispatches/3-review-fixes-brief.md`.

## Summary

The fixes follow the brief. Every round 1 finding (A01 to A09, F01 to F07) and every deferred item the brief named is addressed, and each new test was red before its fix (`wip/3-fixes/red-*.log`, `parity-red-old-join.log`).

The most important finding is G01. The new indentation rule in the `sql` tag reads the indentation from the last line of the text joined so far, not from the template line. When two placeholders sit on one line and the first value has several lines, the second value's later lines take the first value's last-line indentation. The stored text then differs from what design section 2, ADR 129, ADR 260, the README and both fragments describe. It is a narrow layout, but it is exactly the parity property A01 set out to fix.

The other findings are small: a `Full-text index "undefined" where` message for an untyped caller with neither `name` nor `map` (G02), a glob list with a `!` negation that no skill or script defines (G03), and the README and extension fragment still saying the rendered index string reaches the IR as it is (G04).

My runs, logs in `wip/review3-round2/`: `packages/2-sql/1-core/contract/test/sql-expression.test.ts`, 56 tests pass. `probe.mjs` exercises the built `sql` tag on the layouts listed in the brief. Other results are read from the implementer's logs in `wip/3-fixes/`.

## What looks solid

- The single-line case is unchanged: a value with no `\n` is inserted as it is, so every earlier test and the old parity policy pass unchanged.
- CRLF in a value cannot occur. A `SqlExpression`'s text is canonical, and the canonicalizer joins lines with `\n` only, so `replaceAll('\n', …)` reaches every line break. Template text cannot hold a CR either: JavaScript turns CR and CRLF into LF in both cooked and raw template strings.
- A value that itself came from an interpolation is canonical, so nesting works. Probe: a value interpolated into an indented template, which is then interpolated into another, stores `(\n  p\n  q\n)\nAND z`.
- Tabs: the prefix is copied character for character from the template line, and the canonicalizer counts indentation in characters, as it does for PSL. Probe with a tab-indented template stores `p\nq\nAND z`.
- An empty value, a value at the start of a line, a value in the middle of a line, and a template with no line break all store what design section 2 says. The mid-line test pins the rule to the line's leading whitespace, not the placeholder's column.
- The prefix holds only spaces and tabs, so the `$` patterns of `String.prototype.replaceAll` cannot trigger.
- The parity case `post_admin_write` interpolates a multi-line predicate into an indented `withCheck`, PSL indents it differently, and `parity-red-old-join.log` shows the old join failing it.
- `sqlExpressionRegistration` is frozen at every level. Every reader reads or spreads it, and none writes to it: the family descriptor assigns `authoring.dataTypes` and `dataTypes` directly, and the six fixtures and the language-server test spread copies.
- Rendered index text goes through `new SqlExpression(...)`. The new test returns a two-line indented render and asserts the canonical text, so it fails if the canonicalization is removed. `renderFullTextIndexExpression` returns one line with no leading whitespace, so no committed contract changes.
- The policy refusal test now has four rows, including `policyUpdate` with one predicate a string and the other a `sql` value. If `predicateText` read `policy.using?.text`, a string's `.text` is `undefined`, the predicate is dropped, nothing throws, and every row fails. No other code checks policy predicates, so the test isolates `predicateText`.
- The `what` strings match the brief at every lowering site, and the unnamed index and check forms are tested. The check form `Check on "<Model>"` extends the decision in the same way; design section 15 and the error reference record it.
- ADR 260 states the infer and print rule once, in terms of what each command must keep unchanged. ADR 129, the error reference, design 11.2 and the app fragment link to it.
- The ADR 260 example now defines `Post` and compiles (`adr-260-example-tsc.log`).

## Findings

### G01. A second placeholder on the same line takes the indentation of the first value's last line (Medium)

- Location: `packages/2-sql/1-core/contract/src/sql-expression.ts`, `indentOfLastLine` and its call in `sql`; design section 2 step 2.
- Issue: The prefix is the leading whitespace of the last line of the text joined so far. After a multi-line value, that last line is the value's own last line, already prefixed. If that line is indented deeper than the template line, a later value on the same template line gets the deeper prefix. Probe (`wip/review3-round2/probe.mjs`), with `a` = `x\n  OR y` and `b` = `p\nq`:

  ```ts
  sql`
      (${a}) AND (${b})
      AND z
  `.text; // "(x\n  OR y) AND (p\n  q)\nAND z"
  ```

  The documented rule ("the indentation of the template line the `${…}` sits on") gives `(x\n  OR y) AND (p\nq)\nAND z`. The design's own sentence and its parenthetical disagree here: the sentence says "the template line", the parenthetical says "the last line of the text joined so far". No test covers two multi-line values on one line.
- Suggestion: Track the indentation of the current template line from the template pieces only. Keep it across values, and recompute it only when a template piece holds a line break. Add a unit test with the probe above, and correct the design parenthetical.

  ```ts
  let lineIndent = leadingIndent(lastLineOf(first));
  // per value: insert value with `\n${lineIndent}`; then if the next piece holds '\n', lineIndent = leadingIndent(lastLineOf(piece))
  ```

### G02. `fullTextIndex` names the index "undefined" when neither `name` nor `map` is given (Low)

- Location: `packages/3-extensions/postgres/src/contract/full-text-index.ts`, the `requireSqlExpression` call.
- Issue: The types require `name` or `map`, but this message exists only for JavaScript that is not type-checked. Such a caller can omit both, and the helper runs before lowering's "expression without `name:`/`map:`" check, so the message is ``Full-text index "undefined" where must be a sql`...` value.``
- Suggestion: Fall back to the column, which the helper has: `Full-text index on "${column.fieldName}" where`. Record the form in design section 15 and the error reference beside `Index on "<Model>" where`.

### G03. The glob list with a `!` negation is a form no skill or script defines (Low)

- Location: `upgrade-instructions/pending/sql-expression-literals-ts/app/instructions.md` and `.../extension/instructions.md`, changes `builder-raw-sql-is-a-sql-value` and `storage-hash-may-change-once`.
- Issue: `skills-contrib/record-upgrade-instructions/SKILL.md` describes `detection` only as "glob and content predicate". The consumer, `skills/prisma-8/references/upgrade-app.md` step 4, says "glob + content predicate". `scripts/check-upgrade-coverage.mjs` never reads `glob`; it checks only that `changes` is an array and that `script` paths resolve. No released fragment uses a list or a negation. So neither a list nor `!` is supported in any documented sense. The only definition of their meaning is the implementer's `wip/3-fixes/detection-check.mjs`. An upgrade agent will most likely read it correctly, and the prose sentence about migration files protects the case anyway, but nothing guarantees it.
- Suggestion: Add one sentence to the skill's step 3 and to `upgrade-app.md` and `upgrade-extension.md` step 4: "`glob` is a string or a list; a list entry starting with `!` excludes the paths it matches." If that is out of scope for this slice, keep the list and say in the pull request description that this is the first fragment to use it.

### G04. Two docs still say the rendered index string reaches the IR as it is (Low)

- Location: `packages/2-sql/2-authoring/contract-ts/README.md` line 263; `upgrade-instructions/pending/sql-expression-literals-ts/extension/instructions.md`, `policy-handles-hold-sql-values` ("`DeferredIndexExpression.render` still returns a string").
- Issue: Lowering now canonicalizes the text `render` returns (A07). The README says "The rendered string is what reaches the IR". The extension fragment says only that `render` still returns a string. An extension whose `render` returns indented or multi-line text gets a different stored text and a one-time storage hash change, and its authors are not told. Design section 15.5 is correct.
- Suggestion: README: "Lowering canonicalizes the rendered string as a `sql` literal is canonicalized, and that text reaches the IR." Extension fragment: add "lowering canonicalizes the text it returns, so a `render` that returns indented or multi-line text stores different text once, as in `storage-hash-may-change-once`."

## Deferred

- **The error for a renderer's NUL or oversize text.** `new SqlExpression(rendered)` throws `CONTRACT.SQL_EXPRESSION_INVALID` with "Tagged literal …" and an offset into the rendered text, without naming the index. The code is the right one: the text is a `sql/expression` value. The message is poor for this caller, but neither case is reachable from `fullTextIndex` (one line from a column name and a language), and any other renderer is extension code generating SQL. Not worth a round.
- **The infer-note detection reads only `**/contract.prisma`.** Earlier fragments use `**/*.prisma`, and a project carried over from Prisma 7 may keep `schema.prisma`. The pattern also matches the `contract.prisma` copies inside migration folders and multi-line defaults that do read back. The brief chose this glob and "a `@default(sql` whose text spans lines", the change is prose only, and the nearest false positive (a single-line `@default(sql\`lower('a')\`)`) does not match. Left as decided.
- **Round 1's F02 premise.** The `using` row on `policySelect` and the `withCheck` row on `policyInsert` already existed at `0efa27e370`; round 1 missed them. The fix adds the `policyUpdate` rows, which test each predicate with the other one valid. No action.

## Already addressed

| Item | Fixing commit | Matches the decision |
| --- | --- | --- |
| A01 interpolation indentation | `5a04175542`, `c2fa244f14`, `cf271bbcfd`, `1b0343dd4e`, `4c9e7c996e` | Yes for the common cases; G01 for two multi-line values on one line |
| A02 ADR 129 contradiction | `cf271bbcfd` | Yes; `.defaultSql()` added |
| A03 one statement of the infer and print rule | `cf271bbcfd`, `1b0343dd4e`, `4c9e7c996e` | Yes; ADR 260 section, four one-sentence links |
| A04 `what` names the object | `3df5d02c8c`, `cf271bbcfd`, `4c9e7c996e` | Yes; `map` fallback and `Check on` extend it; G02 |
| A05 orphaned doc comment | `d26c9d8eed` | Yes |
| A06 registration shape | `5a04175542`, `f757eb79e0` | Yes |
| A07 canonicalize rendered text | `3df5d02c8c` | Yes; G04 for two docs |
| A08 ADR 254 wording | `cf271bbcfd` | Yes |
| A09 infer note has its own change id | `1b0343dd4e` | Yes; pattern-based, `**/contract.prisma` |
| F01 migration files | `1b0343dd4e` | Yes; G03 for the glob form |
| F02 policy refusal test | `3df5d02c8c` | Yes |
| F03 several values; oversize `meta` | `5a04175542` | Yes |
| F04 `not.toExtend` | `d26c9d8eed` | Yes |
| F05 fixtures spread the registration | `f757eb79e0` | Yes |
| F06 import pattern names `sql` | `1b0343dd4e` | Yes; false positives `import { field }` and `import { field, model }` tested |
| F07 whole inferred default line | `d26c9d8eed` | Yes |
| Deferred: freeze registration | `5a04175542` | Yes; deep freeze tested |
| Deferred: define `Post` in ADR 260 | `cf271bbcfd` | Yes; compiles |
| Deferred: computed-string constructor in the plan | `4c9e7c996e` | Yes |

## Acceptance-criteria verification

| # | Criterion | Verdict | What I read |
| --- | --- | --- | --- |
| 1 | Round 1 #1 (was WEAK): `sql-expression.test.ts` covers several values and oversize `meta` | PASS | "joins several interpolated values in order" asserts the whole text; the oversize test asserts `meta: { reason: 'too-large', offset: 65536 }`. 56 tests pass in my run. |
| 2 | Round 1 #12 (was WEAK): breaking changes documented for both audiences | PASS | Migration-file sentence in both fragments; migrations excluded from both raw-SQL detections; F06 pattern narrowed and its false positives tested. G04 is a gap in one fragment. |
| 3 | Round 1 #18 (was WEAK): `check:upgrade-coverage` and validation by execution | PASS | `upgrade-coverage.log` exits 0 after the status commit; `detection-check.log` 81 cases pass, including the committed migration file as a path that must not match. |
| 4 | A01: continuation lines take the template line's indentation; unit test and parity case | WEAK | Unit tests and parity case present and red before the fix. Two multi-line values on one line break the documented rule (G01). |
| 5 | A01: design 2, ADR 129, ADR 260, README, both fragments state the rule | PASS | All six state it; the design parenthetical describes the implementation, not the rule (G01). |
| 6 | A04: `what` strings at every site; recorded in design 15 and the error reference | PASS | Index `where` and `expression`, check, full-text `where`, policy `using` and `withCheck`, unnamed index and check; each tested with code, message and `meta`. G02 for a missing name. |
| 7 | A07: canonicalize rendered text in lowering; `render` returns a string; test | PASS | `indexExpressionText`; two-line render test asserts the canonical text. |
| 8 | A02, A03, A05, A06, A08 | PASS | Read each change at HEAD. |
| 9 | A09: own change id with a detection reaching PSL-only projects, tested against true and false positives | PASS | Positives: a backtick default that does not close on its line, a double-quoted default with `\r\n`. Negatives: a closed single-line default, `\d` in a double-quoted default, a multi-line `@@index` `where`. |
| 10 | F01: detection excludes migration files; prose says why | PASS | Both statements present. The list-with-negation form is undefined in the skill (G03). |
| 11 | F02: refusal test fails if `predicateText` read `.text` | PASS | Reasoned from the code: no other code checks predicates, so a dropped predicate throws nothing and every row fails. |
| 12 | F03 to F07 | PASS | Read each test at HEAD. |
| 13 | Deferred items: freeze, `Post`, plan entry | PASS | Deep freeze tested; ADR example compiles; plan lists the item with its reason. |
| 14 | `build`, `typecheck`, `lint`, `lint:deps`, `lint:casts`, `lint:throws`, `check:error-reference`, `lint:framework-vocabulary`, `lint:skills`, `fixtures:check` | PASS | `wip/3-fixes/*.log`, each exit 0; casts and throws delta 0; vocabulary 272 of 272. |
| 15 | Targeted integration files and the Postgres extension | PASS | `integration.log` 1262 tests pass; `ext-postgres.log` exit 0. |
| 16 | `test:packages` | NOT VERIFIED | 10 files fail. The three tarball tests are known. `language-server` and `mongo-orm` pass alone. `render-typescript.roundtrip`, two `cli-telemetry` files and `driver.buffered-release` fail alone with timeouts under a load average near 230. None is touched by the fixes except the language-server test, which passes alone. CI must confirm. |

## Counts

| Item | Count |
| --- | --- |
| Findings | 4 (G01 to G04) |
| Medium | 1 (G01) |
| Low | 3 (G02 to G04) |
| PASS | 14 |
| WEAK | 1 |
| FAIL | 0 |
| NOT VERIFIED | 1 |
