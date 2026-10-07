# Slice 2t system design review

## Scope

- Slice 2t, Linear TML-3367, branch `tml-3367-data-type-value`.
- Range: `16c6e91013..30a0d70ff4` (15 commits). I read the diff without `projects/`, and the code at HEAD.
- Design sources read: `spec.md`; `design.md` sections 1, 4 to 7, 18.3 and 19; `design-notes.md` decision 14; the implementer brief, the findings file and the findings-fixes brief; the "Slice 2t" section of `status.md`.
- The operator's decisions are settled and are not reopened here: finding 1 option A (the framework reader reports an unknown tag) and finding 2 (the `oneOf` rule for a named function).

## What the slice does

The slice builds an attribute argument typed by a data type. A spec can now say "this position receives a value of `T`", and the ADR 254 cast rule decides what the author may write there. The six raw SQL places (slice 2b) and default-function arguments (project "Data types own column types") will use it.

To do that, the slice:

- moves the cast rule for one written value from the SQL family into the framework (`framework-components/src/shared/written-value.ts`);
- adds `readWrittenLiteral` to psl-parser, which reads one PSL expression as a written scalar;
- adds the `dataTypeValue` combinator, with `ParsedTypedValue` and `DataTypeValueArgType`;
- puts the stack's data types on every attribute spec context (`AttributeSpecContext.dataTypes`) and on the binder, and takes them off `ControlDefaultRegistries`;
- adds a rule to `oneOf`: a call to a function that exactly one `funcCall` alternative names gets that alternative's result;
- renames the canonical value of a tagged literal from "body" to "text";
- makes `@default` report the cast-rule codes at the written value, and lets the framework reader report an unknown tag.

Invariants the slice adds:

- The framework holds the scalar cast rule. The SQL family holds only list reading and the two default-only refusals.
- Every attribute spec context carries the stack's data types. A stack with none passes `EMPTY_DATA_TYPES`, never `undefined`.
- Building a `dataTypeValue` never throws. Parsing with it throws an internal error when the stack does not register the type.
- In `@default`, one place words an unknown tag: the `unknown-tag` arm of `lowerDataTypeDefault`.

## Subsystem fit and boundaries

Dependency direction is right. `written-value.ts` imports only `@internal/contract/types`, `@internal/utils` and its own package. psl-parser imports the framework. contract-psl, the Mongo PSL interpreter, contract-prisma7 and the language server import psl-parser and the framework. No framework file names a family or a target. The status file records that `lint:deps` and `lint:framework-vocabulary` pass.

The split between framework and family is correct in concept. The framework owns "read one written value into a typed value" and "cast one typed value". The family keeps list handling and codec validation, which are about defaults and columns. ADR 254 states this split.

Three boundary problems remain:

- The function registry cannot use `dataTypeValue` yet (A01). `dataTypeValue` needs the stack's data types when it is built. Default-function signatures are static values that an adapter builds before the stack is assembled. So the main downstream use, `nanoid(8)`, does not fit the shape as built.
- `@default` keeps a second path from PSL syntax to a written scalar (A07). That path walks the syntax tree again to find spans, beside the spec that already parsed the argument.
- The same pair `{ entries, lookup }` is assembled by hand in four production places (A03). The control stack assembles both halves but never exposes the pair.

The `oneOf` rule lives in the right place, and `plainCallee` is a good shared helper. The rule checks `alt.kind === 'funcCall'` on direct alternatives only. That is acceptable for today's specs, and ADR 231 states the rule.

## Naming and typology

