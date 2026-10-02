# Slice 2t system design review, round 2

## Scope

- Slice 2t, Linear TML-3367, branch `tml-3367-data-type-value`.
- Range: `30a0d70ff4..68b7fa589e` (19 commits), the fixes for the round 1 findings. I read `git diff 30a0d70ff4 68b7fa589e -- . ':!projects'`, the project docs changed in the range, and the code at HEAD (`b9a099e97b`). I did not re-review round 1 changes that the fixes left alone.
- Read first: `dispatches/2t-review-fixes-brief.md` (the operator's decisions, not reopened here), the "Slice 2t review fixes" subsection of `status.md`, design sections 4, 5, 6, 7, 10.1 and 13, design-notes decision 14, and the round 1 `system-design-review.md`.

## Round 1 findings against their decisions

| Finding | Decision | Result | Commit |
| --- | --- | --- | --- |
| A01 | Record the signature-from-data-types mechanism, the label rule and the wording rule in decision 14 and the downstream note | Fixed as decided | `d60177aeed` |
| A02 | One field name, `dataTypes`, for the pair; new doc comment | Fixed as decided for every site the brief lists. The contract print path still splits the pair and uses `dataTypes` for a lookup alone (B01) | `e6c2815e36` |
| A03 | `ControlStack.dataTypes`; consumers with a stack use it; `ContractSourceContext.dataTypes` if three or fewer sites | Fixed. Two construction sites, so `ContractSourceContext` replaces `dataTypeLookup` with `dataTypes`, and the SQL, Mongo and Prisma 7 inputs take it. One consumer with a stack, the contract print path in `control-instance.ts`, still reads `stack.dataTypeLookup` (B01) | `93d49f733e` |
| A04 | Carry over to slice 2b | Done, in `plan.md` | `d60177aeed` |
| A05 | ADR 254 states the end state | Fixed, with one leftover sentence (B05) | `4d7d7a6fa7` |
| A06 | Cite ADR 231 and ADR 254 | Fixed as decided | `f70a219d11` |
| A07 | Carry over to slice 2b | Done, in `plan.md` | `d60177aeed` |
| A08 | `DefaultRefusal` composes the framework refusals; Prisma 7 reads `receivingType` | Fixed, with a third default-only arm, `no-list-cast` (judged below and in B02) | `87581a7e0a` |
| A09 | Keep the list arm; add the sentence | Fixed as decided | `249c4d760d` |
| A10 | `readWrittenScalar`, `WrittenScalarResult`; design section 5 | Fixed as decided. No old name is left in code, docs or the design | `d5117ef66b` |
| A11 | Rename to "text"; update the extension fragment | Fixed as decided. File is `default-sql-text.ts`; no `DefaultBody` name is left | `a2c75c6ba7` |
| A12 | Tagless label is `describeAdmittedForms` | Fixed as decided | `f70a219d11` |
| A13 | List all codes | Fixed as decided. ADR 231 lists all six and the label rule | `4d7d7a6fa7` |
| A14 | Integration test on assembled stacks | Fixed as decided. `test/integration/test/authoring/data-type-value.test.ts` builds Postgres and SQLite stacks and passes `stack.dataTypes` | `1360f60594` |
| A15 | One wording in `written-value.ts`; `@default` adds only its prefix | Fixed as decided. `describeRefusal` is the one wording for the four cast-rule refusals. `dataTypeValue` and `lowerDataTypeDefault` both call it. Error reference, design sections 10.1 and 13, the app fragment and manual QA cases 13 and 14 are updated | `cbd529fb90`, `f70a219d11`, `87581a7e0a`, `47db2ee790` |

### The `no-list-cast` arm

The shape is right. A list written on a scalar column whose type has no list cast has no value type, so it cannot be the framework's `no-cast`, whose `valueType` is a `DataTypeId`. Round 1 filled `valueType` with the string `'a list'`, which the framework type no longer allows. Folding it into `unwritable` would say "this target has no data type for a list value", which is false on a stack where `pg/vector` takes lists. ADR 254 puts reading a written list in the family's default reader, so a family arm next to `not-a-list` is the right home. It is worded in `lowerDataTypeDefault` in the same pattern as `describeRefusal`'s `no-cast`, which matches the other two default-only arms, and Prisma 7 words it in its own reason list.

The problem is its sibling: the refusal for an element that the list cast does not take still uses the framework's `no-cast`, with a different meaning. See B02.

## Other checks

- Dependency direction. `describeRefusal` sits in `framework-components/src/shared/written-value.ts` and imports nothing new. `@internal/config` now imports `DataTypeSupport` from `@internal/framework-components/authoring`; config already depended on framework-components. The status file records `lint:deps` and `lint:framework-vocabulary` passing. No framework file names a family or target.
- `ControlStack.dataTypes` is built once in `createControlStack` from the same two objects as `authoringContributions.dataTypes` and `dataTypeLookup`, and a test asserts identity. Nothing loses information: every consumer that built `{ entries, lookup }` by hand now receives the same objects. The SQL interpreter used to fall back to `{}` entries when `authoringContributions` was missing; it now requires the pair, which is stricter and correct.
- `RefusalDescription.code` is a union of three PSL codes in a framework file. PSL is framework vocabulary (psl-parser and `psl-ast` are framework packages), so this is in place.
- `readWrittenScalar` and `WrittenScalarResult` read cold now: the name says it returns the framework's `WrittenScalar`.
- The `dataTypeValue` label rule is consistent with other combinators: `a number`, `true or false`, or ``sql`...` ``.
- The upgrade fragments cover every rename and the message change. The app fragment's detection patterns (`; it casts from `, the lower-case `this target has no data type`, a quoted `Unknown literal tag`) find old assertions without matching the new text.
- The integration test sits in `test/integration`, which is the right layer for a test that assembles real packs.

## Findings

B01. The contract print path still splits the data types pair, and there `dataTypes` names a lookup.
- Location: packages/2-sql/9-family/src/core/control-target-descriptor.ts lines 37-41; packages/2-sql/9-family/src/core/control-instance.ts lines 1043-1046; packages/2-sql/9-family/src/core/psl-build/default-mapping.ts lines 30-36, 142, 198, 243 and 269-279; packages/3-targets/3-targets/postgres/src/core/psl-print/column-defaults.ts lines 59-62; packages/1-framework/1-core/framework-components/src/control/control-stack.ts lines 86-90.
- Issue: A02 made `dataTypes` mean the pair of entries and lookup, and A03 made every consumer with a stack take `stack.dataTypes`. The print path does neither. `SqlPslBuildContext` carries `dataTypeLookup` beside `authoringContributions.dataTypes`, `control-instance.ts` fills it from `stack.dataTypeLookup`, and `mapDefault`'s options take the same pair as `dataTypeEntries` and `dataTypes`, where `dataTypes` is only the lookup. `default-mapping.ts` was edited in this range for A11. So after the fix, `dataTypes` still names two different objects, one in the reader and one in the writer of the same defaults. `ControlStack` also keeps `dataTypeLookup` next to `dataTypes.lookup`; the print path is its only production reader.
- Suggestion: give `SqlPslBuildContext` a `dataTypes: DataTypeSupport` filled from `stack.dataTypes`, and have `mapDefault` take `dataTypes: DataTypeSupport`. Then remove `ControlStack.dataTypeLookup`, or keep it only if another reader needs the lookup alone. This is the same mechanical change as A02 and A03, so it fits this slice. If it does not, add it to the slice 2b "Carried over" list.

B02. An element that a list cast does not take is reported as the framework's `no-cast`, with fields that mean something else.
- Location: packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts lines 58-67, 230-245 and 280-284; packages/2-sql/2-authoring/contract-prisma7/src/defaults.ts lines 322-325.
- Issue: the framework's `CastRefusal` `no-cast` means "`receivingType` declares no cast from `valueType`; `casts` are the types it casts from". `readListIntoScalar` builds that arm by hand for a list element, with `receivingType` set to the column type (for example `pg/vector`) and `casts` set to the list cast's element types. Those are not casts `pg/vector` declares. Prisma 7 prints `casts` as "it casts from pg/int2, pg/int4, pg/int8, pg/numeric", which is false for `pg/vector`. Separately, `ReadDefaultResult` gains `receivingTypes`, which in this case holds the element types while `refusal.receivingType` holds the column type. One result then uses "receiving type" for two different things. The `no-list-cast` arm shows the right pattern for list-cast refusals; this one did not follow it.
- Suggestion: add a family arm beside `no-list-cast` for this case, for example `{ kind: 'no-element-cast', receivingType, valueType, elementTypes }`, worded in `lowerDataTypeDefault` and in Prisma 7. Rename `ReadDefaultResult.receivingTypes` to say what it is, for example `suggestedTypes`, which is what its doc comment already says.

B03. `describeRefusal`'s `forms` parameter is also used for a rewrite.
- Location: packages/1-framework/1-core/framework-components/src/shared/written-value.ts lines 54-58; packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/data-type-value.ts lines 76-81.
- Issue: the doc comment says `forms` is what to write instead, "as in `a number`". `dataTypeValue` passes ``it as sql`8` ``, a phrase that only reads right after the word "write" in the template. The public framework function's parameter name and doc do not describe one of its two uses, so a new caller has to read the template to know what to pass.
- Suggestion: name the parameter for its role, for example `instead`, and say in the doc comment that it completes "write …", as in `a number` or ``it as sql`now()` ``.

B04. The carried-over "wrong size number" item now also applies to `@default`, which ships in this slice.
- Location: projects/sql-expression-literals/plan.md line 128; docs/architecture docs/adrs/ADR 254 - Data types and casts.md lines 32 and 151; docs/reference/error-reference.md, `PSL_VALUE_TYPE_INCOMPATIBLE`.
- Issue: the carry-over says a number of the wrong size "for a number-typed `dataTypeValue`" reads `pg/int4 has no cast from pg/int8; write a number`, and should be worded "before a number-typed place ships". After the A15 fix, `@default(100000000000000099)` on an `Int` column gives exactly that message today (manual QA case 4). Before the fix it said `it casts from pg/int2`. ADR 254 uses this case as its first example and now says the message "says what to write instead". The decision on the wording stands; the record of its known gap is wrong about where it applies.
- Suggestion: change the carry-over to name `@default` as well as `dataTypeValue`, so slice 2b or the release notes treat it as shipped behaviour. If Will wants it worded before this slice merges, that is his call; the fix would sit in the caller's choice of `forms`, not in `describeRefusal`.

B05. ADR 254 still says in the present tense that function parameters are typed.
- Location: docs/architecture docs/adrs/ADR 254 - Data types and casts.md lines 179 and 181.
- Issue: A05's new paragraph (line 181) says typed function arguments arrive with the projects that first use them. The bullet two lines above (line 179) still says "a parameter names a data type" and that `nanoid`'s size parameter "is `pg/int4` on Postgres". The two sentences disagree. Line 181 also says "list casts are the family's"; the list cast is declared on the framework's `DataType` (`framework-components/src/shared/data-type.ts` line 51), and only reading a written list through it is the family's.
- Suggestion: in the "A call" bullet, say that a parameter will name a data type once default-function signatures are built from the stack (decision 14), or mark the `nanoid` sentence as the target. In line 181, say "a data type declares its list cast; reading a written list through it is the family's default reader's job".

## Decision 14 requirements

1. Takes any data type id. Met. Unchanged by the fixes.
2. Works as a parameter inside a function call signature. Met for signatures built where the stack's data types are in scope. The mechanism for the real case, `(dataTypes: DataTypeSupport) => FuncCallSig` resolved in `scalarDefaultArms`, is now recorded in decision 14 and in the downstream note. That is what A01's decision asked for.
3. Needs no target-specific code. Met, and now proven on assembled Postgres and SQLite stacks by the new integration test.
4. Reports general codes at the written value. Met, and `@default` and `dataTypeValue` now share one wording through `describeRefusal`.
5. Returns the canonical value with its type id. Met. The integration test asserts `{ type, value, span }` on real stacks.
6. Callable from PSL attribute specs and the Prisma 7 contract source. Met. The Prisma 7 source now receives the same `DataTypeSupport` through `ContractSourceContext.dataTypes`, so it can call `readWrittenScalar`, `readWrittenValue`, `castTypedValue` and `describeRefusal` without assembling anything.

## Summary

Five findings. Every round 1 decision is followed; A08's third arm is the right shape. The most important finding is B01: the contract print path still carries the data types as two fields, and there `dataTypes` means a lookup, so A02's "one name for the pair" and A03's "every consumer with a stack uses `stack.dataTypes`" are not yet true across the system.
