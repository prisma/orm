# Slice 2t code review (TML-3367)

Range: `16c6e91013..30a0d70ff4` (branch `tml-3367-data-type-value`). Reviewer lens: principal engineer. Code read at HEAD.

## Summary

The slice does what the design and the operator's decisions say. The cast rule for one written value now lives in `framework-components`, `readWrittenLiteral` and `dataTypeValue` exist in `psl-parser`, every attribute spec context carries the stack's data types, and `@default` reports its cast-rule refusals at the written value. The `oneOf` rule for a named function works for zero, one and two matching alternatives. I found no behaviour bug in the new code.

The findings are about proof, not behaviour. The most important one: no test anywhere in the new unit tests uses a cast that changes the value, so nothing proves that `castTypedValue` and `dataTypeValue` return the cast value rather than the value as read (F01). The next project reuses exactly that contract. The second: the extension upgrade fragment does not mention the `oneOf` change, which is a behaviour change in a public `psl-parser` combinator that extension packs use (F03).

Targeted runs, logs in `wip/2t-review/`: `written-value.test.ts` 27 pass; `written-literal.test.ts` and `attribute-spec-combinators.data-type-value.test.ts` 41 pass; four contract-psl default test files 95 pass; `check:upgrade-coverage --prev 16c6e91013` (the slice base, not the `main` merge base the implementer used) passes.

## What looks solid

- `readWrittenValue` covers every `WrittenScalar` kind and every refusal. A throwing `parse` or cast becomes `unreadable`; construction of a `dataTypeValue` never touches the lookup, so it cannot throw.
- `dataTypeValue.parse` follows design section 6 step by step: the unregistered-type `InternalError` comes first, then literal, read and cast, each with the design's code and message and the argument's span.
- `oneOf` routes a call only when the callee is a plain identifier and exactly one alternative is a `funcCall` of that name. Dotted and colon-qualified callees fall through, because `plainCallee` refuses them, and `funcCall` uses the same helper, so the two cannot disagree. The Mongo case where a model has a field named `wildcard` still works, because two `wildcard` alternatives fall back to trying in order (`interpreter.test.ts:1390`).
- Only two production files use `funcCall` (`sql-attribute-specs.ts`, `mongo-attribute-specs.ts`), and no built-in combinator other than `funcCall` accepts a call expression, so the new rule cannot hide a built-in alternative that would have accepted the call.
- The `@default` span change maps a refusal's `elementIndex` back to the AST element, and throws `InternalError` rather than guessing when the two disagree. Tests assert whole diagnostics with spans for the scalar value, the list element, a `sql` element and `PSL_DEFAULT_LIST_EXPECTED` at the attribute.
- The unknown-tag path through `readWrittenValue` removed a second wording of the same message. The list-element test proves the arm is live and reports at the element.
- Every construction site in rebase-delta Part B, plus the binder, passes real data types. The binder test checks identity (`received === dataTypes`) for model and field factories.
- Removed exports from `@internal/sql-contract-psl/resolution` had one importer, `contract-prisma7`, which now imports from the framework. No `.body` of a canonicalization, `parseJsonBody`, `readTaggedLiteral` or `dataTypeEntries` on `ControlDefaultRegistries` remains.
- No `any`, no bare `as`, no `@ts-` suppressions, no re-exports outside `exports/`, and no test name with "should" in the added lines.

## Findings

### F01. No test proves the returned value is the cast value

- Location: `packages/1-framework/1-core/framework-components/test/written-value.test.ts` lines 17-34 and 183-210; `packages/1-framework/2-authoring/psl-parser/test/attribute-spec-combinators.data-type-value.test.ts` lines 24-40 and 177-185.
- Issue: Every cast in both fixtures is `unchanged` or returns its input. So if `castTypedValue` returned `typed.value` instead of `cast(typed.value)`, or `parseDataTypeValue` returned `read.value.value` instead of `cast.value.value`, every test would still pass. The plan asks for "the returned `TypedValue`" and "success returns the typed value". The project "Data types own column types" depends on getting the canonical value of the receiving type.
- Suggestion: Give one cast in each fixture a visible effect and assert the result.

```ts
const big = dataType('t/big', { casts: { [small.id]: (value) => `${String(value)}n` } });
// castTypedValue(support, big.id, { type: small.id, value: 7 }) -> ok({ type: big.id, value: '7n' })
// dataTypeValue(pgInt4.id, support) given `8` -> ok({ type: 'pg/int4', value: <the cast's output>, span })
```

