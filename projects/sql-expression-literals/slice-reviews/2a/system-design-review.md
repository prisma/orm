# Slice 2a — system design review

Reviewer: architect. Range: `origin/main...HEAD`, merge base `18e3711cbb`. Slice 2a (TML-3296): `sql` becomes the tag of the data type `sql/expression`.

## Summary

At the framework level the slice does what it set out to do. The framework has one kind of authoring entry again, and it names no SQL concept. `sql/expression` is defined once, in `@internal/sql-contract`, the lowest package that every consumer already depends on. `@default` now owns its SQL checks. The code follows the design closely. Its one structural departure, a separate branch for tagged literals in `lowerDefaultForField`, is an improvement.

The problems are about ownership and vocabulary, not behaviour:

- The family defines `sql/expression`, but each adapter registers it, while the framework, ADR 254 and the target files all say that the owner registers. The framework already lets the family descriptor register data types itself (A01). No test checks that the registered objects are the family's (A02).
- Two consumers of one type read it in two ways. `@default` reads the written text, and the 2b places will read the canonical value (A03). The infer printer still skips the `sql` entry by its key, which the cast rule already makes unnecessary (A04).
- Some names say something the system does not mean: `PSL_DEFAULT_TYPE_INCOMPATIBLE` (A05), "SQL text" as the definition of a type named `expression` (A06), "body" and "text" for one thing (A08), and `lowerTaggedLiteral` (A10).
- ADR 129 still says a tag names the pack that owns the text. It also disagrees with ADR 254 about who may register an unprefixed tag (A07). One sentence in ADR 254 does not match the code (A09).
- Leftovers: framework tests (A12), a family comment (A13), and pointers to slice 2b (A14). One constant sits in the wrong module (A11).

## What looks solid

- **The lowering-entry kind is gone from the framework.** `AuthoringContributions.dataTypes` holds one entry type (`framework-authoring.ts:603-604`). `enforceDataTypeInvariants` has no special keys left (`control-stack.ts:432-452`). A new test shows that a key which is not a registered data type id fails assembly (`data-type-assembly.test.ts:86-94`). The framework vocabulary ratchet stays at 272.
- **Placement and dependency direction.** `packages/2-sql/1-core/contract/src/sql-expression.ts` is SQL-family core in the shared plane. It imports only from the framework's shared entries `/authoring` and `/codec`. The family, both targets, contract-psl and the family infer printer depend on it downward. This follows the "SPI at the lowest consuming layer" pattern. The id `sql/expression` uses the family id as its owner segment, as the id scheme in ADR 254 requires.
- **One family-blind printer.** `printTaggedLiteral` in `framework-components/src/shared/tagged-literal.ts` knows no tag. The family printer uses it for `json` and for `sql`. The tests read every printed form back through the canonicalization, including the case where a printer indented the continuation lines (`tagged-literal.test.ts:125-171`).
- **The adapters lost their own data type code.** The `data-type-authoring.ts` files are deleted, and each adapter contributes its target's entries unchanged (`6-adapters/postgres/src/exports/control.ts:18`, `6-adapters/sqlite/src/exports/control.ts:17`). One layer of indirection is gone.
- **The checks moved to their consumer.** `@default` runs the reserved-name check and `checkSqlDefaultBody` itself (`psl-column-resolution.ts:669-683`). This matches the principle "checks on a value belong to the place that uses it". A `sql` literal inside a list literal is now refused by the ordinary cast rule, not by a special case (`interpreter.defaults.tagged-literal.test.ts:255-264`).
- **A better structure than the design described.** Design section 10 put the `sql/expression` check inside the shared `typeof value === 'object'` branch. The code gives tagged literals their own branch before default functions (`psl-column-resolution.ts:715-726`), so default-function lowering no longer handles tags at all.
- **The design corrections in `ce2f5760c1`** change only file paths, line numbers and two clarifications (the SQLite file has no doc sentence to replace; `pg . sql` in the formatter input). No architectural statement changed.

## Findings

