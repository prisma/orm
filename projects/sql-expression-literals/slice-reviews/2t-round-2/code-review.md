# Slice 2t code review, round 2 (TML-3367)

Range: `30a0d70ff4..68b7fa589e` (the review fixes), read at HEAD `b9a099e97b`, which merges the slice 2a branch (with `origin/main`) on top. Reviewer lens: principal engineer. Round 1: `slice-reviews/2t/code-review.md` (F01 to F10) and `system-design-review.md` (A01 to A15).

## Summary

The fixes follow the operator's brief. `describeRefusal` is the one wording of a cast-rule refusal, `dataTypeValue` and `@default` both use it, `ControlStack.dataTypes` is built once and passed by reference, `createSqlBinder` requires `dataTypes`, and every round 1 WEAK item now has a test that fails when its behaviour is removed. I found no behaviour bug in the slice's own code.

The most important finding is outside the slice's own commits but was found through the merge check. The slice 2a branch tip on the bot remote (`5ddec3c5a2`, PR #30534) still expects `PSL_INVALID_DEFAULT_LITERAL` in three tests of `psl-date-time-defaults.integration.test.ts`, while that branch's code gives `PSL_INVALID_LITERAL`. HEAD of this slice is correct, because the merge commit changed them; the 2a branch fixed only the e2e file (G01).

Inside the slice, the new rule "an element read through a list cast suggests the forms of the list cast's element types" has no test (G02), and the extension upgrade fragment still says the `@default` messages are unchanged (G03).

Targeted runs, logs in `wip/2t-review-r2/`: framework-components `written-value` and `data-type-assembly` 49 pass (`fc.log`); psl-parser `data-type-value` and `written-scalar` 45 pass (`pp.log`); contract-psl default, spec, semantic-diagnostic and provider-interpret files 149 pass (`cp.log`); contract-prisma7 `defaults` and `provider` 26 pass (`p7.log`); Mongo `interpreter.test.ts` 118 pass (`mg.log`); language-server `config-resolution` 17 pass (`ls.log`); integration `authoring/data-type-value` 24 pass (`int-dtv.log`) and `date-time-defaults` 22 pass (`int-dt.log`).

## What looks solid

