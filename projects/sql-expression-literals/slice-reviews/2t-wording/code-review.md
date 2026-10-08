# Code review: slice 2t wording (refusals lead with what to write)

Range: `bot/tml-3367-data-type-value...HEAD` on `m29-2t` (four commits, f30e96104b to d8b7ff1983). Spec: `projects/sql-expression-literals/dispatches/2t-wording-brief.md` and item 15 of `projects/sql-expression-literals/design-notes.md`. Reviewer lens: principal engineer.

## Summary

The change does what the brief asks. Every cast-rule refusal now starts with `Expected <forms>`; type names appear only when a value of an admitted form is refused, and the exact `sql` rewrite is offered only when it reads back as the same text. The structure (codes, spans, `dataTypeValue`, `describeRefusal`) is unchanged. Code, tests and docs agree on every message string I compared. Verification logs under `wip/2t-wording/` show red then green for the three package test files, a green build, typecheck, lint, casts, throws and error-reference check, and the two integration files passing. The `test:packages` failures are the known tarball registry refusal plus timeouts that pass on rerun; the first `fixtures:check` run failed on a Mongo example emit and the second run completed.

The findings are about coverage and about the paths the new wording handles badly, not about the main messages. The biggest gap: the same-form rule on the `no-element-cast` arm has no test and cannot be reached with the only list cast in the repository, and the integration test lost its only check of how each assembled stack types a written value.

## What looks solid

- `noCastMessage` (`packages/1-framework/1-core/framework-components/src/shared/written-value.ts` lines 93-106) checks the same-form rule before the rewrite rule, as the brief says. The two rules cannot both apply: a quoted string always reads as the target's one text type, so if a quoted string were admitted the cast would not fail.
- The same-form comparison uses `writtenFormPhrase` on both sides (`admittedFormPhrases` builds `forms` with the same function), so the string comparison cannot drift.
- In `@default`, `forms` for the default `no-cast` arm comes from `[columnType]`, which is the refusal's `receivingType` (`packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts` lines 228-236). So "a number that pg/int4 can hold" always names the type that produced the forms. Only `no-element-cast` differs, as the brief intends.
- `taggedLiteralTextReadsBack` (`packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts` lines 164-173) is correct for the cases asked about. Leading whitespace on one line is removed as common indentation, so it returns false. A NUL fails canonicalization, so false. A backtick selects the double-quote form, which is canonicalized without the added blank lines, and indentation there also returns false. `${` is ordinary text in a PSL backtick string, so it reads back. A carriage return becomes `\n`, so false. Too-large text fails canonicalization, so no rewrite is offered.
- `RefusalGuidance.rewrite` is a required key typed `string | undefined`, which follows `required-key-undefined-fields`.
- No bare `as` casts were added. The new doc comments are on exported functions and are short.
- The upgrade fragment detection pattern `(: |['"\`])this target has no data type for a (string|boolean|number) value['"\`]` matches the released message (`Field "N.active": this target has ...`, preceded by `: `) and no longer matches the new one (preceded by `; `). `'; it casts from '` still finds the released `no-cast` messages, and the new messages do not contain it.
- `docs/reference/error-reference.md` prose for `PSL_VALUE_TYPE_INCOMPATIBLE` matches the code strings word for word: `Expected <forms>`, `Expected <forms> that <receiving type> can hold; got <value type>`, `Expected <forms>; got a list`, `Expected <forms>; this target has no data type for a <syntax> value`. Note that `pnpm check:error-reference` checks only that every code is listed; it does not compare prose, so this was checked by reading.
- The Prisma 7 contract source and its fixtures are untouched, as the brief requires.

## Findings

### G01 — `Expected no written form` when nothing writes the receiving type

`packages/1-framework/1-core/framework-components/src/shared/written-value.ts` lines 66-106 and 239-255; `packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/data-type-value.ts` lines 74-88.

When `guidance.forms` is empty, `joinForms` returns `no written form`, so `describeRefusal` says `Expected no written form` (for `no-cast`) or `Expected no written form; this target has no data type for a number value` (for `unwritable`). `dataTypeValue` passes `admittedFormPhrases(support, dataType)` unchanged, so this happens for any `dataTypeValue` position whose type is registered but has no written form and no cast from a written type. The old message was also poor (`... write no written form`), but it at least named the receiving type and the value's type. The new message names nothing, so a pack author who hits it cannot tell which type is wrong. `projects/sql-expression-literals/plan.md` line 132 already says this case is a pack bug and should be worded as one if a place ever reaches it. `@default` does not reach it, because `formsOf` falls back to ``sql`...` ``. No current `dataTypeValue` position reaches it either.

