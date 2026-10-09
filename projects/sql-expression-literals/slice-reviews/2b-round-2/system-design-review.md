# Slice 2b, round 2: system design review

## Scope

- Slice: 2b, "The six places take `sql` literals" (TML-3288). Branch `tml-3288-sql-expression-places`.
- Range: the review fixes, `d951834e1e..affe4190da` (16 commits). Diff read with `git diff d951834e1e HEAD -- . ':!projects'` (51 files). Code read at HEAD.
- Decisions checked against: `dispatches/2b-review-fixes-brief.md` and the one recorded deviation in `dispatches/2b-review-fixes-findings.md` (defaults print through `printTaggedLiteral`, not the throwing `printSqlExpressionLiteral`).
- Lens: system shape, names, boundaries, typology, conceptual minimality. Test strength and implementation correctness belong to the code reviewer.

## Round 1 findings against their decisions

| Finding | Decision | Result | Commit |
|---|---|---|---|
| A01 | The printer throws; one shared predicate; skip and refuse stay at the command level | Fixed as decided. `printSqlExpressionLiteral` throws; `sqlTextsReadBack` replaces the three copies; `mapDefault` uses `printTaggedLiteral`, as the recorded deviation says | 4c90654da5 |
| A02 | One tag-agnostic predicate next to `printTaggedLiteral`, exported from `/authoring`; drop the `/control` export | Fixed as decided. The result type `TaggedLiteralCanonicalization` stayed on `/control` (B05) | 497209f40c |
| A03 | Skip only exact-named objects; new note; pin the note and the absence | Fixed as decided for the code. The documented plan outcome is incomplete (B01), and the recovery advice in the note cannot be followed as written (B02) | 4c90654da5, 4efec97f02 |
| A04 | As suggested | Fixed as decided | 4efec97f02 |
| A05 | As suggested | Fixed as decided | 4efec97f02 |
| A06 | As suggested, end state only | Fixed as decided | 4efec97f02 |
| A07 | As suggested | Fixed as decided (ADR 231 and the editor tooling brief) | 4efec97f02 |
| A08 | `kind` on every `@default` argument value | Fixed as decided: `scalar`, `list`, `function`, `member`. The name of one arm clashes with the contract (B03) | 90190cf9a7, e939a94d03 |
| A09 | Drop or rename `ok`; say what `kind` means; `writtenList` generic | Fixed as decided. The failure arm is told apart by `written: undefined` | 90190cf9a7 |
| A10 | Pass the context to every SQL spec factory; ADR 249 true | Fixed as decided | 6a58f2cb99 |
| A11 | One helper builds `BlockSpecContext` | Fixed as decided. All six production sites call `blockSpecContext`; `InterpretExtensionBlocksInput.dataTypes` states it must equal the binder's | 37c3962d16 |
| A12 | Invert the guard test | Fixed as decided. The walk collects every `str()` argument of the SQL, Postgres model and Postgres block specs and compares with an explicit not-SQL list | 6fab1b5d6b |
| A13 | Defer to slice 3 | Fixed as decided: one line in the slice 3 "Carried over" list of `plan.md` | e9a8124b6e |
| A14 | As suggested | Fixed as decided: the note text lives in `psl-infer/infer-sql-text.ts` | 4c90654da5 |
| A15 | Copies byte-identical to the canonical script; codemod output equals the printer | Fixed as decided | d5739ced03 |
| A16 | `defaultFunctionRegistry` required on `createSqlBinder` | Fixed as decided | ddc6f1fa63 |
| A17 | As suggested | Fixed as decided | 4efec97f02 |

No A finding deviates from its decision in code.

## The probes

