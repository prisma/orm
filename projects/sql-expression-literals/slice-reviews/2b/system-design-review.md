# Slice 2b: system design review

## Scope and range

- Slice: 2b, "The six places take `sql` literals" (TML-3288).
- Branch: `tml-3288-sql-expression-places`. Base: `tml-3367-data-type-value` (slice 2t).
- Range: `git log tml-3367-data-type-value..HEAD`, commits `7833c3d94f` to `d951834e1e`. Diff read with `git diff tml-3367-data-type-value...HEAD -- . ':!projects'` (154 files). Code read at HEAD.
- Lens: system shape, names, boundaries, dependency direction, typology and conceptual minimality. Implementation correctness and test strength are the code reviewer's.

## What the slice solves and what it adds

Before the slice, `@default` took a `sql` literal but the other six places took a quoted string, so SQL that quotes camelCase columns was full of `\"`. After it, `@@index(where:)`, `@@index(expression:)`, `@@fullTextIndex(where:)`, `@@check(expression:)` and a policy's `using` and `withCheck` declare that they receive `sql/expression` through `dataTypeValue`, and the ADR 254 cast rule refuses everything else.

Invariants the slice adds:

1. Every raw-SQL place in PSL admits only a value of `sql/expression`. The refusal comes from the cast rule, with the same codes as `@default`.
2. Lowering stores the canonical text, read with `sqlTextFromCanonical`. The contract shape does not change.
3. Block specs may depend on the stack's data types (`BlockSpecContext.dataTypes`), like attribute specs.
4. The PSL printers (`contract infer` and `contract print`) write raw SQL only as a `sql` literal, and only when the text reads back unchanged. `contract infer` skips such an object with a note; `contract print` refuses it.
5. `ControlDefaultRegistries` is gone. The spec context carries `defaultFunctionRegistry` directly.
6. `@default` literal arms yield written scalars with their spans, so `lowerDataTypeDefault` reports at spans it is given instead of re-walking the syntax tree.

## Subsystem fit and boundaries

The shape is right. The type lives in the SQL family core (`@internal/sql-contract/sql-expression`). The typed argument lives in the framework parser. The SQL family specs (`@@index`, `@@check`) and the Postgres specs (`@@fullTextIndex`, policies) name the family's type id. The printers are Postgres code and import only family core. `lint:deps` passes. No target branch appears in family code, and no family word appears in framework code.

`BlockSpecContext.dataTypes` is the correct place for block specs to receive the data types. It mirrors `AttributeSpecContext.dataTypes` and has the same value. ADR 255's reason for keeping codecs out of parsing does not apply, because admitting a value of a data type picks no codec. The binder's role is also right: it builds block spec contexts when it binds block values, so it must carry the data types too. The cost is that the fact now enters parsing in several places (A11).

Making `indexModelSpec`, `checkModelSpec`, `postgresFullTextIndexSpec` and the policy parameters functions of the context is the ADR 249 contract doing what it was built for. It leaves the SQL registry with two calling styles (A10).

Removing `ControlDefaultRegistries` is a clear gain: one object had three names. No production reference remains. The only mentions left are in upgrade fragments, which is correct.

The `@default` span work is a real simplification. `DefaultRefusalPlace` and the syntax re-walk (`defaultValueExpression`, `listElements`) are gone, and `lowerDataTypeDefault` reports at spans it receives. The new value types it introduces are weakly typed (A08, A09).

One rule, two mechanisms, for text that does not read back: this is correct. `contract infer` reads a database the author does not control, and its existing convention is to skip what it cannot write and leave a note (for example a policy with an unprintable role). `contract print` reads a contract and its convention is to write it faithfully or refuse the whole print. Both follow their command's convention. What is wrong is where the rule is enforced: at five call sites instead of in the printer (A01), and with a stated reason that is narrower than the scope of the skip (A03).

## Naming and typology