### A01 — The family defines `sql/expression`, but the adapters register it, and the docs say the owner registers

Location: packages/3-targets/3-targets/postgres/src/core/data-types.ts lines 1-9 and 149; packages/3-targets/3-targets/sqlite/src/core/data-types.ts lines 1-9 and 82; packages/3-targets/3-targets/postgres/src/core/data-type-entries.ts lines 4-8 and 84; packages/3-targets/3-targets/sqlite/src/core/data-type-entries.ts line 64; packages/3-targets/3-targets/sqlite/test/data-types.test.ts lines 18-29; packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts lines 566 and 603; docs/architecture docs/adrs/ADR 254 - Data types and casts.md lines 77 and 102; upgrade-instructions/pending/sql-is-a-data-type/extension/instructions.md lines 87-105.

Issue:

- The design gives the family ownership of the type, so that the rule "`sql/expression` casts from nothing" has one owner. But the family does not register the type. Each target appends it to its own lists, and the adapter descriptor contributes those lists (`6-adapters/postgres/src/core/descriptor-meta.ts:171`, `exports/control.ts:18`). Assembly therefore records the adapter as the owner. See `assembleDataTypes`: "Each data type has exactly one owner across the composed stack" (`control-stack.ts:352`).
- As a result, several texts are now false. `framework-authoring.ts:566` says an entry is "contributed by the pack that owns the type", and line 603 says "the data types this contribution owns". Both target `data-types.ts` headers say "The data types this target owns". The Postgres header adds "one per PostgreSQL type its codecs represent", and `sql/expression` is neither. ADR 254:102 says "The pack that owns a data type contributes PSL support for it". The Postgres entries header uses two verbs for one step: the adapter "contributes" and the target "registers". The SQLite test "registers the types it distinguishes, not one per storage class" now lists a type that is not a SQLite type at all.
- The targets add nothing of their own to the registration. The design compares it to codec templates such as `sql/int@1`, but the comparison does not hold. A target adapts a codec template by naming its own data type. Here it copies two objects unchanged. So every future SQL target must remember the same two lines. The upgrade fragment already tells third-party targets to append them "as the last element and the last key". A target that forgets them loses the `sql` tag. A target that declares its own `sql/expression` with a cast from its text type would admit plain strings in slice 2b, and would pass every current test (A02).
- The framework already supports the direct form. Every descriptor, the family's included, has `dataTypes` and `authoring` (`framework-components/src/shared/framework-components.ts:65,72`). `createControlStack` assembles the family together with the target and the adapter (`control-stack.ts:808`). The PSL interpreter and the Prisma 7 reader read the assembled `authoringContributions.dataTypes` and `dataTypeLookup` (`contract-psl/src/interpreter.ts:2164-2167`, `contract-prisma7/src/interpreter.ts:1127-1130`).

Suggestion: Register `sql/expression` from `SqlFamilyDescriptor` (`packages/2-sql/9-family/src/core/control-descriptor.ts`): `dataTypes: [sqlExpressionDataType]`, and `authoring.dataTypes: { [SQL_EXPRESSION_DATA_TYPE_ID]: sqlExpressionAuthoringEntry }`. Remove it from the target lists. Then the owner and the registrant are one component, the target lists again hold only the target's own types, and third-party targets have nothing to remember. Narrow ADR 254:77 from "no family registers types" to "a family registers only a type that is the same on every target and that no other type casts from; `sql/expression` is the only such type". Tests that build contributions by hand from the target lists must then add the family's entry. If the team keeps registration in the targets instead, record "the family registers it itself" in ADR 254 as a rejected alternative, with the reason. Then correct the texts listed above, so that "owns" and "registers" stop meaning the same thing.

### A02 — No test checks that the registered objects are the family's, and "nothing casts from `sql/expression`" is checked only on target lists