- `describeRefusal` (`written-value.ts:53-79`) switches over all four kinds of `ReadRefusal | CastRefusal` with no default, so a new kind is a compile error. Each kind has a whole-result test.
- `dataTypeValue` passes `it as <literal>` for a quoted string on a tagged type and the admitted forms otherwise, so its messages are unchanged; the integration test on assembled stacks asserts both forms.
- `lowerDataTypeDefault` adds only the location prefix. The only wording it keeps is the default-only arms and `no-list-cast`, in the same `write <forms>` pattern.
- `readDataTypeDefault` reaches `no-list-cast` in every case where a list is written on a single-value column: `isList` false and a written list always goes to `readListIntoScalar`, which checks the list cast first, before it reads any element. Both the SQL interpreter (`psl-column-resolution.ts`) and Prisma 7 (`defaults.ts` `scalarValue`) reach it. `count Int @default([1, 2])` and `meta Jsonb @default([1, 2])` are tested.
- `ControlStack.dataTypes` is built once in `createControlStack` (`control-stack.ts:856`). `data-type-assembly.test.ts` asserts `entries` and `lookup` are the same objects as `authoringContributions.dataTypes` and `dataTypeLookup`. `lspControlStackFromStack` and `resolveInterpretation` pass `stack.dataTypes`, and `config-resolution.test.ts` asserts identity with `toBe`. `load-contract-source.ts` passes `stack.dataTypes`, and the SQL, Prisma 7 and Mongo providers pass `context.dataTypes` through.
- `ContractSourceContext` has two production construction sites (`load-contract-source.ts`, `config-resolution.ts`), so the brief's rule chose the change correctly.
- The test sites that switched to `{ entries: {}, lookup }` (`cli/test/config-types.test.ts`, Mongo `provider.test.ts`, `provider.interpret.test.ts`, Mongo `contract-ts/test/config-types.test.ts`) all had `authoringContributions.dataTypes: {}` before, so none lost entries. The contract-psl tests that moved from a bare lookup to `fixtureDataTypeSupport` now run with the fixture's entries, which tests more, not less. `interpreter-defaults-support.ts` and `interpreter.enum.test.ts` still merge a test's own entries into the pair.
- The colon-qualified callee test builds the tree by hand, but it is not vacuous: without the colon check in `plainCallee`, `identifier()` returns `nanoid`, `oneOf` routes the call, and the test gets the cast refusal at `"8"` instead of `Expected one of`.
- The Mongo `@@index([email(sort: Up)])` test asserts the whole diagnostic at `Up`; before the `oneOf` rule it would be `Expected one of` at the whole call.
- No old name is left in code or current docs: `readWrittenLiteral`, `WrittenLiteralResult`, `dataTypeSupport`, `checkSqlDefaultBody`, `reservedSqlDefaultBody`, `UNSAFE_DEFAULT_BODY` and `default-sql-body` appear only in the upgrade fragment's rename table and in released upgrade instructions. `dataTypeLookup` remains only where it is still the right field (`ControlStack`, `SqlPslBuildContext`, psl-print); see G06.
- The merge check. The intersecting files changed only by main's refactors (`getAttribute` in place of `findFieldAttributeNode`, the physical-name map, `typeReferenceNode`). None touches the `@default` value path, and `dataTypes` passes through unchanged.
- The merged date and time tests. A quoted date is read by the plain-string entry as `pg/text` or `sqlite/text`. The column type's cast from text (`dateTimeType` in postgres `data-types.ts:199-202`, `sqliteDatetime` in sqlite `data-types.ts:73-76`) throws. `castTypedValue` catches the throw as a `CastRefusal` of kind `unreadable`, and `describeRefusal` gives `PSL_INVALID_LITERAL`. Design section 10.1 maps `unreadable` of any origin to `PSL_INVALID_LITERAL`. So all four merged assertions (three in `psl-date-time-defaults.integration.test.ts`, one in the `control-plane-commands-without-temporal` e2e test for `"not a date"`) are right at HEAD. The commit message's reason is slightly off: the column type's cast refuses the text, not the authoring entry.

## Findings

### G01. The slice 2a branch tip still expects the old code in three date and time tests

