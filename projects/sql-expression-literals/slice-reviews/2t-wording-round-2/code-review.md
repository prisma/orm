# Code review, round 2: slice 2t wording fixes

Range: `96cdb4ac1c..993d104a4b` on `m29-2t` (five commits). Spec: `projects/sql-expression-literals/dispatches/2t-wording-fixes-brief.md`, with round one's `slice-reviews/2t-wording/system-design-review.md` (B01 to B10) and `code-review.md` (G01 to G06). Lens: principal engineer, with the architect's naming probes.

## Summary

Every round-one finding is fixed as the brief decided. The exact rewrite is now a framework function, `exactRewrite`, called by both `dataTypeValue` and `@default`. Forms are compared by kind and tag, not by phrase. The `Expected <forms>` sentence has one builder, and the list-element arm no longer builds a fake `no-cast` refusal. The new tests cover each fix, and no test lost an assertion. The implementer's logs show red then green for the package tests, a green build, typecheck, lint, casts (delta 0), throws, error reference, framework vocabulary, fixtures and upgrade coverage, and 40 of 40 passing in the two integration files. The `test:packages` failures are the three known tarball tests plus a telemetry e2e timeout that passed on rerun (`wip/2t-wording-fixes/rerun-cli-telemetry.log`).

The findings are small: ADR 231 now says less than the code does, `dataTypeValue` still walks the forms twice for its label, one export has no consumer, and the extension fragment's export list misses the new types a caller needs.

## What looks solid

- The extra check in `exactRewrite` (offer the rewrite only when the receiving type takes the tagged literal) is correct, and it cannot loop or report twice. It reads `{ kind: 'tag', tag, text: written.text }` through `readWrittenValue` and `castTypedValue`, which are pure and push no diagnostics. It runs once per refusal and returns a string or `undefined`. The text it reads is exactly the text the parser would deliver for the printed literal, because `printedTaggedLiteralReadsBack` has already confirmed that the literal's canonical text equals `written.text`. So the check never reads one text and promises another. `castTypedValue` turns a throwing cast into a refusal and lets only `InternalError` through, the same rule as the main path.
- The check changes nothing for `sql`: the `sql/expression` entry's parse is the identity, so every string that reads back still gets ``write sql`...` ``. It only suppresses rewrites that would themselves be refused, as `Jsonb @default("plan")` shows.
- Comparing form kinds classifies every real stack's types the same way the old phrase comparison did. Postgres: `pg/text` string, `pg/bool` boolean, `pg/int2`, `pg/int4`, `pg/int8` and `pg/numeric` number (through the numeric entry's `types`), `pg/json` tag `json`, `sql/expression` tag `sql`. SQLite: `sqlite/text` string, `sqlite/integer`, `sqlite/bigint` and `sqlite/real` number, `sqlite/json` tag `json`. pgvector and postgis register no authoring entries, so their types have no form of their own and take forms only through casts. `isSameForm` returns false when one side is a tag and the other is not, because the kinds differ.
- `rewriteOf` in `packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts` (lines 340-354) indexes `input.written` with the refusal's element index before `atSourceElement` renumbers it. That is the right list: `readDataTypeDefault` produced that index from the same `input.written`, which leaves out `null` elements. Only `no-cast` gets a rewrite, so `no-element-cast` (pgvector) and `no-list-cast` never do.
- `describeRefusedValueType` takes only `receivingType` and `valueType`, so both the `no-cast` arm and the `no-element-cast` arm call it without inventing a refusal object (G06).
- `WrittenForm` uses the same kind names as `WrittenValue` (`tag`, `string`, `boolean`, `number`), so the two types read as a pair. The phrase is carried beside the identity and only `joinForms` reads it.
- The psl-parser round-trip test parses each offered rewrite with `dataTypeValue` and checks the value, for the backtick, double-quote, backslash and multi-line cases. The read-back promise in the docs is now checked, not assumed (G04).
- No bare `as` was added (`lint:casts` delta 0). The one new comment on a private function (`rewriteOf`) explains the renumbering order, which the code cannot say.
- `docs/reference/error-reference.md`, both pending fragments and `design.md` match the code strings I compared: ``Field "N.meta": Expected json`...`; write json`{}` ``, ``Expected sql`...`; got an identifier``, and the `InternalError` text for a type nothing writes.

## Findings

### H01 — ADR 231 still describes the rewrite and the parse-time errors as before

`docs/architecture docs/adrs/ADR 231 - Declarative attribute specifications.md` lines 208 and 210; `packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/data-type-value.ts` line 29.

Line 208 says a quoted string gets the literal to write "when that literal reads back as the same text". The code now also requires that the receiving type takes the literal; `error-reference.md` and the fragments say so, the ADR does not. Line 210 says parsing throws an internal error "when the stack does not register `dataType`". It now also throws when the type is registered but nothing in the stack writes it (G01). The `dataTypeValue` doc comment says it is used "as a parameter of an attribute or a `funcCall`", while ADR 231 line 212 says "an attribute, a block or a `funcCall`".

Suggestion: on line 208 add "and the receiving type takes it". On line 210 add the second case: "or registers it but nothing in the stack writes it". Make the doc comment's list match line 212.

### H02 — `dataTypeValue` still computes the forms twice and writes the tag phrase by hand

`packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/data-type-value.ts` lines 34-39; `packages/1-framework/1-core/framework-components/src/shared/written-value.ts` lines 297-304.

`forms` is computed on line 36, and the label on line 39 then calls `describeAdmittedForms`, which walks the same types again. The tag branch builds `` `${firstTag}\`...\`` `` itself, which repeats the phrase `tagForm` owns. G05 asked for one computation and one place that joins forms; the parse path now has that, the label does not. If the tag phrase changes in `tagForm`, the label will not follow.