Location: packages/3-targets/3-targets/postgres/test/data-types.test.ts lines 36-66 and 104-112; packages/3-targets/3-targets/sqlite/test/data-types.test.ts lines 17-51; packages/3-targets/6-adapters/postgres/test/control-mutation-defaults.test.ts lines 326-341; packages/3-targets/6-adapters/sqlite/test/control-mutation-defaults.test.ts lines 5-20; upgrade-instructions/pending/sql-is-a-data-type/extension/instructions.md line 107.

Issue: The target tests check that the list of ids contains `sql/expression`. The adapter tests check the keys and the tag names. No test checks that the registered declaration is `sqlExpressionDataType` and the registered entry is `sqlExpressionAuthoringEntry`. Only the family object is tested for "casts from nothing" (`sql-expression.test.ts`), so nothing ties that rule to what a stack actually registers. The other half of the rule, "no type casts from `sql/expression`", is tested on each target's own list, not on an assembled stack with extensions. For extensions the rule exists only as a sentence in the upgrade fragment.

Suggestion: Add one test per SQL target on an assembled control stack: the family, the target, the adapter, and the extension packs the repo ships. Assert that `stack.dataTypes.get('sql/expression')` is `sqlExpressionDataType` (`toBe`), that the entry under that key is `sqlExpressionAuthoringEntry` (`toBe`), and that no registered type names `sql/expression` in `casts` or in `listCast.of`. If A01 is not adopted, also add the two `toBe` checks to each target's own test. Either way, make the rule for extensions a test, or a check the family runs when it creates its instance, instead of prose.

### A03 — `@default` reads the written text, not the `sql/expression` value

Location: packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts lines 669-683 and 715-726; projects/sql-expression-literals/design.md section 10 against sections 8.1 and 9.2.

Issue: `lowerDefaultForField` reads the literal into a typed value (line 721) and checks its type id. Then it discards the value and uses `lowered.written.text`, the text as written (line 723). This works only because the entry's `parse` returns its input unchanged. ADR 129:87 now says that `@default` "stores such a value". The six places in slice 2b will read `sqlTextFromCanonical(typed.value)` (design 8.1, 9.2), so the one type gets two ways to read it. The reserved-name message also writes the tag as the plain word `sql` (line 674), not as `SQL_EXPRESSION_TAG`.

Suggestion: Pass `sqlTextFromCanonical(read.typed.value)` to `sqlExpressionDefault`. Then every consumer of `sql/expression` reads the canonical form through the one function the family provides. A later change to `parse` then cannot make `@default` and the six places disagree. Build the message from `SQL_EXPRESSION_TAG`. Update design section 10 to match.

### A04 — The infer printer still skips the `sql` entry by its key

Location: packages/2-sql/9-family/src/core/psl-build/default-mapping.ts lines 90-113 (the skip is line 97); packages/2-sql/1-core/contract/src/sql-expression.ts line 20.

Issue: `writingSurface` skips the entry keyed `SQL_EXPRESSION_DATA_TYPE_ID`, but the skip changes no output. A stored value is printed as a type's literal only when the column's type is that type or casts from it (`admitted`, lines 142-155). In a list cast, it is printed that way only when the cast lists the type (`writeElement`, lines 221-241). No column has `sql/expression`, and no type casts from it, so the cast rule already excludes the entry. The skip states that rule a second time. It is also the last place where family code tells the `sql` entry apart from the other entries by its key. ADR 129 now rejects exactly that ("every reader of the entries had to tell apart"). One effect: the entry's `print` is never called outside its unit test, because infer prints SQL through `printSqlExpressionLiteral`.

Suggestion: Delete the skip. The new test "prints text on a text column as a string, never as a sql literal" (`default-mapping.test.ts:227`) then shows that the cast rule excludes the entry. If A01 is adopted, the target entry lists will no longer hold the key at all.

### A05 — `PSL_DEFAULT_TYPE_INCOMPATIBLE` no longer names what it reports

Location: packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts lines 21-27 and 430-447; docs/architecture docs/adrs/ADR 254 - Data types and casts.md line 151; docs/reference/error-reference.md lines 804-806.