Suggestion: treat it like the unregistered-type case a few lines above it. In `parseDataTypeValue`, throw an `InternalError` naming the data type when `admittedFormPhrases` is empty, and add a test next to "builds for a type the stack does not register". Then `joinForms` no longer needs the `NO_WRITTEN_FORM` fallback for refusals.

### G02 — The integration test no longer checks how each assembled stack types a value

`test/integration/test/authoring/data-type-value.test.ts` lines 67-115.

Before this change, the refusal messages named the value's type, so this file checked that the real Postgres stack reads `"8"` as `pg/text` and `8` as `pg/int2`, and that SQLite reads them as `sqlite/text` and `sqlite/integer`. The `small` and `text` fields are removed and every refusal now reads the same on both stacks. The file now checks only the receiving type (`takes a number for the integer type`). It also has no case for the same-form rule, so nothing on the assembled SQLite stack exercises `Expected a number that <type> can hold; got <type>`. The contract-psl tests cover that rule on Postgres only.

Suggestion: add one case per stack that reaches the same-form rule and so names the value type, for example a number with a fraction on the integer type (`1.5`), with the expected value type in the stack's row of `describe.each`. That restores a real-stack check of value typing and covers AC6 on SQLite.

### G03 — The same-form rule on `no-element-cast` has no test

`packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts` lines 406-424; `packages/2-sql/2-authoring/contract-psl/test/interpreter.defaults.data-types.test.ts` around line 268.

The brief gives `Expected a number that pgvector/vector can hold; got pg/int8` as the second `no-element-cast` message. No test produces it. It also cannot happen on the real stack: pgvector's list cast takes `pg/int2`, `pg/int4`, `pg/int8` and `pg/numeric` (`packages/3-extensions/pgvector/src/core/data-types.ts` lines 66-72), which covers every number type Postgres reads. So the code path is live but untested. If it ever runs, the message names the column type (`pgvector/vector`), while the type that refused the value is one of the list cast's element types. The brief accepts this.

Suggestion: add a contract-psl test with a fixture data type whose list cast takes fewer number types (for example only `pg/int4`) and a default list with a number outside it, and assert the whole message. Without it, AC8 is only half verified.

### G04 — `taggedLiteralTextReadsBack` predicts the round trip instead of testing it, and its tests miss backslash and `${`

`packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts` lines 156-173; `packages/1-framework/1-core/framework-components/test/tagged-literal.test.ts` lines 174-193.

The function assumes that resolving the escapes of `printTaggedLiteral`'s output gives back exactly `text`, and only then applies canonicalization. That assumption holds today: the backtick form doubles backslashes and has no backticks, and the double-quote form escapes `\`, `"`, `\n` and `\r`. But nothing tests it. If `escapeQuotedText` or the PSL string lexer changes, the function keeps returning true and the message offers a rewrite that reads as different text. The test list has no backslash case (the one character `printTaggedLiteral` rewrites in the backtick form) and no `${` case, both named in the review brief.

Suggestion: add `a\\b` and `${x}` to the "holds" cases. In the psl-parser test file, add one test that parses the rewrite the refusal offers (for the backtick, double-quote and multi-line cases) as a tagged literal and checks that its canonical text is the original string. That turns the promise "when that literal reads back as the same text" in ADR 231 and `error-reference.md` into a checked one.

### G05 — Forms are joined in two places, and `dataTypeValue` computes them twice

`packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts` line 403; `packages/1-framework/1-core/framework-components/src/shared/written-value.ts` lines 253-259; `packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/data-type-value.ts` lines 59 and 74.

`no-list-cast` builds `Expected ${forms.join(' or ')}; got a list` itself, while every other message goes through the private `joinForms`. If the joining rule changes (for example a comma list), the list message will differ from the rest. Separately, `parseDataTypeValue` calls `describeAdmittedForms` for the not-a-literal message and `admittedFormPhrases` for refusals, which walks the same types twice and can drift if one of them changes.

Suggestion: compute `admittedFormPhrases` once in `parseDataTypeValue` and derive the joined string from it. Export one joining function from `written-value.ts` (or let `describeAdmittedForms` be that function) and use it in `no-list-cast`.

### G06 — The synthesized `no-cast` refusal carries the list cast's element types as `casts`

`packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts` lines 407-417.