Suggestion: build the label from `forms`: `firstTag === undefined ? <phrases of forms joined> : tagForm(firstTag).phrase`. The simplest way is to let the joining function take forms (rename `describeAdmittedForms` to take `readonly WrittenForm[]`, or export `joinForms` under a `describe*` name). `describeAdmittedForms(support, dataType)` then has no caller and can go.

### H03 — `printedTaggedLiteralReadsBack` is exported with no consumer outside its package

`packages/1-framework/1-core/framework-components/src/exports/authoring.ts` line 74.

Before this range psl-parser imported it to decide the rewrite. Now only `written-value.ts` in the same package uses it, and its test imports it from `src/shared/tagged-literal`. The public authoring entry exports a function nobody outside needs.

Suggestion: drop it from `exports/authoring.ts`; keep `printTaggedLiteral`, which `contract` and `9-family` use. Update `design.md` section 4 if it lists the export (it mentions the function only inside the `exactRewrite` description, which stays true).

### H04 — The extension fragment lists the new functions but not the types needed to call them

`upgrade-instructions/pending/arguments-typed-by-data-type/extension/instructions.md` line 158.

The paragraph lists `admittedForms`, `describeExpected`, `describeRefusedValueType` and `exactRewrite`, and it lists `describeRefusal`. All of these take or return `WrittenForm`, and `describeRefusal` and `describeRefusedValueType` take a `RefusalGuidance`. `WrittenForm`, `RefusalGuidance` and `tagForm` are not listed, though `contract-psl` imports all three. An extension author who reads the list cannot build the guidance argument.

Suggestion: add `WrittenForm`, `RefusalGuidance` and `tagForm` to the list.

## Deferred

- In `@default`, `exactRewrite` checks the cast rule but not the column's codec (`readStored` with `decodeJson`) or the value-object check in `psl-column-resolution.ts`. A codec that validates more than the cast rule, such as the arktype JSON codec on `pg/jsonb`, could refuse the rewritten literal with `PSL_INVALID_DEFAULT_LITERAL`. The arktype JSON codec is reached from TypeScript contracts, which do not go through `lowerDataTypeDefault`, so no PSL path reaches this today. If one does, the second message still names the problem; the cost is one extra round of editing.
- A multi-line rewrite puts newlines inside the diagnostic message (``write sql`\n...\n` ``). `dataTypeValue` already did this before the range; `@default` now does it too. Worth a look when someone reviews how the CLI and language server render multi-line messages.
- `exactRewrite` uses only the first admitted tag. No type on any stack admits two tags today (`json` and `sql` are the only tags), so a second tag that would succeed cannot be missed.
- `describeRefusedValueType` reads cold as "describe a type", but it returns the whole message for a value its receiving type refuses. A name such as `describeNoCast` would read truer. Not worth a rename on its own; consider it if H02 touches the neighbouring names.
- The round-one deferred items still stand: the `Unknown literal tag` detection pattern, the broad `this target` pattern, the untested SQLite `Int @default(true)` table row, and the ``write sql`` `` rewrite for an empty string.

## Already addressed

| Round-one finding | Status | Commit |
| --- | --- | --- |
| B01 ADR 254 and ADR 231 disagree about `nanoid(8)` | Fixed | `96cdb4ac1c` (before this range) |
| B02 Grammar-versus-database-value test | Fixed | `96cdb4ac1c` (before this range) |
| B03 Partition does not list the whole kit | Fixed | `96cdb4ac1c` (before this range) |
| B04 Rewrite policy in one consumer | Fixed: `exactRewrite` in the framework, used by both callers; docs updated | `8beb6e1df8`, `3e247cffde`, `8d75caf323` |
| B05 Form identity is a display string | Fixed: `WrittenForm` with `kind` and `tag`, compared by `isSameForm` | `8beb6e1df8` |
| B06 `Expected <forms>` written in two places | Fixed: `describeExpected` used by all three places, `; got` everywhere | `8beb6e1df8`, `8d75caf323` |
| B07 List-element arm borrows `no-cast` | Accepted as is by the brief | — |
| B08 `printTaggedLiteral` overclaims | Fixed: renamed to `printedTaggedLiteralReadsBack`, printer doc states the condition | `8beb6e1df8` |
| B09 `dataTypeValue` only as a `funcCall` parameter | Fixed in the ADR before this range; doc comment updated here (see H01 for the remaining mismatch) | `96cdb4ac1c`, `8beb6e1df8` |
| B10 `design.md` quotes the old message | Fixed | `96cdb4ac1c` (before this range) |
| G01 `Expected no written form` | Fixed: `InternalError` at parse, with a test | `8beb6e1df8` |
| G02 Integration test lost value typing per stack | Fixed: `1.5` on the integer type names `pg/numeric` and `sqlite/real` | `3e247cffde` |
| G03 Same-form rule on `no-element-cast` untested | Fixed: narrowed list cast fixture, whole message asserted | `8beb6e1df8` |
| G04 Read-back predicate untested for backslash and `${` | Fixed: both cases added, plus the parse-back test in psl-parser | `8beb6e1df8` |
| G05 Forms joined in two places, computed twice | Fixed for the parse path and the list arm; the label still recomputes (H02) | `8beb6e1df8` |
| G06 Synthesized `no-cast` carries wrong `casts` | Fixed: `describeRefusedValueType` takes only the two types | `8beb6e1df8` |
| Architect: parity test between `@default` and `dataTypeValue` | Fixed: three cases on the assembled Postgres stack | `3e247cffde` |
