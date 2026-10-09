# Slice 3 system design review, round 2: the review fixes (TML-3289)

## Scope

Branch `tml-3289-sql-expression-ts`, commits `0efa27e370..f23bee0e68` (`a96c781ef6` to `f23bee0e68`). I read the diff outside `projects/`, the code at HEAD of every changed source file, the fixes brief (`dispatches/3-review-fixes-brief.md`), design sections 2, 3.1, 11.2 and 15, the status entry "Slice 3 review fixes", ADRs 129, 254 and 260, the error reference, the contract-ts README, both upgrade fragments, and the framework canonicalizer (`canonicalizeTaggedLiteralBody`). I did not run builds or tests. I traced the interpolation cases below by hand against the code.

## Round 1 findings against the decisions

| Finding | Decision in the brief | Result | Commits |
| --- | --- | --- | --- |
| A01 | Prefix each continuation line of an interpolated value with the leading whitespace of the template line where its `${…}` sits; unit test and parity case; update design 2, ADR 129, ADR 260, README, fragments | Fixed as decided for one placeholder per line. The code measures the line in the joined text, not the template line, so it deviates when two placeholders share a line (B01) | `5a04175542`, `c2fa244f14`, `cf271bbcfd`, `1b0343dd4e`, `4c9e7c996e` |
| A02 | As suggested | Fixed as decided. ADR 129's infer bullet ends at the print refusal; the default bullet names `.defaultSql()` | `cf271bbcfd` |
| A03 | ADR 260 states the reason once; four other places say one sentence and link | Fixed as decided. The new ADR 260 section says what each command keeps unchanged; ADR 129, ADR 260's consequence bullet, the error reference, design 11.2 and the app fragment point to it | `cf271bbcfd`, `1b0343dd4e`, `4c9e7c996e` |
| A04 | `what` names the object; unnamed index is `Index on "<Model>"`; strings in design 15 and the error reference | Fixed as decided, with one gap for an untyped `fullTextIndex` call (B04) | `3df5d02c8c`, `cf271bbcfd`, `4c9e7c996e` |
| A05 | As suggested | Fixed as decided | `d26c9d8eed` |
| A06 | As suggested | Fixed as decided. The descriptor reads `sqlExpressionRegistration.authoring.dataTypes`; six fixtures and the language-server test follow | `5a04175542`, `f757eb79e0` |
| A07 | Canonicalize the rendered text in lowering through the same canonicalizer; `render` keeps returning a string; test with a two-line render | Fixed as decided. The docs that describe `render` were not updated (B02) | `3df5d02c8c` |
| A08 | As suggested | Fixed as decided | `cf271bbcfd` |
| A09 | Own change id in the app fragment, detection on `**/contract.prisma` | Fixed as decided: `infer-notes-defaults-that-do-not-read-back`, two patterns, and a sentence that PSL-only projects are affected | `1b0343dd4e` |

## The implementer's addition: unnamed checks

An unnamed check is named `Check on "<Model>" expression`, like an unnamed index. This is right. `check()` takes an optional `name` and `map`, so the branch is reachable, and treating checks and indexes the same way keeps one rule for the reader. Design 15.3, the error reference and both fragments record it, and `contract-lowering.sql-expression.test.ts` tests it. `constraintOwner` is one function for both kinds, so the two cannot drift.

## What I checked with no issue

- The interpolation rule is worded the same way in design section 2, ADR 129 line 86, ADR 260 line 135, the README line 118 and both fragments: "each line of an interpolated value after its first takes the indentation of the template line the `${…}` sits on". The two "same text as PSL" claims follow from it.
- A placeholder in the middle of a line: the continuation lines take the line's leading whitespace, not the column of the placeholder. The unit test "not by the text before it" pins this, and the docs say "indentation of the template line", which matches.
- A value whose own lines are indented: the value's relative indentation is kept on top of the template's. The first new unit test and the parity case `post_admin_write` cover it.
- Tabs and spaces: the prefix copies the template's characters, and `commonIndent` counts characters, so a tab-indented template gives the same result as the PSL literal with the same tabs. Mixed tabs and spaces behave as they do in PSL.
- Blank lines inside a value get the prefix, become whitespace-only, and canonicalize back to empty. A placeholder on the template's first line gets no prefix, which is also what PSL gives.
- `sqlExpressionRegistration` has the shape `{ dataTypes, authoring: { dataTypes } }` and an exported interface. Its containers are frozen (see B05 for the leaves).
- `new SqlExpression(render(...)).text` is a fair way to state the rule "rendered text is canonicalized as a `sql` literal is". The constructor is the one place that canonicalizes and refuses with a code; `canonicalSqlText` returns `undefined` on failure and would need a second refusal. The cost is the unnamed refusal in B03.
- ADR 260's section "Column defaults that do not read back" gives the reason in terms of what each command must keep unchanged. The anchor `#column-defaults-that-do-not-read-back` matches the heading in all three links.
- The new fragment change `infer-notes-defaults-that-do-not-read-back` is in the app fragment only; the extension fragment has one sentence and a pointer. `contract infer` writes `contract.prisma` by default (`cli/src/orm/contract/paths.ts`), so the glob reaches the file infer produces.
- ADR 254 now names `sql/expression` as the one type without a codec. ADR 260's example defines `Post`.

## New findings

### B01. The code measures the line in the joined text, not the template line, so two placeholders on one line break the stated rule

Location: packages/2-sql/1-core/contract/src/sql-expression.ts lines 145-160; projects/sql-expression-literals/design.md line 90; projects/sql-expression-literals/status.md, "Slice 3 review fixes", bullet A01.