### F02. `admittedTags` order is not tested

- Location: `packages/1-framework/1-core/framework-components/test/written-value.test.ts` lines 212-230; `src/shared/written-value.ts` lines 149-160.
- Issue: No fixture gives a type more than one admitted tag, so the order (own tag first, then cast sources in key order) is never checked. The order matters: `dataTypeValue` uses `tags[0]` for its label and for the rewrite in the plain-string refusal. The de-duplication is also untested, but on an assembled stack it cannot trigger, because assembly refuses two entries with the same tag (`control-stack.ts:477-495`).
- Suggestion: Add a type with its own tag that casts from a tagged type, and assert the order and the label.

```ts
const geo = dataType('t/geo', { casts: { [json.id]: unchanged } }); // entry with tag 'geo'
expect(admittedTags(support, geo.id)).toEqual(['geo', 'json']);
expect(dataTypeValue(geo.id, support).label).toBe('geo`...`');
```

### F03. The extension fragment does not describe the `oneOf` change

- Location: `upgrade-instructions/pending/arguments-typed-by-data-type/extension/instructions.md`.
- Issue: `oneOf` is part of the public `psl-parser` spec kit that extension packs use. Its behaviour changed: a call to a function that exactly one `funcCall` alternative names now returns that alternative's result, success or failure. Before, the alternatives were tried in order and a failure became `Expected one of`. An extension spec with a custom alternative that accepts call expressions, placed beside a `funcCall` of the same name, now never reaches that alternative. Only the app fragment mentions the change, and only as a message change. The extension fragment also does not say that `createMongoBinder` now requires `dataTypes`.
- Suggestion: Add a change to the extension fragment, for example `one-of-routes-a-named-function-call`, with detection `\bfuncCall\s*\(` in `**/*.{ts,mts,cts}`. State the rule in one sentence, the new message for a wrong argument, and that an alternative that accepts calls is no longer tried when a `funcCall` names the callee. Add `createMongoBinder` to the `spec-contexts-carry-data-types` bullet list.

### F04. `defaultValueExpression` has a dead fallback

- Location: `packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts` lines 562-568.
- Issue: The function falls back to a named argument `value:`. The `@default` spec declares `value` only as a positional parameter, and the argument binder looks up named arguments only in `spec.named` (`psl-parser/src/attribute-spec/interpret.ts:69-83`). So `@default(value: 1)` is refused as an unknown argument before this code runs, and the fallback can never match.
- Suggestion: Keep only the positional lookup.

```ts
function defaultValueExpression(node: FieldAttributeAst): ExpressionAst | undefined {
  return [...(node.argList()?.args() ?? [])].find((arg) => arg.colon() === undefined)?.value();
}
```

### F05. No test pins `PSL_INVALID_DEFAULT_LITERAL` to the attribute

- Location: `packages/2-sql/2-authoring/contract-psl/test/interpreter.defaults.data-types.test.ts` lines 254-261.
- Issue: The status and the upgrade fragments say both default-only codes stay at the `@default` attribute. Only `PSL_DEFAULT_LIST_EXPECTED` has a span assertion. The vector test for `PSL_INVALID_DEFAULT_LITERAL` uses `expect.objectContaining` without a span, so moving that refusal to the written value would pass every test.
- Suggestion: Assert the whole diagnostic, including the span of the `@default(...)` attribute, in that test.

### F06. The `oneOf` rule has no test for qualified callees or for Mongo index fields

- Location: `packages/1-framework/2-authoring/psl-parser/test/attribute-spec-combinators.data-type-value.test.ts` lines 373-445; `packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/func-call.ts` lines 36-45.
- Issue: The rule is tested for zero, one and two matching alternatives. It is not tested with `foo.nanoid("8")` or `a:nanoid("8")`, which must still give `Expected one of`. The colon check in `plainCallee` has no test anywhere; the `funcCall` suite tests only a dotted callee. The app fragment also promises the new diagnostics for MongoDB `@@index` field functions, and no Mongo test covers that.
- Suggestion: Add two cases to the `oneOf` describe block (dotted and colon-qualified callee, each asserting `Expected one of: nanoid() | string` at the whole call). Add one Mongo interpreter case, `@@index([email(sort: Up)])`, asserting the whole diagnostic.

### F07. The `found` word "an expression" is not tested through `dataTypeValue`

