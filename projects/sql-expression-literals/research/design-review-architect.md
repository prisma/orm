# System design review: SQL expression literals

Lens: architect (names, boundaries, typology, dependency direction). Reviewed `spec.md`, `design.md`, `plan.md` and `design-notes.md` in this project, against the code at `6a5b58ecb7` and ADRs 126, 129, 195, 231, 249 and 254. The two earlier correctness reviews (`wip/sql-expression-literals/review-design.md`, `review-design-2.md`) are not repeated, except where a fix they led to is wrong (A02).

## Summary

Verdict: the direction is right, but the design needs changes before implementation. Making raw SQL an ordinary typed value removes a special case (the lowering entry) and makes the system more uniform. The problems are about where new facts live and what they are called:

- The stack's data types are put inside a container named for `@default`.
- The family names `sql/expression` but does not own its declaration, so it does not own the rule that refuses plain strings.
- Typed block values are an optional field on the framework node, which a family fills in later.
- Several new names say something the types do not do.
- The ADR plan misses ADRs 249 and 195, and does not record that ADR 129 now adopts two alternatives it rejected.

No finding needs a settled decision to change. 19 findings.

## What is sound

- **One kind of entry.** Removing the lowering entry leaves one map of authoring entries, keyed only by data type ids. Assembly loses its reserved-key skips. `@default`, `contract infer` and the language server read tags from one place. This is a real reduction in concepts.
- **A family-named id that targets register.** Codec ids such as `sql/int@1` already work this way (`relational-core/src/ast/sql-codec-helpers.ts`). The id never appears in `contract.json`: data type ids are authoring-only, and no committed contract contains one. Assembly already refuses two registrations of one id, which protects the assumption that a stack has one target.
- **The cast rule in `framework-components/shared`.** Data types are a framework concept (ADR 254). The moved functions are family-blind. `psl-parser` and `contract-psl` depend on them in the right direction, and a future Mongo type system can use them.
- **`readWrittenLiteral` in `psl-parser`.** Reading PSL syntax into a written value belongs with the parser.
- **`dataTypeValue`.** This is the combinator ADR 254 promised. Its construction never throws, so the language server, which builds every spec only to list attribute names, keeps working.
- **Checks belong to the consumer.** The type has no content checks. `@default` keeps its own checks in `contract-psl` and in `.default()`. RLS predicates are free to contain `SELECT`. The type says what its values are; the default rules stay rules about defaults.
- **`@internal/sql-contract` as the shared home.** It is the lowest package that every consumer depends on (the "SPI at the lowest consuming layer" pattern). It imports only from the shared-plane `authoring` entry.
- **`EmbeddedSql` as its own DDL leaf, not `RawExpr`.** DDL and the query AST are separate bounded contexts. The `--` hazard is solved where it arises, in embedding, not in the type.
- **Stored forms stay strings.** The canonical form of `sql/expression` is a JSON string, so the contract IR, schema IR and hashes keep their current shape.
- **One printer for tagged literals.** `printTaggedLiteral` serves defaults and the new places alike. Removing `codecLookup` from the PSL printer is a real simplification.
- **Slice order.** The dependencies between slices match the order. The PSL slice regenerates its artefacts in the same dispatch as the refusal.

## Findings

### A01. The stack's data types live in a container named for `@default` (design §7)

