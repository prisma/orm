# System design review: slice 2t wording (cast-rule refusals lead with what to write)

Range: `bot/tml-3367-data-type-value...HEAD` (four commits, `f30e96104b` to `d8b7ff1983`). Spec: [2t-wording-brief.md](../../dispatches/2t-wording-brief.md) and item 15 of [design-notes.md](../../design-notes.md). Lens: architect.

## Verdict

The code change is small and sits in the right place. The wording of every cast-rule refusal now has one owner, `describeRefusal` in framework-components, and the new `DataTypeSupport` parameter does not change any dependency direction. The weak part of the range is the ADR 231 paragraph that answers Serhii. Its conclusion is right, but the test it gives for "grammar or database value" does not classify the kit's own combinators correctly, and ADR 254 still says the opposite about `nanoid(8)`. Fix B01 to B04 before the PR goes back to Serhii; the rest are small.

## The problem and the invariants

The problem: a refusal such as `pg/int4 has no cast from pg/text; write a number` makes the schema author read two type ids before learning what to type. The change moves the instruction to the front and keeps the type ids only where they explain a refusal the author could not otherwise understand: a value written in an admitted form whose type is still refused (`Expected a number that pg/int4 can hold; got pg/int8`).

The invariants the range must keep:

1. One wording of the cast rule. Every consumer (`dataTypeValue`, `@default` lowering) words a cast-rule refusal through `describeRefusal` and adds only a location prefix (design-notes item 14).
2. Codes, spans and refusal structure do not change; only message text does (brief, "Why").
3. A suggested rewrite is a literal the author can paste, and it reads back as the same value (new: `taggedLiteralTextReadsBack`).
4. Docs that quote messages match the code.

Invariants 2 and 3 hold. Invariant 1 holds for the scalar arms but not for the rewrite (B04) or the list arm (B06). Invariant 4 has stale spots (B01, B10).

## Subsystem fit and boundary correctness

**Where the wording lives.** framework-components (`packages/1-framework/1-core/framework-components/src/shared/written-value.ts`) owns the cast rule and now owns its wording. psl-parser's `dataTypeValue` and contract-psl's `lowerDataTypeDefault` consume it. That matches the layering: both consumers sit above framework-components, and the family-specific list arms stay in contract-psl, as the module header says ("list casts stay with the family that reads lists").

**The `DataTypeSupport` parameter on `describeRefusal`.** This is the right direction. `describeRefusal` needs the value type's written form, which is a registry query (`writtenFormPhrase(support, valueType)`) implemented in the same module. Both callers already hold `support`. The alternative, callers precomputing a "same form" boolean, would push a wording rule (when to name types) into every consumer, which is exactly what invariant 1 forbids. Keep the parameter.

One structural weakness comes with it: the "same form" test compares display strings (`guidance.forms.includes(valueForm)`). The phrase is both the identity of a form and its English rendering. Today the phrases are unique per form, so it works; see B05 for the cheap way to make the identity structural.

**Where the rewrite policy lives.** It does not live with the wording. The rule "a quoted string refused by a type with a tag gets the exact literal, when it reads back" is computed in psl-parser (`data-type-value.ts`, lines 80 to 87). contract-psl passes `rewrite: undefined` always. So the framework owns the sentence shape but not the decision of what goes in it, and the two consumers give different help for the same refusal. See B04.

## Naming and typology

- **`RefusalGuidance` (`{ forms, rewrite }`).** Reads cold as "what the refusal tells the author to do", which is what it is. The required-key `rewrite: string | undefined` follows the repo rule. Acceptable. `rewrite` is a printed literal, not an instruction; `literal` would read slightly truer, but this is not worth a change.
- **`forms` versus `admittedFormPhrases`.** The field is called `forms`; the function that fills it is called `...FormPhrases`; the code then uses the phrases as form identities. One concept, two names, and a name that hides that the value is prose. See B05.
- **`admittedFormPhrases` versus `describeAdmittedForms`.** Symmetric siblings: one returns the list, one returns the joined sentence fragment, and the `describe*` prefix matches `describeRefusal` and `describeTaggedLiteralFailure`. Fine. `describeAdmittedForms` now has one production use (the `dataTypeValue` label and its not-a-literal message), so it earns its keep only narrowly.
- **`taggedLiteralTextReadsBack`.** Reads cold as a property of the text ("does this text read back?"), but it is a property of `printTaggedLiteral` applied to the text. A fresh contributor will not guess the relationship from the name. It also exposes that `printTaggedLiteral`'s doc comment promises more than the printer does. See B08.
- **`NO_WRITTEN_FORM` made private.** Good: callers no longer filter on a sentinel string.