- Location: `packages/1-framework/2-authoring/psl-parser/test/attribute-spec-combinators.data-type-value.test.ts` lines 187-196.
- Issue: The plan asks for every section 6 diagnostic "including each `found` word". Four of the five words are tested. `an expression` is tested only in `written-literal.test.ts`.
- Suggestion: Reuse the token-less `NumberLiteralExprAst` from `written-literal.test.ts:77-84` and assert ``Expected sql`...`, got an expression`` with code `PSL_INVALID_ATTRIBUTE_SYNTAX`.

### F08. The config-resolution test cannot see where `dataTypes` comes from

- Location: `packages/1-framework/3-tooling/language-server/test/config-resolution.test.ts` lines 77-88, 211-215 and 258-262.
- Issue: The stub stack has empty entries and an empty lookup, and the assertion uses `toEqual`. If `lspControlStackFromStack` set `dataTypes` to `EMPTY_DATA_TYPES` or to a fresh empty lookup, the test would still pass.
- Suggestion: Give the stub stack one entry and assert identity: `expect(result.controlStack.dataTypes?.entries).toBe(stack.authoringContributions.dataTypes)` and `expect(result.controlStack.dataTypes?.lookup).toBe(stack.dataTypeLookup)`.

### F09. `createSqlBinder` silently falls back to no data types

- Location: `packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts` lines 154 and 188.
- Issue: `createBinder` requires `dataTypes`, but `createSqlBinder` makes it optional and defaults to `EMPTY_DATA_TYPES`. This matches design section 7. The failure mode: a new production caller that forgets the option gets a binder whose `@default` spec has no tag arms, so `` @default(sql`now()`) `` is refused with `Expected one of`. Nothing fails at compile time. Today the only production caller, the SQL interpreter, passes the stack's data types, and the only other callers are three test sites.
- Suggestion: Make `dataTypes` required on `createSqlBinder` and pass `fixtureDataTypeSupport` (or `EMPTY_DATA_TYPES`) in the three tests (`semantic-diagnostics.test.ts:36`, `provider.interpret.test.ts:197`, `sql-attribute-specs.test.ts:93, 118`). Correct the design section 7 sentence to match.

### F10. Canonicalization now runs before the tag check, and no document says so

- Location: `packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts` lines 651-667; `packages/1-framework/2-authoring/psl-parser/src/written-literal.ts` lines 55-61.
- Issue: Before finding 1, `@default` checked the tag and then canonicalized. Now it canonicalizes first. So `` @default(pg.sql`a<NUL>b`) `` reports `PSL_TAGGED_LITERAL_NUL` where it used to report `PSL_UNKNOWN_LITERAL_TAG`. The new order is consistent with `dataTypeValue`, and it is only visible when a literal has both problems. But `2t-findings.md` and `status.md` say messages and spans are unchanged, which is not exactly true.
- Suggestion: Keep the order. Add one sentence to the app fragment's first section and to the finding 1 outcome: when a tagged literal has both an unknown tag and a NUL character or too much text, the canonicalization code is reported.

## Deferred (out of scope)

- **The rewrite hint for a number of the wrong size.** `dataTypeValue('pg/int4')` given `3000000000` reports `pg/int4 has no cast from pg/int8; write a number`. The author did write a number. The text is fixed by design section 6, and no place uses a number-typed `dataTypeValue` until the project "Data types own column types" types `nanoid`'s length. That project should word this case, for example by naming the cast sources as `@default` does (`it casts from pg/int2`).
- **The `dataTypeValue` doc comment.** It cites ADR 256, which slice 2b writes, and says "Used as a parameter of a `funcCall`", which slice 2b contradicts when `@@index(where:)` takes it as a named attribute argument. Slice 2b should update the comment when it adds the first attribute place.
- **A plain string whose text is not canonical.** For `where: "  x"` the rewrite would be `` sql`  x` ``, which reads back as `x`. Design section 11.2's `sqlTextReadsBack` belongs to slice 2b, which is also the first slice where a user can see this message.
- **A test that the Mongo provider forwards the stack's data types.** `mongoContract` passes `context.authoringContributions.dataTypes` and `context.dataTypeLookup` (read in `provider.ts:38-41`), but no test proves it. Mongo registers no data types today, so nothing observable depends on it. Slice 2b's "block spec context from each production path" test (design 9.1) is the natural place.
- **`@default` reads a tagged scalar twice.** `psl-column-resolution.ts:718` calls `readWrittenValue`, and `lowerDataTypeDefault` reads the same value again. Design section 10 prescribes this so a refusal is reported once. The cost is one extra `JSON.parse` per `json` default; not worth a change here.