Issue: `indentOfLastLine(text)` reads the leading whitespace of the last line of the text joined so far, which includes the values already inserted. Every doc says the indentation comes from "the template line the `${…}` sits on". The two differ when an earlier multi-line value on the same template line ends on a line with its own indentation. Example: `a` is `` sql`x\n  y` `` (text `"x\n  y"`), `b` is `"p\nq"`, and the template is `` sql`\n    ${a} AND ${b}\n` ``. The code prefixes `q` with six spaces (from `"      y AND "`), so the result is `"x\n  y AND p\n  q"`. The stated rule prefixes `q` with the template line's four spaces and gives `"x\n  y AND p\nq"`. This case is realistic: the parity fixture's `ownerOrAdmin` ends on the indented line `  OR auth.role() = 'admin'`, so `${ownerOrAdmin} AND ${other}` with a multi-line `other` hits it. Design section 2 states both readings in one sentence ("the template line … (the spaces and tabs at the start of the last line of the text joined so far)"), and the status entry says they are the same. No test has two placeholders on one line with a multi-line first value.

Suggestion: make the code follow the stated rule, because that is what the author sees in the source and what five documents promise. Compute the indentation from the template pieces only: keep the leading whitespace of the current template line, and update it only when a template piece contains a line break. Add a unit test with two multi-line values on one indented template line, the first ending on an indented line. Correct the parenthesis in design section 2 and the status bullet. If you keep the code instead, every document must say "the line the value starts on, after earlier values are inserted", which is harder to explain.

### B02. The docs still say the rendered string reaches the contract as it is

Location: packages/2-sql/2-authoring/contract-ts/README.md line 263; upgrade-instructions/pending/sql-expression-literals-ts/app/instructions.md line 64 and lines 87-89; upgrade-instructions/pending/sql-expression-literals-ts/extension/instructions.md line 73, lines 96-98 and line 108.

Issue: the README says "The rendered string is what reaches the IR". Since A07, lowering canonicalizes it. The fragments say `render` "still returns a string" but not that its text is now canonicalized. A `render` written by an app or an extension that returns indented multi-line text, or text with a blank first or last line, now stores different text. That changes the storage hash once, and for an index named with `map:` the next `migration plan` stops with a conflict. The `storage-hash-may-change-once` change and its detection cover only raw-SQL fields written as strings, so this case is not mentioned anywhere.

Suggestion: in the README, say that lowering canonicalizes the rendered text as a `sql` literal is canonicalized. In both fragments, add one sentence to `storage-hash-may-change-once` saying a `{ fields, render }` expression whose rendered text is not canonical changes once too, with the same steps. The built-in `fullTextIndex` renders one line, so it is not affected; say so.

### B03. A rendered text with a NUL character or over 64 KiB is refused without naming the index

Location: packages/2-sql/2-authoring/contract-ts/src/contract-lowering.ts lines 861-866.

Issue: `new SqlExpression(render(...))` throws `CONTRACT.SQL_EXPRESSION_INVALID` with only `reason` and `offset`. Every other refusal in this path now names the object (`owner` is already in scope). Before A07 such text was stored, so this is a new refusal that the author cannot trace to an index.

Suggestion: pass `owner` into the refusal. For example, test with `canonicalSqlText(rendered)` and, when it returns `undefined`, throw with `` `${owner} expression` `` in the message and meta; or catch the constructor's error and rethrow it with the owner added. Add the case to the error reference row for `CONTRACT.SQL_EXPRESSION_INVALID`. Low priority: a render that produces such text is unlikely.

### B04. An untyped `fullTextIndex` call with neither `name` nor `map` reports `Full-text index "undefined" where`

Location: packages/3-extensions/postgres/src/contract/full-text-index.ts lines 86-96.

Issue: the `what` string is built from `options.name ?? options.map`. The types require one of them, but this check exists only for JavaScript that is not type-checked, which can omit both. The message then names an object called `undefined`.

Suggestion: when both are missing, use the field, matching the unnamed-index form: `` `Full-text index on "${column.fieldName}" where` ``. Add it to design 15.3 and the error reference beside `Index on "<Model>" where`.

### B05. The registration is frozen only at its containers

Location: packages/2-sql/1-core/contract/src/sql-expression.ts lines 20-43; packages/2-sql/1-core/contract/test/sql-expression.test.ts, test "is frozen, so no importer can change what the family registers".

Issue: `Object.freeze` covers the registration, its array and its two records. `sqlExpressionDataType` (and its `casts` record) and `sqlExpressionAuthoringEntry` (and its `written` object) stay mutable at run time, so an importer can still add a cast to the registered data type or change the entry's `parse`. The test name and the status entry ("deeply frozen") claim more than the code does.

Suggestion: freeze `sqlExpressionDataType` and `sqlExpressionAuthoringEntry` where they are defined, including `casts` and `written`, and extend the test to them. If that is not wanted, rename the test to say only the registration's containers are frozen.

### B06. The design does not describe the registration, and its `sql` signature comment is stale

Location: projects/sql-expression-literals/design.md line 78 and section 3.1 (line 105).

Issue: section 3.1 still says the family descriptor holds `[sqlExpressionDataType]` and a literal `{ [SQL_EXPRESSION_DATA_TYPE_ID]: sqlExpressionAuthoringEntry }`. The code reads both from `sqlExpressionRegistration`, whose shape was the subject of A06, and the design never names that value. The doc comment on `sql` in the section 2 code block is the old one; the code's comment now states the indentation rule.

Suggestion: add `SqlExpressionRegistration` and `sqlExpressionRegistration` to the section 2 code block, change section 3.1 to say the descriptor reads `sqlExpressionRegistration.dataTypes` and `.authoring.dataTypes`, and copy the code's `sql` doc comment into section 2.