- **One object, three names; one name, two objects** (A02). The type is `DataTypeSupport`. Fields that hold it are `dataTypes` (spec context, binder, Mongo input, language server), `dataTypeSupport` (SQL interpreter, column and field resolution, Prisma 7 defaults) and `support` (framework functions, `readDataTypeDefault`). `authoringContributions.dataTypes`, which sits on the same `LspControlStack` object, holds only the entries. So `stack.dataTypes.entries` and `stack.authoringContributions.dataTypes` are the same record under two paths.
- **`ControlDefaultRegistries` holds one registry** (A04). After the slice it is `Pick<ControlMutationDefaults, 'defaultFunctionRegistry'>`. The plural name no longer says what it is, and the field on the spec context is called `controlMutationDefaults`, a third name. ADR 249's new example shows the cost: `controlMutationDefaults: { defaultFunctionRegistry: input.defaultFunctionRegistry }`.
- **Written literal, written value, written scalar.** `readWrittenLiteral` returns a `WrittenScalar` inside a `WrittenLiteralResult`. "Literal" is the PSL syntax word and "scalar" is the framework word for the same thing (A10).
- **`WrittenValue` has a list arm that no framework code handles** (A09). The framework says list casts belong to the family, but the framework type still defines the list shape.
- **The "text" rename stops short** (A11). `checkSqlDefaultBody`, `reservedSqlDefaultBody` and `UNSAFE_DEFAULT_BODY` take the canonical text. `9-family/src/core/psl-build/default-mapping.ts` passes canonical text as `body`. Under ADR 129's new vocabulary the body is what is written between the quotes, so these names now say the wrong thing.
- **`DefaultRefusal` restates the framework refusals** (A08). It copies the `unreadable`, `unknown-tag` and `unwritable` arms and renames `receivingType` to `columnType`, only so one line in contract-prisma7 stays unchanged.
- **The label of a tagless `dataTypeValue` is a type id** (A12). `pg/int4` then appears in `Expected one of: …` and in signature help, where every other combinator says `number` or `string`.
- Good names: `readWrittenValue`, `castTypedValue`, `TypedValue`, `ReadRefusal`, `CastRefusal`, `admittedTags`, `describeAdmittedForms` and `ParsedTypedValue` each say what the thing is. They read cold.

## ADR review

- **ADR 231, "Values of a data type".** The reasoning is clear and it names the construction and parse behaviour. It lists three codes but not `PSL_INVALID_ATTRIBUTE_SYNTAX` (not a literal) or the two `PSL_TAGGED_LITERAL_*` codes (A13). The `oneOf` exception is stated precisely, with its reason.
- **ADR 231, "Alternatives".** The new sentence "`@default` still checks literal-to-type compatibility in lowering, because its receiving type comes from the column" is the right carve-out.
- **ADR 254.** It says that value positions "in attributes and in function signatures" are typed through `dataTypeValue`, and that one binder "drives the editor" for them. After this slice, `@default` is not typed that way (ADR 231 says so), no function signature uses the combinator, and completion returns nothing for it. The sentence "Only the scalar cast rule moves to the framework" describes a change, not the end state (A05).
- **ADR 249.** The context gains `dataTypes`. The new examples show two things: the hand assembly of `{ entries, lookup }` (A03) and the wrapped `controlMutationDefaults` (A04).
- **The `dataTypeValue` doc comment cites ADR 256** (A06). That ADR does not exist until slice 2b. The ADR folder already holds three files numbered 255, so a number reserved in a comment can collide.

## Decision 14: the six requirements

1. **Takes any data type id.** Met. `dataTypeValue(dataType: DataTypeId, support)` has no per-type code.
2. **Works as a parameter inside a function call signature.** Met for a signature built where the stack's data types are in scope, and tested that way, including through `oneOf`. Not met for the real case: default-function signatures are static values built by the adapter before assembly, so they cannot hold a `dataTypeValue` built from the stack (A01).
3. **Needs no target-specific code.** Met. The framework and psl-parser code name no family or target. The unit tests use hand-built `pg/*` types. No test runs the combinator on an assembled Postgres or SQLite stack (A14).
4. **Reports general codes at the written value.** Met by `dataTypeValue`, and now by `@default` too. The two word the same refusals differently (A15).
5. **Returns the canonical value with its type id.** Met. `ParsedTypedValue` is `{ type, value, span }`, and `type` is the receiving type.
6. **Callable from PSL attribute specs and the Prisma 7 contract source.** Met for attribute specs. The Prisma 7 source does not use attribute specs or build an `AttributeCtx`, so it cannot call the combinator. It can call `readWrittenLiteral`, `readWrittenValue` and `castTypedValue`, which are the parts it needs, and it words its own diagnostics by design. I count this as met, with the caveat that the codes and messages would then be chosen in a third place (A15).

## Test strategy