## Acceptance-criteria verification

### Plan "Slice 2t" tests

| Item | Verdict | What I read |
| --- | --- | --- |
| `written-value.test.ts`: `readWrittenValue` for each written kind and refusal | PASS | Lines 123-181: tag, string, boolean, number (two types), unknown tag with known list, unwritable for all three syntaxes, unclassifiable number, throwing parse. |
| `castTypedValue`: same type, cast, no cast, throwing cast | PASS | Lines 183-210, whole-result `toEqual`, including `receivingType` and `casts`. |
| `castTypedValue`: the returned `TypedValue` | WEAK | Every cast is an identity; see F01. |
| `admittedTags` for `sql/expression`, boolean, number, a type casting from a tag type | PASS | Lines 212-230. |
| `admittedTags` order and no duplicates (design 4) | WEAK | No fixture has two tags; see F02. |
| `describeAdmittedForms` for the same four kinds, "no written form" | PASS | Lines 232-257, including the number phrase once for `small` and `big`, and `a quoted string or json`...`` in key order. |
| `written-literal.test.ts`: every row of design section 5 | PASS | Three quote styles, number text, missing number token, both booleans, tag with canonical text, NUL, too large, identifier, call, list, object. |
| `data-type-value` test: label and metadata | PASS | Lines 133-165, tagged and untagged type. |
| Every section 6 diagnostic with exact code, message and span | PASS | `refusal()` helper builds the full diagnostic with the argument's range; see the design section 6 table below. |
| Each `found` word | WEAK | Four of five; see F07. |
| Success returns the typed value | WEAK | Shape and span asserted; cast value not distinguishable; see F01. |
| Construction does not throw for an unregistered type; `parse` throws `InternalError` | PASS | Lines 297-312: metadata asserted, then `toThrow` with the exact message and with the class. |
| `dataTypeValue` for `pg/int4`, a type without a tag | PASS | Lines 150-165, 177-185, 279-288. |
| As a parameter of a `funcCall` that is an arm of `oneOf` | PASS | Lines 314-370 and 373-445: typed value in `args`, refusal at `"8"` through `oneOf`. |
| Existing `@default` tests pass | PASS | Four contract-psl default files, 95 tests, `wip/2t-review/cp.log`; changed assertions only tighten spans or follow the carried-over items. |

### Carried over from the slice 2a review, and the two findings decisions

| Item | Verdict | What I read |
| --- | --- | --- |
| ADR 254 sentence on the scalar cast rule | PASS | ADR 254 line 155. |
| `TaggedLiteralCanonicalization.body` renamed `text` | PASS | `tagged-literal.ts`, all callers, `TaggedLiteralExprAst.text()`, `parseJsonText`/`printJsonText`; grep finds no old name in `packages/`, `docs/`. |
| `@default` cast-rule refusals at the written value; ADR 254 and `error-reference.md` updated | PASS | `data-type-default.ts` `place`, `psl-column-resolution.ts:617-630`; tests in `interpreter.defaults.tagged-literal.test.ts` assert spans for scalar, element, `sql` element, `json` parse error; error reference lines 802 and 806. |
| The two default-only codes stay at the attribute | WEAK | `PSL_DEFAULT_LIST_EXPECTED` span asserted; `PSL_INVALID_DEFAULT_LITERAL` not; see F05. |
| The `unknown-tag` arm is the one place that words the refusal (decision 1, option A) | PASS | `readTaggedLiteral` deleted; scalar and list-element tests at lines 163-175 of the tagged-literal test. |
| No name about lowering a tag survives | PASS | Grep for `lowerTaggedLiteral`/`readTaggedLiteral` finds nothing. |
| `sql` removed from the `@default` list-element tags | PASS | `sql-attribute-specs.ts:299-306`; test "offers every tag but sql as a list element" asserts the tags and the label; the `Expected one of` message test was updated. |
| `oneOf` rule: zero, one and two matching alternatives (decision 2) | PASS | Lines 386-444 of the data-type-value test; `interpreter.defaults.functions.test.ts` asserts the three whole diagnostics. |
| `oneOf` rule: dotted and colon-qualified callee | WEAK | Correct by reading `plainCallee`; no test; see F06. |
| Decision 2 docs: ADR 231, design section 6, app fragment, QA script and run | PASS | All four read; QA run on `c294bfd4f1` lists cases 9-12 with the expected columns. |

### Design section 6 diagnostics