- **Issue.** `ControlDefaultRegistries`, reached through `AttributeSpecContext.controlMutationDefaults`, gains `dataTypeLookup`. The type's own doc says it is "what an attribute spec needs to build its `@default` arms". After this project, `@@index`, `@@check` and `@@fullTextIndex` read the stack's data types from it. They do so through a new helper, `specDataTypeSupport`, which rebuilds `entries` and `lookup` from two fields. The language server already copies `dataTypeEntries` into `controlMutationDefaults` at two sites, and it returns nothing when mutation defaults are absent (`language-server/src/attribute-spec-resolution.ts:60-88`).
- **Why it matters.** ADR 249 says the construction-time context is framework-owned, and that "a family that needs a new fact widens it for everyone rather than adding a bespoke parameter". The stack's data types are now a fact for every spec, not a detail of `@default`. Read cold, `ctx.controlMutationDefaults.dataTypeLookup` tells a contributor that data types belong to mutation defaults, which is false. The helper exists only to hide this.
- **Correction.**
  - Add `readonly dataTypes: DataTypeSupport` to `AttributeSpecContext`.
  - Move `dataTypeEntries` out of `ControlDefaultRegistries`, so it again holds only the default-function registry.
  - Delete `specDataTypeSupport`. Specs read `ctx.dataTypes`, including `@default`'s tag arms.
  - Every site in §7 is edited anyway, so the extra cost is small.
  - The language server builds `dataTypes` whether or not mutation defaults are present.
  - Update ADR 249's context type and examples (see A09).

### A02. The family names `sql/expression` but each target writes its declaration (design §3.1, design-notes decision 4)

- **Issue.** The family exports the id and the authoring entry. Each target writes its own `dataType(SQL_EXPRESSION_DATA_TYPE_ID, {})`, as `pgSqlExpression` or `sqliteSqlExpression`. ADR 254 says casts are declared by a type's owner: "the owner of a type is the only one who decides what it takes". The spec and design §1 state a family rule: "`sql/expression` casts from nothing". But the declaration where casts are written is held by every target. A target could add a cast from its text type, and `where: "..."` would then be accepted on that target, with no change to the family. The names also mislead. The target prefix convention maps `pgText` to `pg/text`, but `pgSqlExpression` is `sql/expression`. Review 2 (finding 7) chose these names to avoid a clash with another export. That clash disappears if the declaration is not duplicated.
- **Why it matters.** The rule that refuses plain strings is owned by the family, which states it, and by every target, which enforces it. The two halves are also not symmetric: targets register the family's entry unchanged, but not the family's declaration.
- **Correction.**
  - Export `sqlExpressionDataType: DataType = dataType(SQL_EXPRESSION_DATA_TYPE_ID, {})` from `@internal/sql-contract/sql-expression`, next to the entry.
  - Each target appends that constant to its list and registers the entry. Both are registered unchanged.
  - Delete `pgSqlExpression` and `sqliteSqlExpression`.
  - This keeps decision 4 (each target registers the type) and makes the family the single owner of what the type is.

### A03. `sql/expression` is not a database type, but ADR 254 defines a data type as one (design §1, §18)

- **Issue.** ADR 254 opens: "A data type is a database type made first-class". Such a type has a DDL name, parameters and codecs, and "every column has one". `sql/expression` has no DDL name and no codec. It is never a column's type, and nothing casts from it. It is the type of an authoring value that Prisma passes to the database.
- **Why it matters.** The project adds a second kind of data type without saying so. ADR 254's follow-up work (DDL names, deriving `nativeType`, type constructors naming a type and a codec) assumes every data type is a column type. That work will meet a type with no DDL name, and needs to know this is intended. A fresh reader of ADR 254 will not expect `sql/expression` in the registry.
- **Correction.** The ADR 254 amendment states the wider definition in its Decision section, not only in examples:
  - Definition: a data type is the type of a value that Prisma stores or passes to the database. Most data types are database types. `sql/expression` is the type of SQL text in the target's language.
  - Invariants of `sql/expression`: its canonical form is a JSON string; it has no codec and no DDL name; it is never a column's type; it declares no casts; no type casts from it.
  - Tell the follow-up project that a DDL name is optional for such types.

### A04. Typed block values are an optional field on the framework node, set by a family (design §9.1-9.4)