- The framework tests use invented `t/*` types, which is right for a framework package and keeps the layering clean.
- The psl-parser tests cover every diagnostic of design section 6, construction on a stack without the type, and the `oneOf` rule in both directions.
- The gap is at the level of the whole system. Nothing runs `dataTypeValue` on a stack assembled from real packs. The downstream project will rely on exactly that: the Postgres number classifier deciding `8` is `pg/int2`, a real cast from `pg/int2` to `pg/int4`, and the SQL family's `sql/expression` entry together with the target's `json`. A test in `test/integration/test/authoring` would prove requirements 2 and 3 on Postgres and SQLite (A14).
- The contract-psl `@default` tests now assert the whole diagnostic, including the span of a list element. That is the right level.

## Findings

A01. Default-function signatures cannot hold a `dataTypeValue`.
- Location: packages/1-framework/1-core/framework-components/src/shared/mutation-default-types.ts lines 70-79; packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts lines 107-136; packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts lines 309-317.
- Issue: `dataTypeValue(dataType, support)` needs the assembled stack's data types when it is built. `ControlMutationDefaultEntry.signature` is a static `FuncCallSig` that the adapter builds at module load, before any stack exists. The main use named in decision 14, the `8` in `nanoid(8)`, therefore cannot be written with the shape as built. An adapter could build its own `DataTypeSupport` from its own entries, but that would disagree with the stack: packs' tags would be missing from "Known tags", and the family's `sql/expression` entry would be absent. Neither note sent to the downstream project mentions this.
- Suggestion: decide the mechanism now, because it decides the shape of this slice's public surface. The smaller change is to let a registry entry's signature be built from the data types, for example `signature: (dataTypes: DataTypeSupport) => FuncCallSig`, resolved in `scalarDefaultArms`, which already has `ctx.dataTypes`. The other option is for `dataTypeValue` to read the data types from the parse context instead of taking them when it is built. Record the choice in design-notes decision 14 and send it to the downstream project's agent.

A02. The data types of a stack have three field names, and `dataTypes` names two different objects.
- Location: packages/1-framework/1-core/framework-components/src/shared/written-value.ts lines 22-26; packages/1-framework/3-tooling/language-server/src/lsp-control-stack.ts lines 10-16; packages/2-sql/2-authoring/contract-psl/src/interpreter.ts lines 583 and 2062-2066; packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts line 586; packages/2-sql/2-authoring/contract-psl/src/psl-field-resolution.ts lines 63 and 166; packages/2-sql/2-authoring/contract-prisma7/src/defaults.ts line 47.
- Issue: the same `DataTypeSupport` object is `dataTypes`, `dataTypeSupport` or `support` depending on the file. `authoringContributions.dataTypes` is only the entries record, and `LspControlStack` carries both, so `dataTypes` means the entries in one place and the entries plus lookup in another. The type name "support" and its doc comment ("the PSL support for them") do not say what the object is: a stack's registered data types with their authoring entries.
- Suggestion: use one field name for the pair everywhere, for example `dataTypes`, and rename the SQL interpreter, resolution and Prisma 7 fields to match. Consider a type name that says what it holds, and fix the doc comment, since the Prisma 7 source uses it too.

A03. Four production sites assemble `{ entries, lookup }` by hand.
- Location: packages/1-framework/3-tooling/language-server/src/config-resolution.ts line 89; packages/2-mongo-family/2-authoring/contract-psl/src/provider.ts lines 39-42; packages/2-sql/2-authoring/contract-psl/src/interpreter.ts lines 2062-2065; packages/2-sql/2-authoring/contract-prisma7/src/interpreter.ts lines 1127-1130; the ADR 249 example at lines 50-53.
- Issue: the control stack assembles both halves (`assembleDataTypes`, `assembleAuthoringDataTypes`) but never exposes the pair. Each consumer rebuilds it, and one of them (Prisma 7, SQL) falls back to `{}` for the entries while using the real lookup.
- Suggestion: have the control stack, and the interpretation context built from it, expose the pair once. Consumers then pass it through.