`no-element-cast` builds `{ kind: 'no-cast', receivingType: <column type>, valueType, casts: refusal.elementTypes }`. In `CastRefusal`, `casts` means the types the receiving type casts from. The element types of the list cast are not that. `describeRefusal` ignores `casts`, so the message is correct, but the value is wrong for any future reader of the field.

Suggestion: pass the column type's real casts, or factor the `no-cast` wording into a function that takes only `receivingType`, `valueType` and the guidance, and call that from both places, so no refusal object has to be invented.

## Deferred

- The detection pattern `['"\`]Unknown literal tag ` in the `default-refusals-say-what-to-write` fragment (`upgrade-instructions/pending/arguments-typed-by-data-type/{app,extension}/instructions.md`) also matches `dataTypeValue`'s unknown-tag message, which still has no field prefix. This predates this range, and the fragment only asks a user to review the match.
- The new `this target` pattern also matches a downstream substring assertion such as `toContain('this target has no data type for a boolean value')`, which still passes against the new message. The cost is one needless review prompt. Not worth a narrower pattern.
- The fragments' table row `active Int @default(true)` on SQLite → `Field "N.active": Expected a number; this target has no data type for a boolean value` is not tested directly. The contract-psl test uses a `Boolean` column on a Postgres fixture with `pg/bool` removed, so it gives ``Expected sql`...` ``. The code path makes the documented message correct for an `Int` column. A SQLite test would belong with G02 if someone adds one.
- A refused empty string `""` for `sql/expression` is offered ``write sql`` `` ``. The `sql` entry accepts empty text, so the rewrite is valid, if odd. It behaves the same as before this range.

## Already addressed

None.

## Acceptance-criteria verification

AC1 to AC6 are the rows of the brief's first table, AC7 and AC8 the rows of its second table.

| AC | Requirement | Result | Evidence |
| --- | --- | --- | --- |
| AC1 | `unknown-tag` message unchanged | PASS | `written-value.test.ts` "words an unknown tag with the known tags" asserts `Unknown literal tag "pg.sql". Known tags: sql, json.` |
| AC2 | `unreadable` uses the entry's message | PASS | `written-value.test.ts` "words an unreadable value by its message"; psl-parser test "refuses a value its cast throws on" asserts `"not-a-uuid" is not a UUID.` |
| AC3 | `unwritable`: `Expected ${forms}; this target has no data type for a ${syntax} value` | PASS | `written-value.test.ts` asserts `Expected a number; this target has no data type for a boolean value`; psl-parser asserts ``Expected sql`...`; this target has no data type for a string value``; contract-psl `interpreter.defaults.data-types.test.ts` line 230 asserts the prefixed form |
| AC4 | `no-cast`, other form: `Expected ${forms}` | PASS | `written-value.test.ts` "words a value of another form" and "joins several forms with or"; psl-parser `"8"` on `pg/int4` and `42`/`true` on `sql/expression`; integration file on both stacks; contract-psl rows for `"{}"`, `"1"`, `json\`1\``, `1234` on `Bytes` |
| AC5 | `no-cast` with exact rewrite when the text reads back: ``Expected sql`...`; write sql`(archived_at IS NULL)` `` | PASS | psl-parser asserts the backtick and double-quote rewrites and that `"  (archived_at IS NULL)"` gets no rewrite; integration asserts ``Expected sql`...`; write sql`8` `` on both stacks; `tagged-literal.test.ts` covers the read-back predicate (see G04 for gaps) |
| AC6 | `no-cast`, same form: `Expected ${forms} that ${receivingType} can hold; got ${valueType}` | PASS | `written-value.test.ts` asserts `Expected a number that t/small can hold; got t/big`; psl-parser asserts `Expected a number that pg/int2 can hold; got pg/int4`; contract-psl asserts the `pg/int8` and `pg/numeric` rows on `pg/int4` (Postgres only, see G02) |
| AC7 | `no-list-cast`: `Expected ${forms}; got a list` | PASS | contract-psl rows `Field "N.count": Expected a number; got a list` and ``Field "N.meta": Expected json`...`; got a list``; `interpreter.value-object-storage.test.ts` asserts ``Field "User.home": Expected json`...`; got a list`` |
| AC8 | `no-element-cast`: the `no-cast` rule with element-type forms and the column as receiving type | WEAK | The other-form arm is asserted (`Field "N.embed" at element 2: Expected a number`). The same-form arm (`Expected a number that pgvector/vector can hold; got pg/int8`) has no test and is unreachable with the current pgvector list cast (G03) |

| Result | Count |
| --- | --- |
| PASS | 7 |
| WEAK | 1 |
| FAIL | 0 |
| NOT VERIFIED | 0 |