- **Issue.** The design changes the block types like this:
  - `PslExtensionBlock` gains `typedValues?`, "absent before typing", which the SQL interpreter sets.
  - `PslExtensionBlockParamScalarValue` gains `written?`, "absent on nodes built for printing".
  - The Postgres lowering asserts `typedValues !== undefined`.

  Two existing patterns in the code point elsewhere:
  - Block attributes (ADR 249) are interpreted in the framework, during symbol-table construction (`buildSymbolTable` calls `interpretBlockAttributes`). Their results are attached to the node as plain data.
  - The other annotations the interpreter adds (`namespaceId`, `resolvedModelRefs`) are not declared on the framework node. They are declared on the target's block type (`RlsPolicyExtensionBlock`, `postgres/src/core/authoring.ts:135-144`) and in the SQL contract (`ResolvedPslModelRefs`).

  The design follows neither pattern.
- **Why it matters.**
  - One node type now stands for two phases, and every consumer must check which phase it has.
  - Every family that interprets blocks must remember to call a framework function that the descriptor already implies. The `invariant` in the Postgres lowering is the only thing that catches a missed call.
  - `written` and `WrittenLiteral` exist only to carry a half-finished result from reconstruction to the later typing step (A17).
  - The odd export choice in §9.3 (A14) also follows from this placement.
- **Correction (preferred).** Type `value` parameters where block attributes are interpreted:
  - Pass `DataTypeSupport` to `buildSymbolTable`.
  - Type each declared `value` parameter during reconstruction, and store the typed value on the parameter node.
  - Then `written` need not be stored, and refusals are ordinary parse diagnostics.
  - Costs: one more input to `buildSymbolTable`, whose callers hold the stack or its data types already; and a block with a bad model reference now also reports a bad `using`.
- **Correction (minimum).** Keep typing in the family. Declare `typedValues` as a required field on the type the factory receives (for example on `RlsPolicyExtensionBlock`, like `namespaceId`), not as an optional field on `PslExtensionBlock`.

### A05. "Typed value" means three different things (design §1, §4, §6, §9.1)

- **Issue.** The §1 vocabulary says a typed value is a value "after the ADR 254 cast rule has admitted it into a receiving data type". The code shapes do not match:
  - `TypedValue` (`{ type, value }`) is what `readWrittenValue` returns. That is before any cast, and it carries the value's own type.
  - `castTypedValue` returns a bare `JsonValue`, with no type.
  - `PslExtensionBlock.typedValues` holds bare `JsonValue`s.
  - `ParsedDataTypeValue` is a typed value plus a span, but it calls its field `dataType` where `TypedValue` says `type`.
- **Why it matters.** This is a homonym at the center of the new vocabulary. A reader who learns `TypedValue` from the code will misread the design's definition, and the reverse.
- **Correction.**
  - Define one concept: a typed value is a value with its data type, `{ type, value }`.
  - `castTypedValue` returns a `TypedValue` of the receiving type.
  - `ParsedDataTypeValue` is `TypedValue & { span }`, with the same field name.
  - `typedValues` either holds `TypedValue`s or is renamed for what it holds.
  - Fix the §1 vocabulary line.

### A06. One refusal has two sets of diagnostic codes (design §3.5, §6, §10, §13)

- **Issue.** The design makes one `@default` code general (`PSL_UNKNOWN_DEFAULT_LITERAL_TAG` becomes `PSL_UNKNOWN_LITERAL_TAG`) and keeps the others as they are:
  - The same "no cast" refusal is `PSL_DEFAULT_TYPE_INCOMPATIBLE` in `@default` and `PSL_VALUE_TYPE_INCOMPATIBLE` in `where:`.
  - The same "entry refused the text" refusal is `PSL_INVALID_DEFAULT_LITERAL` (or `PSL_INVALID_JSON_LITERAL`) in `@default` and `PSL_INVALID_LITERAL` elsewhere.
  - The messages differ too. `@default` lists what the type casts from; the new places say how a value is written.
  - `@default` still reads tagged literals through its own path (`taggedLiteral` combinator, `lowerTaggedLiteral`). It chooses the SQL expression path by the tag's entry, not by the value's type.