| Step | Verdict | Test |
| --- | --- | --- |
| 0: `InternalError` for an unregistered type | PASS | Lines 297-312. |
| 1: `not-a-literal`, `PSL_INVALID_ATTRIBUTE_SYNTAX`, ``Expected ${F}, got ${found}`` | PASS | Lines 187-196 (see F07 for the fifth word). |
| 1: `nul`, `PSL_TAGGED_LITERAL_NUL` | PASS | Lines 198-203. |
| 1: `too-large`, `PSL_TAGGED_LITERAL_TOO_LARGE` | PASS | Lines 205-210. |
| 2: `unknown-tag`, `PSL_UNKNOWN_LITERAL_TAG` | PASS | Lines 212-221. |
| 2: `unwritable`, `PSL_VALUE_TYPE_INCOMPATIBLE`, ends `write ${F}` | PASS | Lines 223-236. |
| 2: `unreadable`, `PSL_INVALID_LITERAL` | PASS | Lines 238-242. |
| 3: `no-cast` from a string with a tag, ends with the exact rewrite | PASS | Lines 244-264, including the double-quote form for a backtick. |
| 3: other `no-cast` | PASS | Lines 266-288: number, boolean, and a string for an untagged type. |
| 3: cast `unreadable`, `PSL_INVALID_LITERAL` | PASS | Lines 290-295. |
| 4: return `{ type, value, span }` | WEAK | See F01. |

### Design section 7 construction sites

| Site | Verdict | What I read |
| --- | --- | --- |
| SQL interpreter, column and field resolution, contributed model specs | PASS | `interpreter.ts:2062-2075` and `1081-1086`, `psl-column-resolution.ts:596-604`, `psl-field-resolution.ts:70-77`; the tagged-literal tests would fail with empty data types. |
| Binder (`createBinder`, `createSqlBinder`, `createMongoBinder`) | PASS | `binder.ts:249`; identity test `binder.test.ts:1273-1305`. See F09 for the optional SQL option. |
| Mongo provider and `specContextFor` | PASS | `provider.ts:38-41`, `interpreter.ts:1187, 1215`; no test, see Deferred. |
| Language server (`LspControlStack`, `AttributeSpecSource`) | PASS | `config-resolution.ts:89`, `attribute-spec-resolution.ts:75, 92`; completion tests at `completion-provider.test.ts:1378-1440` pass `dataTypes` through the source and assert `sql` and `json`. |
| `config-resolution` test of the stack mapping | WEAK | See F08. |
| `EMPTY_DATA_TYPES` in production | PASS | Only the language-server fallback (as designed) and the `createSqlBinder` default (F09). Every other use is in tests. |
| `ControlDefaultRegistries` loses `dataTypeEntries`, doc updated | PASS | `mutation-default-types.ts:89-90`. |

### Spec cross-cutting requirements and done conditions the slice claims

| Item | Verdict | What I read |
| --- | --- | --- |
| Requirement 2, admission by type, for the building block: same codes as `@default`, plain-string refusal ends with the exact rewrite | PASS | `data-type-value.ts` against `data-type-default.ts` codes; tests above. |
| Requirement 9, breaking changes documented for both audiences | WEAK | Both fragments exist and match the code; the extension fragment misses the `oneOf` change; see F03. |
| Upgrade fragment detection patterns and text | PASS | Patterns read against the renamed and removed symbols; `wip/2t/detection.log` records true and false positives. |
| `check:upgrade-coverage` | PASS | Rerun against the slice base `16c6e91013`, `wip/2t-review/upgrade-coverage-slice-base.log`. |
| Manual QA script and run | PASS | `manual-qa.md` slice 2t, 12 cases, run on `c294bfd4f1`. |
| `fixtures:check` shows no `contract.json` change | NOT VERIFIED | Not rerun; implementer log `wip/2t-fixes/fixtures-check.log` and a clean working tree. |
| `build`, `typecheck`, `lint`, `lint:deps`, `lint:casts`, `lint:throws`, `check:error-reference`, `lint:framework-vocabulary`, `test:packages` | NOT VERIFIED | Not rerun by instruction; implementer logs in `wip/2t-fixes/` report pass. |
| Publish-shell tarball tests | NOT VERIFIED | They fail locally on the `@vercel/detect-agent@1.2.5` registry refusal and can only run in CI. |

### Count

| Verdict | Count |
| --- | --- |
| PASS | 39 |
| WEAK | 9 |
| FAIL | 0 |
| NOT VERIFIED | 3 |