- `sqlTextReadsBack` fits the existing vocabulary (`inferredDefaultReadsBack`, `policyNameReadsBack`). Its placement next to `printSqlExpressionLiteral` is right. The rule itself is tag-agnostic and is now written twice (A02).
- `canonicalizeTaggedLiteralBody` is now exported from both `framework-components/control` and `framework-components/authoring` (A02).
- `writtenScalar` and `writtenList` are the right idea: the reading step of the cast rule, as a combinator, for a position whose receiving type is known only at lowering. They are the first stage of what `dataTypeValue` does in one step, and both share `readWrittenScalar`, so there is no second reader. But `ParsedWrittenScalar` uses `ok` inside a successful parse, the wrapper keeps the wrapped arm's `kind` under a different output type, and `writtenList` is fixed to `AttributeCtx` while `writtenScalar` is generic (A09). Neither appears in ADR 231 (A07).
- `DefaultArgValue` is a union with no discriminant, and a bare `string` now means "enum member identifier" while a written string is a `ParsedWrittenScalar` (A08).
- `SQL_DOES_NOT_READ_BACK` is a shared note text homed in `infer-policy-blocks.ts` and imported by `infer-model-blocks.ts` (A14).
- The codemod under `scripts/codemods/` with byte-identical copies in the two fragments follows the `add-model-map.mjs` precedent. That placement is right. Nothing checks that the copies stay identical, or that its private copy of the print rule matches `printTaggedLiteral` (A15).

## ADR review

### ADR 260

Structure follows `adr-writing.mdc`: an example first, the decision, why, one section per sub-decision, consequences, alternatives last. The decisions match design-notes 1 to 7, 11 and 12. The rejected alternatives match the design-notes list, minus the three about migration files, which belong to decision 10 and ADR 195. Decision 4's revision (the family registers the type, targets do not) is recorded correctly. The examples match the code; the TypeScript ones say they describe the planned surface.

Problems:

- The Consequences bullet says "Wire names do not change", which contradicts its own `--` section and spec requirement 5 (A05).
- The list of what canonicalization removes omits whitespace-only inner lines in two places, while the `contract print` refusal message includes them (A05).
- Three phrases narrate earlier states, which `adr-writing.mdc` forbids (A06).
- References omit ADRs 236, 243 and 244, which now link to it, and the design-notes assumption "a stack contains one target" is not recorded (A17).

### Amendments

- ADR 129: reads as end state. The typed-position section and the reworded rejected alternative ("Check a `@default` literal's tag while parsing") are clear and consistent. The new consequence about `contract infer` overstates how objects are compared (A04).
- ADR 231: the status amendment and the `dataTypeValue` paragraph are end state. The new "Tagged literals and JSON values" section omits `writtenScalar` and `writtenList`, and its sentence about `@default` no longer describes the code (A07). The follow-up item is correctly closed.
- ADR 234, 236, 243, 244: examples now use `sql` literals, each with a one-line pointer to ADR 260. End state, brief. Good.
- ADR 249: `index` and `check` built from the context, `defaultFunctionRegistry` on the context, `ControlDefaultRegistries` gone. End state. It still says every entry is a factory over the context, which the interpreter's calls no longer honour uniformly (A10).
- ADR 254: one reference line. Enough for 2b.
- ADR 255: the status line and the new subsection "Block specs may read the stack's data types" read as end state, and the policy example matches the code.
- `ADR-INDEX.md`: rows for 129, 254 and 260 are correct.

## Test strategy at the architectural level

Adequate for the invariants, with two gaps.

- The block spec context tests cover every production path (psl-parser binder and interpreter, the SQL provider and interpreter, the Mongo provider, the language server). This is the right shape for a fact that enters through many doors.
- The wire-name test, the six-place interpreter tests, the policy tests, the print refusal test and the new CLI journey cover invariants 1, 2 and 4 end to end.
- Gap: the guard test `sql-expression-places.test.ts` lists the eight known arguments. It passes if a ninth raw-SQL argument is added with `str()`, which is the case it claims to catch (A12).
- Gap: nothing pins what the next `migration plan` does after `contract infer` skips an object (A03).
- Test fixtures build "the data types a Postgres stack registers" by hand in four places (A13).

## Findings