- **Why it matters.** ADR 254 says defaults and other positions "are admitted by one rule". The spec says a refusal "names the receiving type and says how a value of it is written". With two sets of codes, users and tools see the same rule under two names. Renaming one code but not its siblings also reads as an accident.
- **Correction.**
  - Refusals that come from the shared functions (`unknown-tag`, `unwritable`, `no-cast`, `unreadable`) use the general codes everywhere, including `@default`.
  - Default-only refusals keep default-only codes: `not-a-list`, the codec's refusal, and `PSL_INVALID_DEFAULT_SQL`.
  - Decide whether `PSL_INVALID_JSON_LITERAL` becomes a general code or goes away.
  - Use `describeWrittenForms` in the `@default` no-cast message too, or record why not.
  - In §10, choose the SQL expression path by the value's type after reading it (`typed.type === SQL_EXPRESSION_DATA_TYPE_ID`). That states the domain rule directly.
  - If this is too much for slice 2, record the split as tracked debt and keep only the unknown-tag rename.

### A07. `MigrationSqlText` gives the wrong reason and names its consumer in the core package (design §2, §16; design-notes decision 10; spec requirement 8)

- **Issue.** Decision 10 and the type's doc say the string arm exists only for files written before slice 4. But §16.2 falls back to a string literal whenever a body would not read back from a template: leading whitespace, a blank first line, a carriage return, and some whitespace-only lines. So slice 4 itself writes strings into new files, and the string arm is permanent. The type is also named for its consumer, migration files. It lives in `@internal/sql-contract`, the SQL core package, while its only consumers are `relational-core`'s contract-free factories and the targets' migration classes.
- **Why it matters.** The documented reason invites someone to delete the string arm later, which would break generated files. A consumer-named type in the core package tells readers that the contract layer knows about migration files.
- **Correction.**
  - Fix the reason in decision 10, in spec requirement 8 and in the doc comment. Migration functions take a string for two reasons: committed files use one, and the generator writes one when a template cannot hold the text unchanged.
  - Move `MigrationSqlText` and `sqlTextOf` to the lowest layer that uses them: `relational-core`'s `contract-free` module, next to `fn` and `embeddedSql`.
  - The Migration System doc records that the string arm is permanent.

### A08. ADR 129 now adopts two alternatives it rejected (design §6, §11.2)

