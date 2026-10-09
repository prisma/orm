# Slice 3 system design review: the TypeScript builder takes `sql` values (TML-3289)

## Scope

Branch `tml-3289-sql-expression-ts` against slice 2b's branch `tml-3288-sql-expression-places`, commits `7db66e9278` to `4f13b1b958` plus the merge `1bd6a49b61`. I read the code at HEAD, the diff outside `projects/`, the spec (cross-cutting requirements 3, 4, 5 and 9), design sections 2, 11.2, 13, 15, 18.4, 19 and 20, the design notes, the implementer brief, the status entry for slice 3, ADRs 129, 254 and 260 as amended, the error reference, the contract-ts README, and both upgrade fragments. I did not run builds or tests.

## What the slice adds

- `SqlExpression`, `isSqlExpression`, `sql` and `requireSqlExpression` in `@internal/sql-contract/sql-expression`, with the codes `CONTRACT.SQL_EXPRESSION_INTERPOLATION` and `CONTRACT.SQL_EXPRESSION_INVALID`.
- `sqlExpressionRegistration`, one value that the family descriptor and four test fixtures use to register `sql/expression`.
- The TypeScript builder's raw-SQL fields (`index` `where` and `expression`, `check` `expression`, `fullTextIndex` `where`, a policy's `using` and `withCheck`) take only `SqlExpression`. Lowering reads them through `requireSqlExpression`.
- `.default()` takes a `SqlExpression` and runs the reserved-function and unsafe-SQL checks that the tag used to run.
- `contract print` refuses a column default whose text would not read back. `contract infer` prints it and adds a note.
- A parity fixture `test/integration/test/authoring/parity/sql-expressions/`, upgrade fragments for both audiences, and doc and ADR updates.

## Subsystem fit