Issue: After the split, this code has one meaning: a single value written on a list column. That is a refusal about shape, not about type, because the value can have the column's element type (`Int[] @default(1)`). Read next to `PSL_VALUE_TYPE_INCOMPATIBLE`, the name says "the same type mismatch, reported by `@default`". That was its old meaning, and it is now wrong. The mirror case, a list written on a column that holds one value, is a real type question, because list casts exist (ADR 254:73). It correctly reports `PSL_VALUE_TYPE_INCOMPATIBLE`. So the two cases really are different, but the name hides the difference. `PSL_INVALID_DEFAULT_LITERAL` reads as "the default version of `PSL_INVALID_LITERAL`". That is close to its meaning (the column's codec refused the value), so it can stay.

Suggestion: In this slice, rename `PSL_DEFAULT_TYPE_INCOMPATIBLE` to a name that says a list was expected, for example `PSL_DEFAULT_LIST_EXPECTED`. The slice already changes these codes and ships a table of old and new codes, so one more row costs almost nothing now. A later rename would be a second breaking change.

### A06 — `sql/expression` is defined as "SQL text", and one doc uses it for a query

Location: packages/2-sql/1-core/contract/src/sql-expression.ts lines 14 and 22-23; docs/architecture docs/adrs/ADR 254 - Data types and casts.md line 77; docs/architecture docs/subsystems/6. Ecosystem Extensions & Packs.md lines 627-650.

Issue: The id promises a SQL expression. An expression is a real and stable distinction from a statement or a query, and every place in the project takes one: a default, an index element, a predicate, a CHECK body. ADR 129:16 even says that `@default` "checks that the text is one expression". The definitions say something wider: "SQL text in the target database's language". The entry's documentation, which the editor shows on completion, says the same. Subsystem doc 6 now writes a view definition, which is a `SELECT` query, as `` sql`...` ``. So the doc teaches that `sql/expression` holds queries. The same section still describes the removed model. Its syntax line "`<pack>[.<flavor>]`" is the prefixed-alias form that this slice removes, and "routes it to the owning pack" is the lowering entry. Its example `` @@index(where: sql`...`) `` is refused by PSL until slice 2b.

Suggestion: Define the type as "a SQL expression in the target database's language" in the code comment, the entry's documentation and ADR 254:77. Replace the section in doc 6 with two sentences that point to ADR 129 and ADR 254: a tag names a data type, and `sql` writes `sql/expression`. Drop the view example. If view queries are ever supported, they need a type of their own. Add the `where:` example in slice 2b.

### A07 — ADR 129 still describes the old ownership model, and it disagrees with ADR 254 about unprefixed tags

Location: docs/architecture docs/adrs/ADR 129 - Template-Tagged Literals for Extensions.md lines 1, 16, 34, 50, 76-81, 89 and 102; docs/architecture docs/ADR-INDEX.md line 139; docs/architecture docs/adrs/ADR 254 - Data types and casts.md lines 77 and 139.

Issue:

- The rewritten ADR says two different things about a tag. It says that the tag "names who owns the text" (line 16). Lines 34 ("says a pack owns the text"), 50 ("the body a pack receives") and 102 ("visibly owned"), and the H1 ("pack-owned text"), say the same. It also says that a tag names a data type (lines 26 and 74). The second is the decision. The first is left over from the removed design.
- The prefix rule is stated three ways. ADR 129:76-78 says any pack ("a target, a family, or an extension") may register tags, and that the family owns the unprefixed `sql`. ADR 254:139 says "A target may register an unprefixed tag; every other pack prefixes", with `sql` "registered by each SQL target". Index row 139 says "only the target unprefixed". ADR 254:77 says no family registers types, so a family cannot register a tag either. A reader cannot tell whether the rule depends on the owner of the type or on the component that registers it.
- Line 89 says the two checks belong to `@default` "in PSL and TypeScript alike". In TypeScript they still run inside the `sql` tag until slice 3 (`packages/2-sql/2-authoring/contract-ts/src/sql-default-literal.ts` lines 34-47).