- **Issue.**
  - **Checking the tag while parsing.** ADR 129 rejected checking the tag against the registry while parsing an attribute argument. Its reason: inside `oneOf`, a registry failure turns into a generic "Expected one of" message. `dataTypeValue` checks the tag while parsing. This is safe today only because no spec puts it inside `oneOf` (ADR 231's `oneOf` discards branch diagnostics).
  - **The family owning the `sql` tag.** ADR 129 rejected having the family own the unprefixed `sql` tag, because "nobody has promised the tag will never vary by target". Now the family defines `SQL_EXPRESSION_TAG` and the entry, and both targets register the entry unchanged. `contract infer` prints with the family constant rather than the registered entry, which assumes the tag is the same on every target.
- **Why it matters.** An ADR whose rejected alternatives are quietly in force misleads the next person who uses it to make a decision.
- **Correction.**
  - The amendment moves both alternatives from "rejected" into the decision, with the new reasons.
  - Record the rule that `dataTypeValue` must not be an arm of `oneOf`, because its message would be lost. State this in ADR 231 too, or make `oneOf` refuse such an arm.

### A09. The ADR plan misses ADR 249 and ADR 195, and under-specifies 126, 231 and 254 (design §18, spec "Place in the larger world")

- **ADR 249.** Its "At a glance" says `index` and `check` "ignore the context and return a hoisted constant". After this project they are built from the context. The context type also changes (A01). ADR 249 is not listed in §18.
- **ADR 195.** Its "Factory alignment" section says the rendered source calls the factories "with the same argument shapes" that the IR holds. After slice 4, the IR holds strings and the rendered file passes `SqlExpression` values. That is a deliberate exception, and it should be recorded. The spec's ADR 195 sentence is also inaccurate. `EmbeddedSql` sits in DDL nodes, and only some call classes hold DDL nodes (`CreateTableCall`, `AddColumnCall`); `CreateIndexCall`, `AddCheckConstraintCall` and the policy call hold strings. State the rule in the Migration System doc: call-class fields mirror the arguments of the migration method.
- **ADR 126.** The change is more than example lines:
  - ADR 126 gives a reason that this project reverses: a `value` parameter "rides the codec JSON medium", for parity with field types and defaults.
  - Its "Validate" section describes a parse-time validator that production never calls.
  - The amendment should state the new rule: a `value` parameter names a data type, and the cast rule admits it. It should say where typing actually runs, and that variadic enum member values are still typed by the enum's codec.
- **ADR 231.** Adding two names to the combinator list is not enough. ADR 231 says "Literal-to-codec compatibility remains a lowering concern", and lists deciding this as follow-up work. `dataTypeValue` decides it for positions with a fixed receiving type: the cast runs in the combinator. Record that. Also record that `@default` still casts during lowering, because its receiving type comes from the column. Add the `oneOf` rule from A08.
- **ADR 254, beyond A03.**
  - Only the scalar cast rule moves to the framework. List casts (`listCast`) stay in the SQL family's default reader, so the amendment must not say the whole cast rule is in the framework.
  - Step 2 of "Reading a default" ("a `sql` tag lowers") changes.
  - The TypeScript paragraph gains `SqlExpression`, a TypeScript value of a type that has no codec.

### A10. Record the decision in its own ADR (spec "ADR pointer", design §18, plan close-out)

- **Issue.** ADR 129 says of these places: "whether they move to tagged literals is a separate decision". This project is that decision. It changes ADRs 126, 129, 195, 231, 249 and 254. The plan spreads its reasons across two ADRs and a subsystem doc.
- **Why it matters.** After close-out, no single place answers the question: "why is raw SQL a typed value, and not a syntax check, per-target types or prefixed tags?"
- **Correction.** Write one new ADR, for example "Raw SQL is a value of the data type `sql/expression`". It holds design-notes decisions 1 to 7 and their rejected alternatives. Amend the other ADRs briefly and link to the new one. This changes the spec's ADR pointer, not a design-notes decision.

### A11. Some of the project's structural claims have no test (plan)

- **DoD bullet 1 has no test.** It requires one schema with every place, including a multi-line body, that is emitted, migrated onto real Postgres, verified, inferred and re-emitted identically. No slice owns a test for this. The existing `infer-roundtrip-fidelity*.e2e.test.ts` tests start from hand-written database SQL. Slice 2 only changes their expected text. Name the new test and its slice: slice 2 for PSL, extended in slice 3 with the TypeScript twin of the parity fixture.
- **The rule that refuses plain strings has no test.** That rule is "`sql/expression` casts from nothing, and nothing casts from it". With A02, add one test in `@internal/sql-contract` on the exported declaration. Add one assembly test per target stack that no registered type lists `sql/expression` as a cast source.
- **Nothing guards future raw-SQL places.** Add a test that builds every registered spec in `contract-psl` and the Postgres target. For each of the six places, it asserts that the argument is `dataTypeValue` of `sql/expression`, so a new place written with `str()` fails. This follows ADR 249's per-family key-set tests.
- Already sound: the parity fixture (slice 3) proves that PSL and TypeScript produce identical contracts, and `lint:framework-vocabulary` runs in slices 2 to 4.

### A12. `SqlExpression.body` names a value with a syntax word, and the text accessors disagree (design §2)

- **Issue.** A `SqlExpression` is a value of the data type `sql/expression`. "Body" is the tagged-literal syntax word (ADR 129's "canonical body"). The same SQL text is reached in five ways:
  - `SqlExpression.body`;
  - `EmbeddedSql.text`;
  - `sqlExpressionText(value: JsonValue)`, which reads cold as taking a `SqlExpression`;
  - `requireSqlExpression`, which returns a string, not a `SqlExpression`;
  - `sqlTextOf`.
- **Why it matters.** The operator has corrected this slip before: a tag and its body are PSL syntax; the data type and its values are the domain concept. A domain value should not carry a syntax word. Several accessors with different naming patterns for one fact make the surface harder to learn.
- **Correction.**
  - Name the field for the domain: `SqlExpression.text`, which matches `EmbeddedSql.text`.
  - `requireSqlExpression` returns the `SqlExpression`, as its name says, and callers read `.text`.
  - Rename `sqlExpressionText` so the name says it reads the canonical form, for example `sqlTextFromCanonical`.

### A13. `SqlExpression` does not own its invariant (design §2)

- **Issue.** The promise of identical contracts from PSL and TypeScript needs every `SqlExpression` to hold canonical text. Canonicalization runs in `sql`, not in the class. `@prisma/orm-family-sql/contract/sql-expression` publishes the class, and `new SqlExpression('  x')` builds a non-canonical value that the builder accepts.
- **Why it matters.** When an invariant is held by one factory and not by the type, anyone who can reach the type can bypass it. "Not documented for users" is not a structural guarantee.
- **Correction.** Either canonicalize in the constructor, so `sql` checks interpolation, resolves escapes and calls `new SqlExpression(text)`, or do not publish the value export.

### A14. `typeExtensionBlockValue(s)`: the name and the export entry (design §9.3)

- **Issue.**
  - "type" reads as a noun ("the type of extension block values") as easily as a verb.
  - The design exports these functions from `control`, not from `psl-ast`, where their caller and sibling `validateExtensionBlock` is exported. The stated reason is that "the SQL interpreter deliberately does not import `psl-ast`". That is not true of the package: `contract-psl` already imports `@internal/framework-components/psl-ast` in `sql-attribute-specs.ts` and `data-type-default.ts`. The comment at `interpreter.ts:192-200` is about one constant.
- **Why it matters.** When an export is placed to suit one importer's habit, one concept ends up spread across entries.
- **Correction.**
  - With A04's preferred correction, the function moves into `psl-parser` and this question goes away.
  - Otherwise, name it for what it does (for example `readBlockValueParameters`) and export it from `psl-ast`, next to `validateExtensionBlock`.
  - New names need not repeat the `Extension` qualifier. The family's `enum` block is also a `PslExtensionBlock`, so the qualifier marks no real partition. The descriptor types already drop it (`PslBlockParamValue`).

### A15. `tagsWriting` and `describeWrittenForms` do more than their names say (design §4)

- **Issue.** Both include the written forms of every type that the given type casts from. For example, `tagsWriting(support, 'pg/int8')` includes the tags of `pg/int2`. The names say "the tags that write T".
- **Why it matters.** A caller reading the name expects only T's own forms. The difference matters for completion and for refusal messages.
- **Correction.**
  - Use ADR 254's own word, "admitted": `admittedTags(support, T)` and `describeAdmittedForms(support, T)`.
  - Document them as "the forms a position of type T admits: T's own, and those of the types T casts from".
  - Match the doc of `DataTypeValueArgType.tags`.

### A16. `EmbeddedSql`: the name, the stated invariant, and an unused `kind` field (design §14, spec requirement 7)

- **Name.** "Embedded SQL" is an established term for SQL statements written inside a program in another language (embedded SQL in the SQL standard). A contributor reading `EmbeddedSql` in a TypeScript codebase will expect that meaning. The node's essence is SQL text that Prisma does not parse, and ADR 244 already calls such text "opaque". Consider `OpaqueSql`, with `opaqueSql` and `renderOpaqueSql`. If the team keeps the name, define it in the first sentence of the Migration System doc section.
- **Invariant.** Spec requirement 7 says the DDL holds a node "wherever the planner places raw SQL inside a larger statement". §14.3 lists four sites that build no node and wrap a string only to call the renderer: `addCheckConstraint`, both `buildColumnDefaultSql` functions, and `alterColumnType`. The true invariant is: every site that places contract SQL inside a statement renders it through `renderEmbeddedSql`. State that in the spec and the Migration System doc, and name the template-string sites as leftovers of the stalled typed-DDL project.
- **`kind` field.** `kind = 'embedded-sql'` has no union to tell it apart from. Drop it, or say which union it belongs to.

### A17. `WrittenLiteral` names the result of an attempt to read (design §4, §5, §9.1)

- **Issue.** `WrittenLiteral` is `{ ok: true, written } | { ok: false, reason }`. It sits beside `WrittenValue` and `WrittenScalar`, which are values, not results. On the block node, the field `written` can hold a failure. The type lives in framework core only because the half-read result is stored on the framework node (A04). Its failure reasons are facts about the PSL tokenizer.
- **Correction.** Name it as a result, for example `WrittenLiteralResult`. With A04's preferred correction, keep it inside `psl-parser` and do not store it on the node.

### A18. `renderTaggedTemplateSource` is in the wrong file, and `printTaggedLiteral` is exported twice (design §2, §11.1, §16.2)

- **Issue.** `renderTaggedTemplateSource` goes into `render-ts-literal.ts` and the `codec` entry, because `renderTsLiteral` is there. But `renderTsLiteral` renders codec values ("Renders a codec-encoded value"). The new function renders a tagged template: it is the TypeScript sibling of `printTaggedLiteral`. Also, `printTaggedLiteral` is new, yet it is exported from both `control` and `authoring`.
- **Correction.**
  - Put `renderTaggedTemplateSource` in `shared/tagged-literal.ts`, next to `printTaggedLiteral`. `framework-components` already depends on `ts-render`.
  - Export both from `authoring` only.
  - Use one name for the `usesTag` and `usesSqlTag` flags.

### A19. Small naming and symmetry items

- The upgrade change id `the-sql-lowering-entry-is-a-data-type` says an entry is a type. Suggest `the-sql-tag-writes-the-sql-expression-data-type`.
- `sqlExpressionLiteralText` is a thin wrapper over `printTaggedLiteral`. By the sibling's naming, it would be `printSqlExpressionLiteral`.
- §16.3 uses `SQL_EXPRESSION_TAG` (a PSL tag) as the name of the TypeScript template function, but writes the import symbol as the literal `'sql'`. Use one constant for both, or state the rule that the TypeScript tag function has the same name as the PSL tag.
- The language server's block keyword snippet (`genericBlockSnippet`, `completion-provider.ts:402-415`) inserts a bare placeholder for `using`. §12 gives attribute places a `` sql`...` `` placeholder. Give block parameters typed by a data type the same placeholder rule, so both kinds of typed position complete the same way.

## Challenges to settled decisions

None. I tested decision 4 (the family names an id that targets register) against ADR 254's rule that "no type spans targets", and it holds up. The id never reaches a contract. Assembly refuses a second registration, which protects the one-target-per-stack assumption. Codec ids already follow the same pattern. A02 and A03 change how the decision is recorded and who owns the declaration, not the decision itself.

## Referrals to the principal-engineer review

- `renderEmbeddedSql`: `--` inside string literals and quoted identifiers, unterminated `/* */` comments, and whether a trailing line break is safe at every site, including the index element list.
- Spec requirement 5: a body with leading whitespace changes its stored text but not its wire name. The plan names no test for this.
- The window between slices 2 and 3, when PSL refuses strings and TypeScript still accepts them. Check that no committed TypeScript fixture has a multi-line body.
- `importRequirements()` recomputes `S(text)` over the same texts that `renderTypeScript()` renders. The two can drift apart.
- Runtime behaviour of `isSqlExpression` across duplicated package copies (`Symbol.for`), and of `requireSqlExpression` for JavaScript callers.
- `contract infer` does not check that a printed SQL body reads back unchanged (§11.2). What happens if Postgres ever reprints a body in a shape that canonicalization changes.
- The unwired `validateExtensionBlock` is kept and updated. Decide whether to wire it or delete it.
- `.default({ kind: 'function', expression })` in TypeScript skips canonicalization and the default checks. Confirm the planner's checks cover it.
- The language server's fallback to `createDataTypeLookup([])`, and the detection patterns in the upgrade fragments.