- **`taggedLiteralTextReadsBack` and `sqlTextsReadBack`.** One rule, two names, and both are right. The framework function is tag-agnostic, takes one text and sits beside `printTaggedLiteral`, which is the function whose output it predicts. The family function (in `@internal/sql-contract/sql-expression`, not in the target) states the precondition of `printSqlExpressionLiteral` in the family's words, for the list-with-absent-values shape every SQL caller has. It adds no second copy of the rule. Placement is right: the parser and the family call the framework, and the target calls the family.
- **`printSqlExpressionLiteral` throwing versus `printTaggedLiteral` for defaults.** The code follows the decision. The reason given for it is wrong, and the unchecked path has no name in the family (B04).
- **The infer skip and F04.** Code matches the decision: `printableIndex` prints a wire-named index with its canonical text, and checks and policies are always inferred as exact-named, so their skip is exact-only by construction. The documents are right for Prisma-named objects and for `map:` indexes and checks. For a `map:` policy the plan is not empty; it replaces the policy (B01).
- **`kind` on `@default` values; `writtenList` context type.** The switch in `lowerDefaultForField` now reads cleanly and the `typeof value === 'object'` fallthrough is gone. `writtenList` is generic like `writtenScalar`. See B03 for the arm name and B06 for the three hand-written output wrappers.
- **`blockSpecContext`.** Right shape and place. It mirrors `modelSpecContext` and `fieldSpecContext`, and it lives in the framework parser because block specs are framework concepts.
- **The inverted guard test.** Right shape. A new `str()` argument now fails until someone puts it in one list or the other.
- **`EnumMemberDefault` and `FunctionDefault` exports.** They exist only so the declaration emitter can name the inferred type of `sqlAttributeSpecs`. That widens the package's public surface with types no consumer uses (B03).
- **The `tagged-literal-text-helpers` fragment.** Accurate about the export move and the throw. Its advice "skip or refuse the object when it returns false, as `contract infer` and `contract print` do" is no longer the whole story: infer rewrites a wire-named index and defaults are never checked (covered in B04's suggestion).

## Findings

B01
- Location: packages/3-targets/3-targets/postgres/test/migrations/sql-text-canonical-planner.test.ts lines 155-171; docs/architecture docs/adrs/ADR 260 - Raw SQL is a value of the data type sql-expression.md line 132; upgrade-instructions/pending/sql-expression-literals-psl/app/instructions.md lines 14 and 63; upgrade-instructions/pending/sql-expression-literals-psl/extension/instructions.md lines 14 and 76.
- Issue: The F04 outcome is documented as "Prisma-named objects: no operations; `map:` index and check: a conflict". A `map:` policy is not mentioned. The planner does plan something for it. `PostgresPolicySchemaNode.isEqualTo` compares an exact-named policy's `using` and `withCheck` byte for byte, so the changed text is a `not-equal` finding. `planPostgresSchemaDiff` turns it into a `PolicyReplacement` (DROP POLICY then CREATE POLICY), and `gradePolicyReplacement` plans it because `migration plan` allows destructive operations. The test cannot see this. In the exact case the index and check conflicts make the whole plan a failure, and a failure carries no operations. So "none for the policy" pins only that the policy adds no conflict. A user who upgrades a schema with a `map:` policy whose text was not canonical gets a migration that drops and recreates a row-level security policy, and no document tells them.
- Suggestion: Add a planner test with only an exact-named policy, and pin its operations (expected: one drop and one create of the policy with the canonical text). Then say in ADR 260's consequence bullet and in both fragments what happens: "For a policy named with `map:`, `migration plan` writes a migration that drops the policy and creates it again with the canonical text." If that replacement is not wanted, that is a design question for Will, not a wording fix.

B02
- Location: packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-sql-text.ts lines 5-7; docs/architecture docs/adrs/ADR 129 - Template-Tagged Literals for Extensions.md line 131; upgrade-instructions/pending/sql-expression-literals-psl/app/instructions.md line 55.
- Issue: The skip note says "add it by hand before running migration plan". The object was skipped because no `sql` literal holds its database text. Anything the user writes by hand is canonical text, which is not the database text. An exact-named object compares its body byte for byte, so the hand-written object differs from the database too: the next plan stops with a conflict for an index or check (the same conflict B01's test shows), and replaces a policy (B01). Where the difference is inside a string constant (for example a whitespace-only line inside `E'...'`), the canonical text also means something different. So the advice cannot be followed and give a clean plan. The note is still better than silence, but it promises more than the system can deliver.
- Suggestion: Keep the note short and make the fragments and ADR 129 say what the user will meet: after adding the object by hand with its canonical text, `migration plan` stops with a conflict for an index or check, which a `migration new` migration with no operations settles, and a policy is replaced. Alternatively, name the object with a Prisma name when adding it, which drops and recreates it once. Pick one path and write it down; do not change code for this.

B03
- Location: packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts lines 258-289; packages/2-sql/2-authoring/contract-psl/src/exports/attribute-specs.ts line 1.
- Issue: Two problems with the new arm types. First, the name. In the contract, a "function default" is `ColumnDefault` `{ kind: 'function', expression }`: stored SQL (packages/1-framework/0-foundation/contract/src/types.ts line 133). The new `FunctionDefault` `{ kind: 'function', call }` is a call to a registered default function such as `uuid()`, which often lowers to an execution default, not to a function default. The same name and the same discriminant now mean two different things one layer apart, and `lowerDefaultForField` handles both. Second, the export. `EnumMemberDefault` and `FunctionDefault` are exported from `@internal/sql-contract-psl/attribute-specs` only so declaration emit can name the inferred type of `sqlAttributeSpecs`. `DefaultArgValue`, the union they belong to, stays private, and its other two arms are named `Parsed*` in the framework. Consumers get two half-explained types.
- Suggestion: Rename the arm to what it holds, for example `DefaultFunctionCall` with `kind: 'call'`. Either give `sqlAttributeSpecs` an explicit type so the arm types need no export, or export `DefaultArgValue` with them and one doc line, so the public surface is the union and not two of its parts.

B04
- Location: packages/2-sql/9-family/src/core/psl-build/default-mapping.ts lines 48-67; packages/2-sql/9-family/test/psl-build/default-mapping.test.ts line 183; docs/architecture docs/adrs/ADR 129 - Template-Tagged Literals for Extensions.md line 131; projects/sql-expression-literals/design.md line 434; upgrade-instructions/pending/sql-expression-literals-psl/extension/instructions.md line 121.
- Issue: The code follows the settled decision, but three things about it are wrong or unclear. (1) The reason. Every document says defaults are "compared by parsing both sides". They are not parsed: `resolvedDefaultsEqual` (packages/2-sql/1-core/schema-ir/src/ir/resolved-default-equality.ts lines 34-44) lowercases both expressions and removes all whitespace. That comparison is why canonicalization never shows up as a difference, since canonicalization only changes whitespace. The same comparison also hides that the pinned example, `concat(E'a\n  \nb')`, reads back as a different string constant. A database created from the inferred contract gets a different default value. (2) ADR 129 line 131 says infer prints these objects "through the same printer" and that "the printer refuses a text that would not read back", then that defaults print unconditionally. Read literally, the three sentences contradict each other. (3) The family module now has a checked printer with a name and an unchecked path that is `printTaggedLiteral(SQL_EXPRESSION_TAG, …)` written inline, with its reason only in `mapDefault`'s doc comment. The extension fragment tells consumers to check before printing, "as `contract infer` and `contract print` do", which is not what the family's own default printer does.
- Suggestion: Replace "compared by parsing both sides" with the real reason: "a default expression is compared without case or whitespace, and canonicalization changes only whitespace". Rename the test to match. Reword ADR 129 so the refusal applies to index, check and policy texts only. Record in ADR 129, or in the project's deferred list, that a default whose string constants hold a whitespace-only or indented line changes meaning on read-back; whether to check defaults too stays Will's decision, as the findings file says. Optionally give the unchecked path a name in `sql-expression.ts` (for example `printSqlDefaultExpression`) so the family owns both ways to write a `sql` literal.

B05
- Location: packages/1-framework/1-core/framework-components/src/exports/control.ts line 149; packages/1-framework/2-authoring/psl-parser/src/syntax/ast/expressions.ts lines 1-2.
- Issue: `canonicalizeTaggedLiteralBody` is now exported only from `/authoring`, but its result type `TaggedLiteralCanonicalization` is exported only from `/control`. `expressions.ts` imports the function from one entry and its return type from the other. A02 asked for one entry per module; the function moved and its type did not.
- Suggestion: Export `TaggedLiteralCanonicalization` from `/authoring` beside the function and remove it from `/control` (update the one importer, and add a line to the `tagged-literal-text-helpers` fragment).

B06
- Location: packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/written-scalar.ts lines 27-44; packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts lines 274-289 and 405-419.
- Issue: Three combinators now do the same thing by hand: keep an arm's syntax (its `kind`, `label` and metadata) and change its output. `writtenScalar` spreads the arm and needs a `blindCast`; `functionDefaultArm` and `member` copy chosen fields one by one. If `ArgType` gains a metadata field used by tooling, the copies drop it silently, and the next arm that needs a new output type will write a fourth copy.
- Suggestion: Add one kit combinator, for example `mapArg(arm, (value) => …)`, that keeps the arm's syntax fields and maps its parsed value, and build the three on it. Low priority; fine to defer to slice 3 with a line in `plan.md`.

B07
- Location: packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-sql-text.ts lines 9-12.
- Issue: `canonicalSqlText` calls the framework canonicalizer directly to get the canonical text of a SQL body. Everywhere else the target reaches SQL text rules through the family module (`printSqlExpressionLiteral`, `sqlTextsReadBack`, `sqlTextFromCanonical`). This is the one place where the target applies the tagged-literal rule to SQL on its own.
- Suggestion: Move it to `@internal/sql-contract/sql-expression` next to `sqlTextsReadBack` (for example `canonicalSqlText(text): string | undefined`) and import it in the target. Low priority.

## Verdict

Every round 1 finding is fixed as decided, and the shape of the fixes is right. B01 is the one that matters before merge: the upgrade documents and the planner test say nothing about the `map:` policy case, and the planner replaces that policy. B02 and B04 are wording fixes in the ADRs and fragments. B03, B05, B06 and B07 are small naming and boundary cleanups.