Suggestion: State the prefix rule once, in ADR 254, in terms of the owner of the data type: a tag is unprefixed when the owner of its type is the family or a target, and every other owner prefixes its tags. Link to that rule from ADR 129. Drop "a family" from ADR 129's list of registrants, or, if A01 is adopted, keep it and say that the family registers `sql`. Replace the ownership sentences with "the tag names the data type of the text". Retitle the H1 and the index row, for example "Tagged literals write values of data types in PSL". Limit line 89 to PSL until slice 3, or say that the TypeScript tag still runs the checks.

### A08 — One thing has two names: "body" and "text"

Location: docs/architecture docs/adrs/ADR 129 - Template-Tagged Literals for Extensions.md lines 16, 48-58, 87 and 91; packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts lines 5-6; packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts line 31.

Issue: The slice renames the `WrittenValue` tag arm from `body` to `text`, and names its new API with "text" (`sqlTextFromCanonical`, `printTaggedLiteral(tag, text)`). The framework's canonicalization still returns `body` (`TaggedLiteralCanonicalization`), and the family keeps `checkSqlDefaultBody`. The rewritten section of ADR 129 mixes the two words: "checks that the text is one expression" (line 16), "its canonical form is the canonical body" and `expression: <body>` (line 87), and "A body containing `;`" (line 91). A reader cannot tell whether "body" and "text" are two things.

Suggestion: Adopt one rule. The body is what is written between the quotes. The text is the canonical value after canonicalization. Apply the rule in ADR 129 and in the error reference now. Record renaming `TaggedLiteralCanonicalization.body` to `text` as debt for slice 2t, which moves the neighbouring code into the framework.

### A09 — ADR 254 says every literal refusal points at the written value, but `@default` points at the attribute

Location: docs/architecture docs/adrs/ADR 254 - Data types and casts.md line 151; packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts lines 635-652; docs/reference/error-reference.md lines 800-802.

Issue: The rewritten bullet ends "Every one points at the written value." But `readAsLiteral` reports every cast-rule code with `source.at()`, which is the span of the whole `@default` attribute. The error reference says so too ("Reported at the `@default` attribute"). The claim was already false before this slice. What is new is that the slice makes these codes shared: in slice 2t, `dataTypeValue` reports them at the written value (design section 13). Decision 12 says one rule should look the same to users and to tools. After 2t, one code will point at two different places.

Suggestion: Correct ADR 254 now: `@default` reports these codes at the attribute. Record the different anchor in the slice 2t brief, so that 2t either moves `@default` to the written value or states the difference on purpose.

### A10 — `lowerTaggedLiteral` no longer lowers anything

Location: packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts lines 557-588, 661 and 716.

Issue: The function now checks that the tag is registered and that the text canonicalized, and returns a `WrittenValue`. It produces no default. But its name, its result type `TaggedLiteralLowering` and the variables named `lowered` still describe the removed step, in which a tag lowered its own body. Its refusal arm has the type of a default-function lowering result (`Extract<LoweredPslDefaultResult, { kind: 'owned' }>`). That ties a literal reader to the types of the default-function registry.

Suggestion: Rename the function to `readTaggedLiteral`. Give it its own result type with a `{ ok: false; diagnostic }` arm. If slice 2t replaces the function with the framework's reader, name the removed concept in the 2t brief, so that the old name does not survive the move.

### A11 — `PSL_INVALID_DEFAULT_SQL` sits in a module whose header says it holds no per-type code

Location: packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts lines 1-7 and 18-19; packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts line 677.

Issue: The module header says "No per-type code and no per-codec branch live here." The constant names a refusal that exists only for `sql/expression` values in `@default`. Its only user is `sqlExpressionDefault` in `psl-column-resolution.ts`. In slice 2t, this module becomes what is left of default reading after the family-blind half moves to the framework. A `sql/expression` code in it will then look like part of the cast rule.

Suggestion: Declare the constant next to `sqlExpressionDefault`. If that function grows, move both into a file of their own. Update design section 10 and the sentence in `docs/reference/psl-editor-tooling-tagged-literals.md` that says where the three default-only codes are declared.