A04. `ControlDefaultRegistries` now holds one registry, under a third name.
- Location: packages/1-framework/1-core/framework-components/src/shared/mutation-default-types.ts lines 89-90; packages/1-framework/2-authoring/psl-parser/src/attribute-spec/spec-context.ts lines 8-13; docs/architecture docs/adrs/ADR 249 - Central attribute-spec registry.md lines 36-37.
- Issue: the plural type holds only `defaultFunctionRegistry`, and the context field that carries it is `controlMutationDefaults`. Every construction site now writes `controlMutationDefaults: { defaultFunctionRegistry: … }`. A newcomer reads three names for one registry.
- Suggestion: put `defaultFunctionRegistry: ControlMutationDefaultRegistry` directly on `AttributeSpecContext` and delete `ControlDefaultRegistries`. If that is too wide for this slice, record it in the project's deferred list and do it in slice 2b, which touches every spec context again.

A05. ADR 254 claims more than the code does and narrates a change.
- Location: docs/architecture docs/adrs/ADR 254 - Data types and casts.md line 155.
- Issue: the paragraph says value positions in attributes and function signatures are typed through `dataTypeValue`, and that one binder drives the editor for them. After this slice, `@default` casts in lowering (ADR 231 says so), no function signature uses the combinator (A01), and completion returns nothing for it. "Only the scalar cast rule moves to the framework" describes a move, not the decision.
- Suggestion: state the end state: positions with a fixed receiving type use `dataTypeValue`; `@default` casts in lowering because its type comes from the column; the framework holds the scalar cast rule and the family holds list casts. Say that function-argument typing and completion arrive with their projects, or leave those claims out until they land.

A06. The `dataTypeValue` doc comment cites ADR 256, which does not exist.
- Location: packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/data-type-value.ts line 25.
- Issue: ADR 256 is written in slice 2b. If slice 2t merges first, the link is dangling. The ADR folder already has three files numbered 255, so a number used before its file exists can collide with another project's ADR.
- Suggestion: cite ADR 231 and ADR 254 now. Slice 2b adds ADR 256 when the file exists.

A07. `@default` has its own path from PSL syntax to a written scalar, and walks the syntax tree again to find spans.
- Location: packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts lines 562-573, 617-630 and 651-667.
- Issue: `readWrittenLiteral` is the framework-side reader from an expression to a `WrittenScalar`. `@default` does not use it: `writtenScalar` converts the spec's parsed values (`string`, `NumLiteral`, `boolean`, `ParsedTaggedLiteral`) instead. Because those values carry no span, `defaultValueExpression` and `listElements` find the argument again by walking the attribute's syntax: first positional argument, else the named `value`. That is a second copy of the `@default` argument shape, outside the spec. If the spec changes, the refusal can point at the wrong node.
- Suggestion: let the `@default` literal arms yield a written scalar with its span, for example a small combinator built on `readWrittenLiteral`. `lowerDataTypeDefault` then reports at the span it was given. This removes `writtenScalar`, `defaultValueExpression` and `listElements`. It can go in slice 2b, which rebuilds the attribute places; record it if so.

A08. `DefaultRefusal` copies the framework refusals instead of composing them.
- Location: packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts lines 42-57 and 97-119.
- Issue: three arms repeat `ReadRefusal` (with `syntax` widened to `string`). The `no-cast` arm renames `receivingType` to `columnType`, and `castInto` exists mostly to do that rename. The reason is to keep one line of contract-prisma7 unchanged.
- Suggestion: define `DefaultRefusal` as the framework's `ReadRefusal | CastRefusal` plus the two default-only arms, with `elementIndex` added, and update the one Prisma 7 read to `receivingType`.

A09. The framework's `WrittenValue` defines a list arm that no framework code handles.
- Location: packages/1-framework/1-core/framework-components/src/shared/written-value.ts lines 12-20.
- Issue: ADR 254 now says list casts stay in the family's default reader. The framework still owns the list shape, and every framework function takes `WrittenScalar`. Only contract-psl and contract-prisma7 use the list arm.
- Suggestion: export only the scalar shape from the framework, and define the list form in contract-psl next to the list reader. contract-prisma7 already imports `readDataTypeDefault` from `@internal/sql-contract-psl/resolution` and can take the list type from there. If the operator prefers the design's placement, add one sentence to the type's doc comment saying the framework defines the list shape but does not read it.