A01
- Location: packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-model-blocks.ts lines 130-151; packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-policy-blocks.ts lines 12-17 and 92-95; packages/3-targets/3-targets/postgres/src/core/psl-print/model-attributes.ts lines 161-190; packages/3-targets/3-targets/postgres/src/core/psl-print/row-level-security.ts lines 133-139; packages/3-targets/3-targets/postgres/src/core/psl-print/refusals.ts lines 609-624; packages/2-sql/1-core/contract/src/sql-expression.ts lines 33-41.
- Issue: The invariant "a printed `sql` literal reads back as the same text" is enforced by each caller, not by the printer. The predicate `texts.every(text => text === undefined || sqlTextReadsBack(text))` is written three times. `buildIndexAttribute` and `buildCheckAttribute` are shared by infer and print, yet each caller must remember the check first. A new printer path (for example the planned `@@fullTextIndex` infer printer) can print a literal that reads back changed, and nothing fails.
- Suggestion: Let `printSqlExpressionLiteral` throw an `InternalError` when the text does not read back, so the printer owns the invariant. Add one predicate for "all present texts read back" next to `sqlTextReadsBack` and use it in the three places. Keep skip (infer) and refuse (print) at the command level, where they are now.

A02
- Location: packages/1-framework/1-core/framework-components/src/exports/authoring.ts line 74; packages/1-framework/1-core/framework-components/src/exports/control.ts lines 149-156; packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/data-type-value.ts lines 92-98; packages/2-sql/1-core/contract/src/sql-expression.ts lines 37-41.
- Issue: The read-back rule is written twice: `sqlTextReadsBack` in the SQL family and `rewriteAsTaggedLiteral` in the parser, because the parser cannot import the family. The rule does not depend on the tag. To make the second copy possible, `canonicalizeTaggedLiteralBody` is now exported from `authoring` as well as `control`, so one function has two public entry points, and the tagged-literal module is split across two entries.
- Suggestion: Add a tag-agnostic `taggedLiteralTextReadsBack(text)` to `framework-components/src/shared/tagged-literal.ts`, beside `printTaggedLiteral`, and export it from `authoring`. The parser and `sqlTextReadsBack` call it (or `sqlTextReadsBack` is removed). Remove the new `authoring` export of `canonicalizeTaggedLiteralBody`; if both entries need tagged-literal functions, pick one entry for the module.