### A12 — Framework tests still use `pg.sql` and `sqlite.sql` as example tags

Location: packages/1-framework/2-authoring/psl-parser/test/attribute-spec-combinators.tagged-literal.test.ts lines 47, 52, 57, 62, 78 and 81; packages/1-framework/2-authoring/psl-parser/test/attribute-spec-combinators.json-value.test.ts line 119; packages/1-framework/2-authoring/psl-parser/test/parse-tagged-literal.test.ts lines 54, 87 and 164; packages/1-framework/2-authoring/psl-parser/test/tokenizer.test.ts line 355.

Issue: The design replaced `pg.sql` in the formatter fixture and in `expressions.ts`, because they "only illustrate a dotted tag". The same reason applies to these tests, and they were missed. They are framework tests, and they present a removed SQL tag as the example of a valid dotted tag. One of them even uses `taggedLiteral(['sql', 'pg.sql'], …)`, which is the old registration. The plan's grep leaves out tests, so nothing catches them.

Suggestion: Use the dotted tag that the formatter fixture now uses, `postgis.geometry` (and `postgis . geometry` for the whitespace case). Where a test needs two tags, use `json` and `postgis.geometry`.

### A13 — A family comment still says that a data type is a database type and that the family registers none

Location: packages/2-sql/4-lanes/relational-core/src/ast/data-type-support.ts lines 4-7.

Issue: The header says "The family registers no data types of its own: a data type is a database type, and every database type belongs to a target or an extension." ADR 254 now defines a data type as the type of a value Prisma stores or passes to the database, and the family defines `sql/expression`. The research survey listed this comment (`research/data-types.md`, the code comments list), but the design did not carry it into section 19.

Suggestion: Rewrite the header. Most data types are database types, which belong to a target or an extension. The family defines one, `sql/expression`, in `@internal/sql-contract/sql-expression`. This file holds the arithmetic that the targets share. If A01 is adopted, also say that the family registers the type.

### A14 — Slice 2a points ahead to slice 2b

Location: packages/2-sql/1-core/contract/src/sql-expression.ts lines 14 and 36-40; packages/1-framework/1-core/framework-components/src/exports/authoring.ts lines 73-78.

Issue: Each slice merges to `main` on its own. The doc comment on `sqlExpressionDataType` ends with "ADR 256". ADR 256 is written in slice 2b, so until then the pointer leads nowhere. Three files are already numbered ADR 255, so the number is not safely reserved. `sqlTextReadsBack` has no caller until the infer skip in slice 2b. `describeTaggedLiteralFailure` and `resolveTemplateTagEscapes` are added to the `authoring` entry, but no code in 2a imports them from there. The TypeScript tag imports them from `control`.

Suggestion: Point the doc comment at ADR 254, which records the type in this slice, and let slice 2b add ADR 256. Move `sqlTextReadsBack` and its tests to slice 2b, next to their consumer. Add the two `authoring` exports in the slice that first imports them from there.

## Deferred

- **The cast-rule sentence for ADR 254.** Design section 19 lists "Only the scalar cast rule moves to the framework; list casts stay in the family's default reader" for ADR 254 in slice 2a. This slice correctly leaves it out, because the move happens in slice 2t. The sentence belongs to 2t.
- **`ControlDefaultRegistries.dataTypeEntries`** (`framework-components/src/shared/mutation-default-types.ts` lines 94-97) still carries the stack's data type entries to the attribute specs, under a name about defaults. Slice 2b moves them to the spec context (design section 20, `spec-contexts-carry-data-types`).
- **The TypeScript `sql` tag** still returns a `ColumnDefault` and runs the `@default` checks (`contract-ts/src/sql-default-literal.ts`). Slice 3 replaces it. A07 covers only the ADR sentence that describes the slice 3 state too early.
- **ADR numbering.** Three ADRs are numbered 255. This problem existed before the slice. Slice 2b should check the numbering before it writes ADR 256.