A10. `readWrittenLiteral` returns a `WrittenScalar` under a different name.
- Location: packages/1-framework/2-authoring/psl-parser/src/written-literal.ts lines 14-40.
- Issue: "written literal" and "written scalar" name the same result. A reader has to check that `WrittenLiteralResult.written` is a `WrittenScalar` to learn they are one thing.
- Suggestion: name it `readWrittenScalar` and `WrittenScalarResult`, or say in the doc comment that it reads a PSL literal as a `WrittenScalar`.

A11. The rename from "body" to "text" is incomplete.
- Location: packages/2-sql/1-core/contract/src/default-sql-body.ts lines 1-20; packages/2-sql/2-authoring/contract-ts/src/sql-default-literal.ts lines 34 and 42; packages/2-sql/9-family/src/core/psl-build/default-mapping.ts lines 160-181.
- Issue: under ADR 129's vocabulary, the body is what is written between the quotes and the text is the canonical value. `checkSqlDefaultBody(body)`, `reservedSqlDefaultBody(body)` and `UNSAFE_DEFAULT_BODY` receive canonical text, and `default-mapping.ts` passes canonical text as `body`. `canonicalizeTaggedLiteralBody` is correctly named, because it takes the body.
- Suggestion: rename these to "text" in the same slice, or record them as a follow-up in the project's deferred list.

A12. The label of a `dataTypeValue` without a tag is the raw type id.
- Location: packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/data-type-value.ts lines 30-35.
- Issue: for `pg/int4` the label is `pg/int4`. Labels appear in `Expected one of: …` and in signature help, where other combinators say `number` or `string`. Users would see an internal id where they now see a word, for example in a `nanoid` signature.
- Suggestion: use `describeAdmittedForms(support, dataType)` as the label when there is no tag (`a number`, `true or false`), or decide it together with A01 before the downstream project uses it.

A13. ADR 231 lists only three of the combinator's codes.
- Location: docs/architecture docs/adrs/ADR 231 - Declarative attribute specifications.md line 196.
- Issue: the combinator also reports `PSL_INVALID_ATTRIBUTE_SYNTAX` for an expression that is not a literal, and `PSL_TAGGED_LITERAL_NUL` and `PSL_TAGGED_LITERAL_TOO_LARGE`.
- Suggestion: list all six codes, or say "the general codes, among them …".

A14. No test runs `dataTypeValue` on a stack assembled from real packs.
- Location: packages/1-framework/2-authoring/psl-parser/test/attribute-spec-combinators.data-type-value.test.ts lines 24-130; test/integration/test/authoring (no file).
- Issue: every test uses hand-built `pg/*` types and entries. Requirements 2 and 3 of decision 14 are about real stacks: the target's number classifier, its real casts, and the family's `sql/expression` entry next to the target's `json`. The downstream project will be the first to find a mismatch.
- Suggestion: add one integration test in `test/integration/test/authoring` that builds the data types from the assembled Postgres and SQLite stacks and parses `8`, `"8"` and `` sql`x` `` through `dataTypeValue` for the target's integer type and for `sql/expression`.

A15. The same refusals are worded in two places, with different text.
- Location: packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts lines 315-341; packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/data-type-value.ts lines 68-98.
- Issue: the unknown-tag message is copied word for word. The other two differ: `@default` says `this target has no data type for a number value` and `…; it casts from pg/int2`, while `dataTypeValue` says `This target has no data type for a number value; write …` and `…; write a number`. After the downstream project, `@default(1.5)` and `@default(nanoid(1.5))` will describe the same refusal in two ways. A Prisma 7 caller (requirement 6) would add a third wording.
- Suggestion: put one function in the framework, next to `ReadRefusal` and `CastRefusal`, that turns a refusal into a code and a message. Each consumer adds only its location prefix (`Field "X.y" at element 2: `). Pick one wording for the no-cast case.

## Summary

15 findings. The most important is A01: the default-function registry holds static signatures built before the stack exists, so `dataTypeValue`, which needs the stack's data types when it is built, cannot yet type `nanoid(8)`, the main downstream use in decision 14. The mechanism should be chosen and sent to the downstream project before this slice merges. A02 to A04 are naming problems around the same object and are cheap to fix now.