A03
- Location: packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-model-blocks.ts lines 130-151; packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-policy-blocks.ts lines 92-95; docs/architecture docs/adrs/ADR 129 - Template-Tagged Literals for Extensions.md line 131.
- Issue: Two problems with the infer skip. First, its scope is wider than its reason. The stated reason is byte-for-byte comparison, which applies only to exact-named (`map:`) objects. A wire-named object is compared by name, and its name hashes whitespace-collapsed text, so canonicalization does not change it. Yet infer skips both kinds. Second, a skipped object is missing from the inferred contract. On a table the contract owns, the planner treats a database policy or index missing from the contract as extra, so the next plan that allows destructive operations proposes to drop it. For a policy that is a security change, and the note does not say so or say how to recover.
- Suggestion: Decide which reason governs. Either narrow the skip to exact-named objects, or state the broader reason (the inferred contract must hold the database's text exactly) in ADR 129 and the design. Extend the note to say that the object stays in the database and that the next plan will propose dropping it unless it is written back. Add a test that pins the plan outcome for a skipped policy.

A04
- Location: docs/architecture docs/adrs/ADR 129 - Template-Tagged Literals for Extensions.md line 131.
- Issue: "An index, check or policy is compared with the database byte for byte" contradicts ADR 234 and ADR 244, where a wire-named object is compared by name only. Only an exact-named object compares its body byte for byte. Design-notes decision 8 says this correctly ("an adopted (`map:`) object").
- Suggestion: Reword to "An exact-named (`map:`) index, check or policy compares its body with the database byte for byte", and align with the outcome of A03.

A05
- Location: docs/architecture docs/adrs/ADR 260 - Raw SQL is a value of the data type sql-expression.md lines 72 and 132.
- Issue: The Consequences bullet says "Wire names do not change". The ADR's own `--` section, and spec requirement 5, say a text with both `--` and a line break gets a new wire name once. Both places also list what canonicalization removes without "a whitespace-only inner line", which spec requirement 5 and the `contract print` refusal message include.
- Suggestion: Say "Wire names do not change, except for a text that holds both `--` and a line break, which gets a new name once." Use one list of canonicalization effects everywhere, including whitespace-only lines.

A06
- Location: docs/architecture docs/adrs/ADR 260 - Raw SQL is a value of the data type sql-expression.md lines 64, 72 and 145.
- Issue: "`sql` was its one exception", "For a string written before this decision" and "the six places needed typed arguments now" narrate earlier states and project timing. `adr-writing.mdc` asks for timeless wording.
- Suggestion: "ADR 254 gives every written value a data type, `sql` included." "A quoted string rewritten as a `sql` literal keeps its text, except where …". "Rejected: typed arguments are needed by the raw-SQL places, and that work has no specification."

A07
- Location: docs/architecture docs/adrs/ADR 231 - Declarative attribute specifications.md section "Tagged literals and JSON values" (line 194 onward); docs/reference/psl-editor-tooling-tagged-literals.md section "How specs take a tagged literal".
- Issue: The slice adds two public combinators to the kit, `writtenScalar(arm)` and `writtenList(of)`, and `@default` now consumes their output. ADR 231 does not name them, and its sentence "`@default` uses it for its tagged-literal arm, and lowering reads the tag" no longer describes what `@default` receives. The editor tooling brief has the same gap.
- Suggestion: Add one paragraph to ADR 231: `writtenScalar` wraps a literal arm and yields the written scalar with its span; `writtenList` does the same for a list; they are the reading step that `dataTypeValue` performs before casting, used where the receiving type is known only at lowering (`@default`), and they defer the canonicalization failure to lowering because a parse failure inside `oneOf` would be replaced by `Expected one of: …`. Mirror one sentence in the editor tooling brief.

A08
- Location: packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts line 258; packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts lines 669-715.
- Issue: `DefaultArgValue = ParsedWrittenScalar | ParsedWrittenList | TypedFuncCall | string` has no discriminant. The consumer tells the arms apart with `typeof value === 'string'`, `'written' in value || 'reason' in value` and `'elements' in value`. A bare `string` now means "enum member identifier", while a written string is a `ParsedWrittenScalar` of kind `string`, so the same word names two things and adding an arm silently changes which test matches.
- Suggestion: Give each arm output a `kind`: `ParsedWrittenScalar` and `ParsedWrittenList` carry `kind: 'scalar'` and `kind: 'list'`, and the enum arms yield `{ kind: 'member', name }`. Then `lowerDefaultForField` switches on `kind`.

A09
- Location: packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/written-scalar.ts lines 11-63.
- Issue: `ParsedWrittenScalar` uses `ok: true | false` inside a successful parse, so it reads like a `Result` but is not one. `writtenScalar` copies the wrapped arm's `kind` (`str`, `taggedLiteral`) onto an arm with a different output type, which needs a `blindCast`. `writtenList` is fixed to `AttributeCtx`, while `writtenScalar` is generic over the context.
- Suggestion: Rename the field to say what it is, for example `canonical: true | false` or a `reason` present only on failure, so it is not mistaken for a `Result`. Say in the doc comment that `kind` describes the syntax accepted, for tooling, not the output. Make `writtenList` generic like `writtenScalar`.

A10
- Location: packages/2-sql/2-authoring/contract-psl/src/interpreter.ts lines 868, 905, 951, 986, 1052, 1665, 1691 and 2181; packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts lines 811-820.
- Issue: The SQL registry now has two calling styles. `index` and `check` take the context; the interpreter calls `control()`, `id()`, `unique()`, `discriminator()`, `base()` and `map()` with no argument. ADR 249's contract is that every entry is a factory over the context. The interpreter therefore has to know which specs depend on the context, and the next spec that starts to depend on it needs call-site edits.
- Suggestion: The interpreter already builds one `specContext` per model. Pass it to every model factory, and write every registry entry as `(ctx) => …` or as the spec function itself (`index: indexModelSpec`).

A11
- Location: packages/1-framework/2-authoring/psl-parser/src/binder.ts lines 311-339; packages/1-framework/2-authoring/psl-parser/src/block-spec/interpret.ts lines 269 and 325-333; packages/1-framework/3-tooling/language-server/src/completion-provider.ts lines 454-458; packages/1-framework/3-tooling/language-server/src/attribute-spec-resolution.ts lines 61-65.
- Issue: `BlockSpecContext` is built as an object literal at six sites. `interpretExtensionBlocks` also receives `dataTypes` separately from the `binder`, which was created with its own `dataTypes`. Binding and interpretation can therefore build a block's spec from different data types, and nothing states they must be the same.
- Suggestion: Add a `blockSpecContext({ symbols, block, dataTypes })` factory in psl-parser, as `modelSpecContext` exists for models, and use it at every site. State in the `InterpretExtensionBlocksInput` doc comment that `dataTypes` must be the value the binder was created with.

A12
- Location: packages/3-targets/3-targets/postgres/test/sql-expression-places.test.ts lines 1-72.
- Issue: The guard lists the eight known arguments and asserts each is `dataTypeValue` of `sql/expression`. A new raw-SQL argument written with `str()` is not in the list, so the test still passes. The comment asks the author to add it, which is the human step the guard was meant to replace.
- Suggestion: Invert it. Walk every registered SQL and Postgres model attribute spec and every Postgres block spec, collect every argument typed `str()`, and compare the set with an explicit list of non-SQL string arguments (names, maps, index types, languages). A new `str()` argument then fails the test until someone decides which list it belongs to.

A13
- Location: packages/3-targets/3-targets/postgres/test/fixtures/postgres-data-type-support.ts; packages/3-targets/6-adapters/postgres/test/helpers/postgres-data-type-support.ts; packages/2-sql/2-authoring/contract-psl/test/fixture-data-types.ts; packages/1-framework/3-tooling/language-server/test/completion-provider.test.ts.
- Issue: Four test files rebuild "what the SQL family registers" by hand (`sql/expression` and its entry, then the target's types). Production does this once in packages/2-sql/9-family/src/core/control-descriptor.ts line 31. If the family registers another type, the fixtures drift and tests exercise a stack that production never builds.
- Suggestion: Export the family's registration as one value from `@internal/sql-contract/sql-expression` (the declaration list and the entries map), use it in the family control descriptor, and spread it in the fixtures. Deferring to slice 3 is acceptable, since slice 3 touches the same fixtures.

A14
- Location: packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-policy-blocks.ts lines 11-13; packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-model-blocks.ts line 53.
- Issue: The shared note text `SQL_DOES_NOT_READ_BACK` lives in the policy module and the model module imports it from there, so the model printer depends on the policy printer for a constant.
- Suggestion: Move it to a neutral infer module, or next to the predicate from A01.

A15
- Location: scripts/codemods/rewrite-sql-strings.mjs; upgrade-instructions/pending/sql-expression-literals-psl/app/scripts/rewrite-sql-strings.mjs; upgrade-instructions/pending/sql-expression-literals-psl/extension/scripts/rewrite-sql-strings.mjs; scripts/codemods/rewrite-sql-strings.test.mjs.
- Issue: Three copies must stay byte-identical while the fragment is pending, and nothing checks it. The codemod also carries its own copy of the string-decoding and `printTaggedLiteral` rules, and no test ties its output to the real printer.
- Suggestion: In `rewrite-sql-strings.test.mjs`, assert that the pending copies equal the canonical file while they exist. Add a few cases whose expected output is taken from `framework-components` `tagged-literal.test.ts` (backtick, double-quote form, multi-line, backslash), so a change to the print rule shows up in the codemod test too.

A16
- Location: packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts lines 139 and 171.
- Issue: `createSqlBinder` takes `defaultFunctionRegistry` as optional and falls back to an empty map. Slice 2t made `dataTypes` required on the same function so that "a new caller cannot silently build a binder with no tag arms". The same reasoning applies to function arms.
- Suggestion: Make `defaultFunctionRegistry` required on `createSqlBinder`, and let tests pass `new Map()` explicitly.

A17
- Location: docs/architecture docs/adrs/ADR 260 - Raw SQL is a value of the data type sql-expression.md, sections "The SQL family defines and registers `sql/expression`" and "References".
- Issue: ADRs 236, 243 and 244 now link to ADR 260, but its References list only 129, 231, 234, 249, 254 and 255. Design-notes decision 4 records the assumption that a stack holds one target, which is why a family-registered id cannot collide; the ADR drops it.
- Suggestion: Add ADRs 236, 243 and 244 to References. Add one sentence to the family section: "A stack holds one target, so the family's registration never meets another."