## The ADR 231 paragraph

The paragraph answers the right question. `str()` asks "is this a string"; `dataTypeValue(T)` asks "which data type is this value, and does `T` take it". A table name has no data type, and `"8"` and `8` are different values. That distinction is real and worth recording, and it is the honest answer to Serhii.

It does not yet let a reader re-evaluate a new argument, for three reasons.

1. **The test misclassifies arguments.** The paragraph defines a database value as one "Prisma stores or passes to the database" and grammar as something "the database never stores or compares". `@@map("users")` is passed to the database in `CREATE TABLE` and stored in its catalog. `VarChar(255)` and Mongo text-index weights (`record(int({min, max}))`) are passed in DDL. By the stated test these are database values, yet they are clearly grammar. The definition is inherited from ADR 254's definition of a data type (line 9), where it works because it qualifies "value"; as a test for arguments it does not. See B02.
2. **The claim "`@default` is the one database position still read through grammar combinators" is false in the kit.** Enum member values (`sqlFamilyEnumSpec`, `jsonValue()`, documented as "the stored member value") are stored in a column and checked by the codec, not the cast rule. Mongo's partial index filter (`json()`) is an expression the database evaluates. See B02.
3. **The partition does not list the whole kit.** `int()`, `numLiteral()`, `entityRef()`, `referencedFieldRef()`, `json()`, `jsonValue()`, `taggedLiteral()` and `funcCall()` are not classified. `numLiteral()` and `taggedLiteral()` exist for `@default`, a database position. See B03.

Against the three cases named in the brief:

- `@default`: handled honestly; the ADR names it as the exception and says why (the receiving type comes from the column) and what removes it (follow-up work).
- `nanoid(8)`: the conclusion (grammar, a client-side generator parameter) is sound, but ADR 254 lines 40 and 181 and design-notes item 14 still plan `nanoid`'s size as `pg/int4` on Postgres. Two accepted ADRs now disagree. See B01.
- `int({min, max})`: fits grammar under a better test ("does the database hold or evaluate this as a value of a data type?"); under the written test it is ambiguous when it feeds DDL.

## Are the message rules stated once and consistently?

| Place | Leads with forms | Range rule | Rewrite rule | List arms |
| --- | --- | --- | --- | --- |
| ADR 254 line 179 | example only | example | not stated | not stated |
| ADR 231 "Values of a data type" | yes | yes | yes, for `dataTypeValue` | n/a |
| `docs/reference/error-reference.md` `PSL_VALUE_TYPE_INCOMPATIBLE` | yes | yes | yes, stated for the code as a whole | yes |
| upgrade fragments `arguments-typed-by-data-type` | table rows | yes | `@default("{}")` row shows no rewrite | yes |
| `design.md` section 4 (line 209) and section 6 | yes | yes | yes, "the caller chooses" | section 4 (line 212) |
| `design.md` line 274 | stale: old message | | | |

The error reference states the rewrite rule as a rule of the code, while `@default` never applies it, and the upgrade fragment shows the case where it does not (B04). `design.md` line 274 still quotes the old message (B10). Otherwise the docs agree with each other and with the code.

## Test strategy (architectural level)

The framework unit tests (`written-value.test.ts`) cover each wording rule once: other form, several forms, rewrite, same form, unwritable. psl-parser covers the read-back refusal and the range rule end to end; contract-psl covers the `@default` arms including `pg/numeric` for `1.5`. That is the right pyramid for a wording change.

Two gaps follow from the boundary findings:

- Nothing checks that `dataTypeValue` and `@default` word the same refusal the same way, which is the promise of design-notes item 14. A small table-driven test that runs the same written value and receiving type through both paths would lock invariant 1 (and would fail today for a string on a tag type, B04).
- `taggedLiteralTextReadsBack` is tested by examples against the canonicalizer, but nothing checks that the suggested rewrite, parsed by the real PSL parser, yields the same value. One test in psl-parser that parses the printed rewrite back through `dataTypeValue` would make invariant 3 non-vacuous.