The shape is right. The value lives at the lowest layer that every consumer depends on (the SQL family's shared `sql-contract` package). The tag, the value and the run-time check sit together with the data type and its authoring entry, so the TypeScript value and the PSL literal of `sql/expression` are defined in one module. The checks specific to defaults moved to `.default()` in `contract-ts`, which matches requirement 3: the place that receives the value owns the checks on its text.

Boundaries hold. The framework gains only two exports on its shared `authoring` entry (`describeTaggedLiteralFailure`, `resolveTemplateTagEscapes`), with no SQL vocabulary. The Postgres extension and the Postgres target import only the `SqlExpression` type and `requireSqlExpression` from the family's shared module. The public shells re-export one built copy of the module from `@prisma/orm-family-sql`, so the class and its marker symbol are not duplicated across published packages. The definition tree (`IndexNode`, `CheckNode`) and the contract stay strings, so nothing after lowering changes.

The class is the right choice. An object type with a `text` field would be assignable to the JSON value a literal default takes, and `.default()` could not tell raw SQL from a literal object. A class instance has a symbol-keyed member an object literal lacks, and `isColumnDefaultLiteralInputValue` refuses class instances. `toColumnDefault` tests `isSqlExpression` before anything else, so the order is safe. The `Symbol.for` marker keeps `isSqlExpression` working if two installed copies meet.

`indexExpressionText` tests `isSqlExpression`, then `'render' in`, then refuses. That order is required, because `'render' in` a string throws a `TypeError`.

## Naming and typology

- `SqlExpression` names the TypeScript value of `sql/expression`. The docs use "a `sql` value" for it consistently, beside "a `sql` literal" for PSL. Good.
- `requireSqlExpression(value, what)` follows the repository's `require*` convention. The `what` strings name the field but not the object that owns it (A04).
- `sqlExpressionRegistration` uses the key `authoring` for what the family descriptor calls `authoring.dataTypes` (A06).
- The new codes follow the family's `CONTRACT.*` pattern. The rename from `DEFAULT_SQL_INTERPOLATION` to `SQL_EXPRESSION_INTERPOLATION` is correct, because the tag no longer belongs to defaults.

## ADR review

- ADR 129: the new section on the TypeScript tag is clear and has three good rejected alternatives. Two defects: the old infer bullet still says a default is printed without the read-back check, and it repeats three sentences of the new bullet (A02). The claim that the two languages emit byte-identical contracts for the same SQL does not mention interpolation (A01).
- ADR 254: the TypeScript paragraph states a general rule for all types without a codec, which nobody decided (A08).
- ADR 260: the status line and the TypeScript section now describe the end state. The example compiles against the public `@prisma/orm-postgres/contract-builder` exports. The default exception is recorded as a consequence and as a rejected alternative; its reason is worded as a remedy, not as a principle (A03).
- ADRs 234, 236, 243, 244 and the adapters subsystem doc: the TypeScript examples use `sql` values. No plain-string raw SQL remains in `docs/`, `skills/`, `skills-contrib/` or package READMEs (I re-ran the grep).
- Error reference: the `CONTRACT.*` rows match design section 13.

## Test strategy at the architectural level

The layers are tested where they live: type tests for the tag and every builder field (`sql-expression.test-d.ts`, `raw-sql-fields.test-d.ts`, `rls-handles.test-d.ts`, `full-text-index.test-d.ts`, each with a `not.toBeAny()` sentinel); unit tests for canonicalization, escapes, interpolation and refusals in `sql-expression.test.ts`; run-time refusals of strings in lowering for indexes, checks and policies; `.default()` checks; the infer note and the print refusal for defaults. The parity fixture checks requirement 4 for indented multi-line text, an expression index, a full-text index, a backslash and a single-line interpolation, against one committed `expected.contract.json` for both sources. It does not cover a multi-line value interpolated into an indented template, which is the one case where the two languages differ (A01).

## Findings

### A01. Interpolating a multi-line `sql` value breaks requirement 4, and the end-state docs do not say so

Location: packages/2-sql/1-core/contract/src/sql-expression.ts lines 124-144; docs/architecture docs/adrs/ADR 129 - Template-Tagged Literals for Extensions.md line 72; packages/2-sql/2-authoring/contract-ts/README.md line 118; test/integration/test/authoring/parity/sql-expressions/contract.ts lines 20 and 59.

Issue: `sql` inserts an interpolated value's canonical text as it is, then canonicalizes the joined text once. A canonical multi-line value has continuation lines with no indentation. Inside an indented template those lines set the common indentation to zero, so no indentation is removed from any line of the template, not only from the value's first line. Example: `` sql`\n    ${twoLines}\n    AND x\n` `` stores `"    a\nb\n    AND x"`. A PSL author who writes the same SQL gets `"a\nb\nAND x"`. Requirement 4 says interpolation gives a byte-identical contract. Design section 2 describes the effect as "keeps the template's indentation on its first line only", which understates it. Only the transient upgrade fragments mention it; ADR 129, ADR 260 and the README do not. No test covers the case, and the parity fixture interpolates only a single-line value.

Suggestion: in `sql`, prefix each continuation line of an interpolated value with the leading whitespace of the template line where the `${…}` sits, then canonicalize. The joined text is then what the author sees, and it canonicalizes as the equal PSL literal does. Add a unit test and a parity case: a multi-line policy predicate interpolated into an indented `withCheck`. If you keep the current behaviour instead, correct the wording in design section 2, state the limit in ADR 129 and the README, and qualify requirement 4 in the spec.

### A02. ADR 129 contradicts itself on printing defaults

Location: docs/architecture docs/adrs/ADR 129 - Template-Tagged Literals for Extensions.md lines 147-148.

Issue: line 147 still ends with "A default's expression is printed without this check", followed by three sentences about `resolvedDefaultsEqual` and string constants. Line 148, added in this slice, repeats those three sentences word for word and then says `contract print` refuses such a default. A reader meets two statements that disagree. Line 148 also says a contract holds a non-canonical default only when it was built before this release or through `.default({ kind: 'function', expression })`; `.defaultSql('...')`, still present until 8.0.0, stores its text unchanged too.

Suggestion: end line 147 at "`contract print` refuses any object whose text would not read back, with `CONTRACT.PRINT_UNSUPPORTED`." Keep line 148 as the only statement about defaults, and add `.defaultSql()` to its list of paths.

### A03. The infer and print asymmetry is explained in five places, with a reason that is a remedy

Location: docs/architecture docs/adrs/ADR 129 - Template-Tagged Literals for Extensions.md line 148; docs/architecture docs/adrs/ADR 260 - Raw SQL is a value of the data type sql-expression.md the consequence bullet on column defaults and the matching rejected alternative; docs/reference/error-reference.md `CONTRACT.PRINT_UNSUPPORTED`; projects/sql-expression-literals/design.md section 11.2; upgrade-instructions/pending/sql-expression-literals-ts/app/instructions.md line 81.

Issue: each place restates the rule with its own wording. The stated reason for the print refusal, "its input is a contract, which the author fixes at its source", says how to fix the problem, not why the two commands differ. The reason is what each command must preserve: `contract print` must produce PSL that emits the same contract, so any text that changes on read-back is a failure; `contract infer` must describe the database without making the next plan destructive, so dropping a default is worse than a changed constant.

Suggestion: state the rule once, in ADR 260 (the decision record of this project), in terms of what each command preserves. ADR 129 and the error reference keep one sentence each and link to ADR 260.

### A04. `requireSqlExpression` errors do not say which object is wrong

Location: packages/2-sql/2-authoring/contract-ts/src/contract-lowering.ts lines 860, 925 and 947; packages/3-targets/3-targets/postgres/src/core/authoring.ts lines 931 and 1092-1093.

Issue: the messages are `Index "where" must be a sql`...` value.` and similar. A contract with many models gives no hint where the string is. Neighbouring lowering errors name the model, field or policy prefix (for example `Model "${spec.modelName}" defines an empty unique constraint`, `defineContract: policy "${prefix}" targets model …`). A string in `fullTextIndex` `where` is reported as `Index "where"`, a name the author did not write. These errors reach only JavaScript that is not type-checked, which is exactly the user who has no compiler to point at the line.

Suggestion: build `what` with the owner, for example `Index "post_user_active" "where" on model "Post"` and `Policy "post_owner_write" "using"`, and add `modelName` or `prefix` to the meta. The strings are fixed in design section 15, so change the design first.

### A05. Orphaned doc comment on the print refusal

Location: packages/3-targets/3-targets/postgres/src/core/psl-print/refusals.ts lines 605-617 and 635.

Issue: the doc block "Refuses an index, check or policy whose SQL …" now sits above `type SqlTextOwner`, not above `refuseSqlTextThatDoesNotReadBack`, and it does not mention the new `default` kind. The rule `jsdoc-line-width.mdc` asks to avoid orphaned doc blocks.

Suggestion: move the block to `refuseSqlTextThatDoesNotReadBack` and say "an index, check, policy or column default".

### A06. `sqlExpressionRegistration` names its parts differently from the descriptor it feeds

Location: packages/2-sql/1-core/contract/src/sql-expression.ts lines 30-37; packages/2-sql/9-family/src/core/control-descriptor.ts lines 20 and 27.

Issue: the registration's key `authoring` holds the authoring entries keyed by data type id. The family descriptor stores them under `authoring.dataTypes`. The result reads `dataTypes: sqlExpressionRegistration.authoring`, which suggests the whole authoring contribution is assigned to a data-types field.

Suggestion: mirror the descriptor: `{ dataTypes: [...], authoring: { dataTypes: { [id]: entry } } }`, so the descriptor reads `dataTypes: registration.authoring.dataTypes`. Update the four fixtures and the language-server test that spread it.

### A07. Text from `DeferredIndexExpression.render` is not canonicalized

Location: packages/2-sql/2-authoring/contract-ts/src/contract-lowering.ts lines 851-860.

Issue: design section 15.5 keeps `render` returning a string, which is right. But lowering stores that string as it is. Every other TypeScript raw-SQL text is now canonical, and ADR 129 line 148 relies on that ("Every `sql` literal and every TypeScript `sql` value is canonical"). A `render` that returns indented multi-line text gives a contract that `contract print` refuses, and a stored text no PSL literal can produce.

Suggestion: canonicalize the rendered text in lowering, for example `new SqlExpression(expression.render(...)).text`, so `render` keeps its string signature and every raw-SQL text in a TypeScript-built contract is canonical. Add one test with a multi-line `render`.

### A08. ADR 254 states a rule for all types without a codec

Location: docs/architecture docs/adrs/ADR 254 - Data types and casts.md line 191.

Issue: "A type that has no codec has a TypeScript value of its own instead" reads as a general rule. Line 77 of the same ADR says `sql/expression` is the only such type, and no decision was made about future ones.

Suggestion: name the one case: "`sql/expression` has no codec, so it has a TypeScript value of its own: `SqlExpression`, made by the `sql` template tag …".

### A09. The infer note for defaults is only in the TypeScript fragment, under an unrelated change id

Location: upgrade-instructions/pending/sql-expression-literals-ts/app/instructions.md lines 25-30 and 81.

Issue: the new `contract infer` note and the `contract print` refusal for defaults are command behaviour, not TypeScript builder behaviour. A project that writes only PSL and runs `contract infer` is affected too. The text sits inside `storage-hash-may-change-once`, whose detection pattern matches TypeScript raw-SQL fields, so an upgrade run on a PSL-only project never shows it.

Suggestion: give it its own change id in the app fragment, for example `infer-notes-defaults-that-do-not-read-back`, with a detection pattern that matches projects that use `contract infer` or `@default(sql` in `**/*.prisma`, and test that pattern against a true positive and the nearest false positive as the record-upgrade-instructions skill requires.

## Checked with no issue

- `lint:deps` direction: framework to family to target to extension; no SQL vocabulary added to the framework.
- No builder facade exports the `SqlExpression` class as a value; the type test asserts it.
- The `.default()` checks run on the canonical text and use the exact messages of design section 15.2; `now()`, `autoincrement()` and the `{ kind: 'function' }` object still work.
- `DEFAULT_SQL_INTERPOLATION` is removed from code and docs, outside historical records.
- `sql-default-literal.ts` is deleted and nothing imports it.
- The error-reference rows for `CONTRACT.ARGUMENT_INVALID`, `CONTRACT.DEFAULT_INVALID`, `CONTRACT.SQL_EXPRESSION_INTERPOLATION`, `CONTRACT.SQL_EXPRESSION_INVALID` and `CONTRACT.PRINT_UNSUPPORTED` match the code.
- The extension fragment's supersede notes name the released fragments they replace.