- Location: `test/integration/test/date-time-defaults/psl-date-time-defaults.integration.test.ts` lines 114, 126 and 139, on branch `tml-3296-sql-expression-data-type` at `5ddec3c5a2` (the bot remote's tip, PR #30534).
- Issue: that branch merged `origin/main` (`63b30c50c8`), which brought TML-3302's tests. Its follow-up commit `5ddec3c5a2` changed only the e2e file. On that branch `lowerDataTypeDefault` maps `unreadable` to `PSL_INVALID_LITERAL` and `castInto` turns a throwing cast into `unreadable`, so these three tests fail there. HEAD of slice 2t passes (`wip/2t-review-r2/int-dt.log`) only because merge commit `b9a099e97b` changed them.
- Suggestion: add one commit on the 2a branch that changes the three codes to `PSL_INVALID_LITERAL`, run that file alone, and push. In the commit message say the column type's cast from text refuses the value.

### G02. No test covers a refused element of a list read through a list cast

- Location: `packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts` lines 230-246; `packages/2-sql/2-authoring/contract-psl/test/interpreter.defaults.data-types.test.ts` lines 124-207.
- Issue: the status says "for an element read through a list cast, the forms are those of the list cast's element types". The code passes `listCast.of` as `receivingTypes` to `readOneValue` and to the element `no-cast` refusal. No test writes a refused element on a column with a list cast; the two vector tests cover only a throwing list cast and a codec refusal. If both places passed `[input.columnType]`, the message would end `write no written form` (`pgvector/vector` has no written form), and every test would still pass. The dedup in `formsOf` is untested for the same reason.
- Suggestion: add two rows to the table test, each asserting code, message and the element's span.

```ts
[
  'text among the elements of a vector',
  'embed pgvector.Vector(3) @default([1, "x", 3])',
  'PSL_VALUE_TYPE_INCOMPATIBLE',
  'Field "N.embed" at element 2: pgvector/vector has no cast from pg/text; write a number',
],
[
  'an unknown tag among the elements of a vector',
  'embed pgvector.Vector(3) @default([1, pg.json`2`, 3])',
  'PSL_UNKNOWN_LITERAL_TAG',
  'Field "N.embed" at element 2: Unknown literal tag "pg.json". Known tags: sql, json.',
],
```

### G03. The extension upgrade fragment says the `@default` messages are unchanged

- Location: `upgrade-instructions/pending/arguments-typed-by-data-type/extension/instructions.md` line 157, and its front matter (lines 1-50).
- Issue: the section "`@default` refusals point at the written value" says "The codes and messages are unchanged." After A15 the messages change: `; it casts from …` becomes `; write <forms>`, `Unknown literal tag` gains the field prefix, and `this target has no data type` gains a capital and a rewrite. Only the app fragment has the change `default-refusals-say-what-to-write`. An extension pack whose tests assert a `@default` message (the detection `\bPSL_VALUE_TYPE_INCOMPATIBLE\b` finds them) is told nothing changed.
- Suggestion: change the sentence to "The codes are unchanged; the messages change as the app instructions' table shows." Add the change `default-refusals-say-what-to-write` to the extension front matter with the app fragment's detection patterns and a short section with the same before and after table.

### G04. The Prisma 7 wording of `no-list-cast` has no test

- Location: `packages/2-sql/2-authoring/contract-prisma7/src/defaults.ts` lines 324-325.
- Issue: the new arm words a list written on a single-value column as `holds a list, which <type> has no cast from; it casts from <types>.` Before the fix this case printed `holds a a list value, …`. No contract-prisma7 test writes a list on a single-value column, so a wrong arm or text passes. `error-reference.md` line 766 documents the message.
- Suggestion: add a case to `contract-prisma7/test/defaults.test.ts`, for example `count Int @default([1, 2])`, asserting `Field "M.count": @default holds a list, which pg/int4 has no cast from; it casts from pg/int2.`

### G05. The contract-psl README still describes the old message

- Location: `packages/2-sql/2-authoring/contract-psl/README.md` line 61.
- Issue: it says `PSL_VALUE_TYPE_INCOMPATIBLE` names "the cast the column's type would need and the types it does cast from". After A15 the message ends with what to write. The doc-maintenance rule asks READMEs to follow behaviour.
- Suggestion: "`PSL_VALUE_TYPE_INCOMPATIBLE`, which names the missing cast and ends with what to write instead, as in `write a number`."

### G06. The printing path still carries the data types as two fields, and `dataTypes` there is a lookup

- Location: `packages/2-sql/9-family/src/core/psl-build/default-mapping.ts` lines 30-43 (`DefaultMappingOptions`), `packages/2-sql/9-family/src/core/control-target-descriptor.ts` lines 37-41 (`SqlPslBuildContext`), `packages/3-targets/3-targets/postgres/src/core/psl-print/column-defaults.ts` lines 59-61, `packages/2-sql/9-family/src/core/control-instance.ts` lines 1042-1046.
- Issue: A02 set out to end "`dataTypes` names two different objects". Everywhere the brief listed, `dataTypes` is now the `DataTypeSupport` pair. In `DefaultMappingOptions`, which this round edited for A11, `dataTypes` is a `DataTypeLookup` beside a separate `dataTypeEntries`, and `SqlPslBuildContext` has the same split. A reader moving between the reading and printing paths meets one name for two objects.
- Suggestion: out of the brief's list, so carry it over: add one sentence to the slice 2b "Carried over from the slice 2t review" list in `plan.md`, to make `DefaultMappingOptions.dataTypes` and `SqlPslBuildContext` take `DataTypeSupport` from `stack.dataTypes`.

### G07. The third default-only arm was decided without the findings file

- Location: `packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts` lines 45-58; `projects/sql-expression-literals/dispatches/` (no `2t-review-fixes-findings.md`).
- Issue: the brief's A08 said `ReadRefusal | CastRefusal` plus the two default-only arms, and "if a decision turns out to be wrong against the code, stop and write the reason" to the findings file. The implementer added `no-list-cast` and recorded it in `status.md` and design section 4 instead. The choice is right: `CastRefusal.valueType` is a `DataTypeId`, and a written list has none. Only the process differs.
- Suggestion: no code change. The operator ratifies the third arm; the status line under A08 already gives the reason.

## Deferred (out of scope)

- **`@default` does not offer the literal rewrite.** `v Json @default("{}")` ends ``write json`...` `` while `dataTypeValue` would say ``write it as json`{}` ``. The brief chose `describeAdmittedForms` for `@default`, so this is by decision.
- **`admittedTags` de-duplication.** Still untested; assembly refuses two entries with one tag, so it cannot trigger on an assembled stack.
- **The detection pattern `\bdataTypeLookup\s*:`** also matches `ControlStack` and `SqlPslBuildContext`, which keep that field. A reader of the matched file sees which interface it is; not worth a narrower pattern.
- **`InterpretPslDocumentToSqlContractInput` keeps `authoringContributions.dataTypes` beside `dataTypes.entries`.** Production passes both from one stack. A04 (slice 2b) rebuilds the spec contexts and is the place to drop the duplicate.

## Already addressed

| Round 1 item | Fixing commit | Matches the decision |
| --- | --- | --- |
| A01 | `d60177aeed` (design-notes decision 14, status note) | Yes |
| A02 | `e6c2815e36` | Yes for every listed site; the printing path keeps the split (G06) |
| A03 | `93d49f733e` | Yes; two construction sites, so `ContractSourceContext` carries `dataTypes`; ADR 249 updated |
| A04 | `d60177aeed` (plan.md slice 2b) | Yes, carried over |
| A05 | `4d7d7a6fa7` | Yes |
| A06 | `f70a219d11` | Yes, cites ADR 231 and ADR 254 |
| A07 | `d60177aeed` (plan.md slice 2b) | Yes, carried over |
| A08 | `87581a7e0a` | Yes, with a third arm `no-list-cast` (G07); Prisma 7 reads `receivingType` |
| A09 | `249c4d760d` | Yes |
| A10 | `d5117ef66b` | Yes; design section 5 updated |
| A11 | `a2c75c6ba7` | Yes; file is `default-sql-text.ts`; fragment table updated |
| A12 | `f70a219d11` | Yes; `a number` and `true or false` tested |
| A13 | `4d7d7a6fa7` | Yes; ADR 231 lists all six codes |
| A14 | `1360f60594` | Yes |
| A15 | `cbd529fb90`, `f70a219d11`, `87581a7e0a`, `47db2ee790` | Yes in code; gaps in G02, G03, G05 |
| F01 | `cbd529fb90`, `f70a219d11` | Yes |
| F02 | `cbd529fb90`, `f70a219d11` | Yes |
| F03 | `47db2ee790` | Yes |
| F04 | `5929d57073` | Yes |
| F05 | `87581a7e0a` | Yes |
| F06 | `f70a219d11`, `980f83e74b` | Yes |
| F07 | `f70a219d11` | Yes |
| F08 | `93d49f733e` | Yes |
| F09 | `30a4523acf` | Yes; design section 7 corrected |
| F10 | `47db2ee790`, `d60177aeed` | Yes |

## Acceptance-criteria verification

### Round 1 WEAK and NOT VERIFIED items

| Item | Verdict | What I read |
| --- | --- | --- |
| `castTypedValue` returns the cast value | PASS | `written-value.test.ts`: `big` casts `7` to `'7n'`; returning `typed.value` fails the test. |
| `admittedTags` order | PASS | `['geo', 'json']` for a type with its own tag casting from `json`; the `dataTypeValue` label test asserts ``geo`...` ``. De-duplication still untested (Deferred). |
| Each `found` word through `dataTypeValue` | PASS | New test builds a token-less `NumberLiteralExpr` and asserts ``Expected sql`...`, got an expression`` with the whole diagnostic. |
| Success returns the typed value | PASS | `pg/int4` casts from `pg/int2` with `String`, and the tests expect `'8'`, including through `funcCall` and `oneOf`. |
| Both default-only codes stay at the attribute | PASS | `PSL_INVALID_DEFAULT_LITERAL` vector test asserts the whole diagnostic with the `@default([1, 2])` span. |
| `oneOf` with dotted and colon-qualified callees | PASS | Two tests assert `Expected one of: nanoid() \| string` at the whole call; the colon test fails without the colon check. |
| `config-resolution` test sees where `dataTypes` comes from | PASS | Stub has one entry; `toBe(stubDataTypes)` in both tests. |
| Requirement 9, breaking changes documented for both audiences | WEAK | Extension fragment has the `oneOf` change and `createMongoBinder`; it still says messages are unchanged (G03). |
| Design section 6 step 4 returns `{ type, value, span }` | PASS | Same tests as "success returns the typed value". |
| `fixtures:check` shows no `contract.json` change | NOT VERIFIED | Not rerun; `wip/2t-review-fixes/fixtures-check.log` and the status report a clean tree. |
| `build`, `typecheck`, `lint`, `lint:deps`, `lint:casts`, `lint:throws`, `check:error-reference`, `lint:framework-vocabulary`, `test:packages` | NOT VERIFIED | Not rerun by instruction; logs in `wip/2t-review-fixes/` read: casts and throws delta 0, 361 codes, vocabulary 272 of 272, 84 of 84 turbo tasks. |
| Publish-shell tarball tests | NOT VERIFIED | Registry refusal locally; CI only. |

### Decisions in the fixes brief

| Decision | Verdict | What I read |
| --- | --- | --- |
| A01: record the signature mechanism, the tagless label and the wording rule | PASS | Design-notes decision 14; status note to "Data types own column types" (three bullets). |
| A02: one field name `dataTypes`; `DataTypeSupport` doc comment | PASS | Interpreter, column and field resolution, Prisma 7, `LspControlStack`; doc comment as briefed. G06 is outside the listed sites. |
| A03: `ControlStack.dataTypes`, context rule, ADR 249 | PASS | `control-stack.ts:89-90, 856`; two construction sites; ADR 249 example uses `interpretation.context.dataTypes`. |
| A04, A07: carried over to 2b | PASS | `plan.md` slice 2b list, one sentence each. |
| A05, A06, A13 | PASS | ADR 254 end-state paragraph; doc comment cites ADR 231 and 254; ADR 231 lists six codes. |
| A08: `DefaultRefusal` composes the framework refusals; Prisma 7 reads `receivingType` | PASS | `data-type-default.ts:45-58`; `defaults.ts:322-325`. Third arm in G07. |
| A09: `WrittenValue` doc sentence | PASS | `written-value.ts:12`. |
| A10: `readWrittenScalar`, `WrittenScalarResult`, design section 5 | PASS | `written-scalar.ts`, exports, design section 5. |
| A11: "text" renames, file rename, extension fragment | PASS | `default-sql-text.ts`, `validators.ts`, `default-mapping.ts`, `sql-default-literal.ts`, fragment table. |
| A12: tagless label is the admitted forms, tested for `pg/int4` and a boolean | PASS | `data-type-value.ts:35`; label tests. |
| A14: integration test on assembled stacks | PASS | Postgres and SQLite, `8`, `"8"`, `` sql`x` `` for the integer type and `sql/expression`, whole results; 24 pass. |
| A15: one wording in `describeRefusal`; `@default` prefix only; tests, docs, app fragment, QA | WEAK | Code, tests, `error-reference.md`, design 10.1 and 13, app fragment and QA cases 13 and 14 match. Gaps: G02 (list-cast element forms untested), G03 (extension fragment), G05 (README). |
| F01 to F10 as suggested; F09 required `dataTypes`; F10 sentence | PASS | See "Already addressed"; each new test fails when its behaviour is removed. |
| Round 1 deferred items: first four to 2b, fifth nowhere | PASS | `plan.md` slice 2b has four matching sentences plus the `no written form` note; the double read is not listed. |
| Merge: the merged date and time tests expect the code the code gives | PASS | Section 10.1 and the cast path above; `int-dt.log` 22 pass at HEAD. The 2a branch is G01. |

### Count

| Verdict | Count |
| --- | --- |
| PASS | 22 |
| WEAK | 2 |
| FAIL | 0 |
| NOT VERIFIED | 3 |