## Findings

### Architect-class

**B01 (high). ADR 254 and ADR 231 disagree about `nanoid(8)`.**
Location: `docs/architecture docs/adrs/ADR 254 - Data types and casts.md` lines 40 and 181; `projects/sql-expression-literals/design-notes.md` lines 55, 103 and 105 (items 6 and 14); `projects/sql-expression-literals/design.md` lines 274 and 758.
Issue: ADR 231 now says the size in `nanoid(8)` is grammar, "whatever the column's type". ADR 254 motivates itself with "the `8` in `nanoid(8)` and the `8` in `@default(8)` ... are the same thing" and says `nanoid`'s size parameter "will be `pg/int4` on Postgres". Item 14 still plans the "Data types own column types" project's reuse of `dataTypeValue` for `nanoid(8)`. A reader of either ADR gets the opposite decision from the other.
Suggestion: in ADR 254, replace the `nanoid` example on line 40 with a database-value example (a `@@index(where:)` predicate against a column default), and change the "A call" bullet on line 181 to say a parameter names a data type only when the database receives the argument; generator parameters stay grammar. Add a line to item 14 that item 15 narrows it, and tell the "Data types own column types" project its planned `nanoid` typing is withdrawn.

**B02 (high). The grammar-versus-database-value test does not classify the kit correctly.**
Location: `docs/architecture docs/adrs/ADR 231 - Declarative attribute specifications.md`, "The combinator kit", the two bullets and the paragraph after them.
Issue: "stores or passes to the database" also covers `@@map` names, `VarChar(255)` and text-index weights, which are grammar. "`@default` is the one database position still read through grammar combinators" is false: SQL and Mongo enum member values (`jsonValue()`, stored in the column) and Mongo's partial filter (`json()`, evaluated by the database) are database values read through grammar.
Suggestion: state the test as "a database value is a value of a data type: one a column holds, or an expression the database evaluates; everything else, including names and DDL parameters, is grammar". Then list the known exceptions read through grammar, each with its reason: `@default` (receiving type unknown to the spec factory), enum member values (checked by the enum's codec), and the Mongo partial filter (the Mongo family has no data-type registry for filters).

**B03 (medium). The two sets do not list the whole kit.**
Location: same ADR 231 section.
Issue: eight combinators are unclassified, so a reader cannot check the partition or place a new combinator.
Suggestion: a two-column list or table: grammar (`str`, `num`, `int`, `bool`, `identifier`, `fieldRef`, `referencedFieldRef`, `entityRef`, `list`, `record`, `oneOf`, `funcCall`, `json`) and database values (`dataTypeValue`; `numLiteral`, `taggedLiteral` and `jsonValue` as grammar-shaped readers serving the exceptions in B02).

**B04 (medium). The rewrite policy sits in one consumer, so `@default` and `dataTypeValue` give different help for the same refusal.**
Location: `packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/data-type-value.ts` lines 80 to 87; `packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts` line 383 (`rewrite: undefined`); `docs/reference/error-reference.md` `PSL_VALUE_TYPE_INCOMPATIBLE`; `upgrade-instructions/pending/arguments-typed-by-data-type/{app,extension}/instructions.md` row `meta Jsonb @default("{}")`.
Issue: `where: "(x)"` gets ``write sql`(x)` ``; `Jsonb @default("{}")` gets only ``Expected json`...` ``, though ``json`{}` `` is the exact fix. The error reference states the rewrite as a rule of the code, which `@default` does not follow. The framework owns the sentence but not the decision.
Suggestion: move the rewrite decision into framework-components beside `describeRefusal`, for example a `refusalGuidance(support, receivingTypes, written)` that returns `{ forms, rewrite }` (string written value, a receiving type with a tag, text reads back). Use it in both consumers, so `@default` takes the rewrite too and the fragment row gains it. If `@default` is meant to stay without a rewrite, say so in the error reference and in ADR 231 instead.

**B05 (low). Form identity is a display string.**
Location: `written-value.ts`, `RefusalGuidance.forms`, `noCastMessage`, `admittedFormPhrases`.
Issue: the "same form" decision compares English phrases, and the field `forms` holds phrases produced by `admittedFormPhrases`. A future change to a phrase (for example "a whole number") would silently change which messages name types.
Suggestion: either rename the field `formPhrases` so the type says what it holds, or (better) introduce a small structural form value (`{ kind: 'tag'; tag } | { kind: 'plain'; syntax }`), compare those, and render phrases only in `joinForms`. Acceptable to record as debt if B04 is done first, since B04 touches the same type.

**B06 (low). The "Expected <forms>" rule is written in two packages and two punctuations.**
Location: `data-type-default.ts` line 403 (`forms.join(' or ')`, re-implementing the private `joinForms`); `data-type-value.ts` line 66 (`Expected ${forms}, got ${literal.found}` with a comma, against `; got` in the new messages).
Issue: the list arm and the not-a-literal message restate the framework's sentence shape by hand, so the next wording change has three places to edit.
Suggestion: export one helper from framework-components that renders `Expected <forms>` from a forms list (and takes an optional `got` clause), use it in all three places, and settle on `; got`.

**B07 (low). The list-element arm borrows a `no-cast` refusal whose fields mean something else.**
Location: `data-type-default.ts` lines 407 to 417.
Issue: the fabricated refusal puts the list cast's element types in `casts` and the column's type in `receivingType`. When the range rule fires, the message reads ``Expected a number that pgvector/vector can hold`` although a vector holds a list, not a number. Nothing reads `casts`, which hides the mismatch.
Suggestion: give `describeRefusal` (or the helper in B06) an explicit receiver phrase, so the element case can say `that the list cast of pgvector/vector takes`, or document the wording choice in the error reference. Low priority if no shipped list cast can reach the range rule.

**B08 (low). The new predicate exposes that `printTaggedLiteral` overclaims.**
Location: `packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts`, doc comment of `printTaggedLiteral` and `taggedLiteralTextReadsBack`.
Issue: the printer's doc says it returns "the PSL text of a tagged literal whose canonical text is `text`"; the new tests show it does not for texts with leading indentation, a blank first line of spaces or a carriage return. Two other callers use the printer without the check: `printSqlExpressionLiteral` (`packages/2-sql/1-core/contract/src/sql-expression.ts`, used by `contract infer`) and `literalText` (`packages/2-sql/9-family/src/core/psl-build/default-mapping.ts`).
Suggestion: state the precondition in the printer's doc and name the predicate after the printer (`printedTaggedLiteralReadsBack` or `printTaggedLiteralRoundTrips`). Check separately whether infer can receive such text from a database; if it can, that is a round-trip bug for the infer project, not for this slice.

**B09 (low). ADR 231 says `dataTypeValue` is used as a `funcCall` parameter, but its planned consumers are attribute parameters.**
Location: ADR 231, "Values of a data type", third paragraph; `design.md` line 274.
Issue: with `nanoid` withdrawn (B01), the remaining consumers in slice 3 (`@@index(where:)`, `@@check(expression:)`, `@@fullTextIndex(where:)`, policy `using`/`withCheck`) use `optional(dataTypeValue(...))` as attribute parameters. The rule reads as if `funcCall` were the only home.
Suggestion: "`dataTypeValue` is used as a parameter of an attribute or a `funcCall`, never as a bare arm of `oneOf`, whose aggregate diagnostic would hide ...".

**B10 (low). One doc still quotes the old message.**
Location: `projects/sql-expression-literals/design.md` line 274.
Issue: ``reports `pg/int4 has no cast from pg/text; write a number` at `"8"` `` is the pre-change wording, in a section the brief asked to sweep. The example is also the `nanoid` case B01 withdraws.
Suggestion: replace the example with an attribute parameter (`@@index(where: 8)` reporting ``Expected sql`...` ``) and the new message.

### Buildability (route to the code review)

- `describeRefusal` with an empty `forms` list produces `Expected no written form`. `@default` substitutes ``sql`...` ``, but `dataTypeValue` on a type nothing writes would show this text. Decide whether this is reachable (a spec naming such a type) and either refuse it when the spec is built or word it.
- `parseDataTypeValue` computes the forms twice (`describeAdmittedForms` on line 59 and `admittedFormPhrases` on line 74).
- `isPrintedOnOwnLines` repeats the backtick check that `printTaggedLiteral` already returned on; harmless but redundant inside the printer.
- The two missing tests named under "Test strategy": a parity test between `@default` and `dataTypeValue`, and a read-back test that parses the suggested rewrite.
