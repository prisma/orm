# Slice 3 system design review, round 3: after the merges (TML-3289)

## Scope

Branch `l65-3` (pushed as `tml-3289-sql-expression-ts`, PR #30558), whole diff `origin/main...HEAD` with the merge base at `7ae50f13f9` (2b's squash on `main`). I concentrated on the four commits since round 2: `b3f0ca7a04` (merge of 2b's final commit), `ba45958509` (merge of `main`), `fc10468cd3` (ADR 260 becomes ADR 268) and `bd80bf468a` (follow-ups for new `main` code). I read the code at HEAD of every changed source file, ADRs 129, 234, 236, 243, 244, 254 and 268, the ADR index row, the error reference entries, the contract-ts and Postgres target READMEs, `skills/prisma-8/references/contract.md`, both `sql-expression-literals-ts` fragments, the `full-text-index-weight-groups` fragments from `main`, design sections 2 and 15, status "State on 2026-10-08" and the round 2 review. I did not run builds or tests.

## What the slice does, in system terms

Slice 3 gives `sql/expression` a TypeScript value, `SqlExpression`, made by the `sql` tag in `@internal/sql-contract/sql-expression`. Every TypeScript builder field that holds raw SQL is typed `SqlExpression`, so a plain string is a type error. Lowering reads each field through `requireSqlExpression`, which refuses anything else at run time and names the object. The contract and IR keep strings. The invariant is that PSL and TypeScript emit byte-identical contracts, because both canonicalize through `canonicalizeTaggedLiteralBody`.

## What holds after the merges

- No behaviour was dropped or duplicated by the merges. `sql-expression.ts` holds both 2b's helpers (`canonicalSqlText`, `printSqlExpressionLiteral`, `sqlTextsReadBack`, `assertNothingCastsFromSqlExpression`) and slice 3's (`SqlExpression`, `sql`, `requireSqlExpression`, `sqlExpressionRegistration`). The family descriptor reads the registration. Round 2's B01 (indentation from template pieces only) and B05 (frozen leaves) are in the code.
- `main`'s new full-text index (TML-3431) stores `type: 'fullText'` with `options.weightGroups` and keeps `where` as a separate field. Slice 3's `where` check sits on that field and does not touch the weight groups, so the two features meet cleanly. The parity fixture's expected contract was updated to the new index shape and to `dataType` columns.
- The `where` of a full-text index is checked twice: in `fullTextIndex` and again in lowering. Design 15.3 records why (lowering cannot tell the author used `fullTextIndex`, so it would name it `Index`). The second check is unreachable for this helper. I accept the duplication.
- ADR 260 to 268: every mention that means this project's decision says 268. The remaining "ADR 260" mentions are `main`'s afterTransaction ADR, or history in status.md, which says so on line 12.
- ADRs 129, 234, 236, 243, 244, 254 and 268, the subsystem doc, the Postgres README and the skill reference agree with the code on the TypeScript surface. No doc outside `projects/` and released fragments shows a string for a TypeScript raw-SQL field.
- Vocabulary is consistent: PSL writes a "`sql` literal", TypeScript holds a "`sql` value", and both are values of `sql/expression`.
- Layering is unchanged from round 2. The value lives in the SQL family's core contract package, the builder and the Postgres extension import it, and the Postgres target lowers policy predicates with it. No framework package learns about it.

## Findings

### A01. The upgrade fragments say `fullTextIndex` renders an expression, which it no longer does

Location: upgrade-instructions/pending/sql-expression-literals-ts/app/instructions.md line 89; upgrade-instructions/pending/sql-expression-literals-ts/extension/instructions.md line 98; docs/reference/error-reference.md line 596.

Issue: both fragments end `storage-hash-may-change-once` with "the built-in `fullTextIndex` renders one canonical line and is not affected". Since TML-3431 merged into `main`, `fullTextIndex` does not use `{ fields, render }`. It stores an index of type `fullText` with `options`, and no expression text exists in the contract for it. The sentence now describes a mechanism that is gone, and the `full-text-index-weight-groups` fragment in the same release says the opposite ("The search document is no longer stored anywhere in the contract"). The error reference example for `CONTRACT.SQL_EXPRESSION_INVALID`, `Index "message_text_search" expression: `, uses the name the skill reference and the README give to a `fullTextIndex` call. A reader will connect the refusal to the full-text helper, which can no longer raise it.

Suggestion: in both fragments, replace the clause with "`fullTextIndex` stores its weight groups and language, not SQL text, so it is not affected", or drop it. In the error reference, use a name that does not belong to a full-text example, such as `Index "post_title_lower" expression: `.

### A02. The merge decision on unnamed full-text indexes is right, but "on" now means two things

Location: packages/3-extensions/postgres/src/contract/full-text-index.ts lines 108-113; packages/2-sql/2-authoring/contract-ts/src/contract-lowering.ts lines 882-889; docs/reference/error-reference.md line 242.

Issue: I agree with naming every field. The helper receives `ColumnRef`s, which carry no model name, and since TML-3431 an index can cover several fields, so naming only the first would not identify it. Listing the fields flattened is also enough: `[[title, subtitle], body]` and `[title, subtitle, body]` give the same text, but the message only has to point at a call the author just wrote, not describe its weights.

The problem is the word "on". `Index on "Post" where` names a model. `Full-text index on "title", "subtitle" where` names fields with the same syntax. Read cold, `Full-text index on "title"` looks like an index on a model called `title`. The error reference puts both forms in one sentence, which makes the clash visible.

Suggestion: say what the quoted names are: `Full-text index on fields "title", "subtitle" where`. Keep `Index on "Post"` and `Check on "Post"` as they are. Update the tests in `full-text-index.test.ts`, the error reference and design 15.3.

### A03. Design 15.3 and the status entry describe the one-field form and give the wrong origin

Location: projects/sql-expression-literals/design.md line 616; projects/sql-expression-literals/status.md line 10.

Issue: design 15.3 still says the unnamed form is `Full-text index on "<field>" where`, "the indexed column's field name". The code and the error reference name every field. Status line 10 says "2b made full-text indexes span several fields"; that was TML-3431 (#30562), a separate project.

Suggestion: in design 15.3, write the form chosen under A02 and the reason in one sentence: the helper has no model and an index covers several fields. In status line 10, credit TML-3431.

### A04. ADR 268 says every TypeScript raw-SQL field takes only a `sql` value, but two paths still take strings

Location: docs/architecture docs/adrs/ADR 268 - Raw SQL is a value of the data type sql-expression.md line 133 (and line 44); docs/architecture docs/adrs/ADR 254 - Data types and casts.md line 251.

Issue: ADR 268 says `.default()` and every builder field that takes raw SQL accept a `SqlExpression`, "and a plain string does not compile". `.defaultSql(expression: string)` still exists (deprecated, removed at 8.0.0 by TML-3286), and `.default({ kind: 'function', expression })` takes raw SQL as a string and is kept on purpose (spec non-goals). ADR 129 line 56 names both. The decision record is the place a reader checks for exceptions, and it states a rule with none.

Suggestion: add one sentence to ADR 268's TypeScript section: "`.default({ kind: 'function', expression })` and the deprecated `.defaultSql()` still take a string and store it unchanged; `.defaultSql()` is removed at 8.0.0." ADR 254 can keep its wording, since it points to ADR 129.

### A05. Two TypeScript tags called `sql` interpolate differently, and no ADR says why

Location: docs/architecture docs/adrs/ADR 268 - Raw SQL is a value of the data type sql-expression.md lines 135-137; docs/architecture docs/adrs/ADR 247 - Whole-query raw SQL is the fragment mechanism at statement position.md (the `db.raw.sql` surface).

Issue: the query lane's `db.raw.sql` binds `${limit}` as a parameter. The contract builder's `sql` refuses `${limit}` and only splices other `sql` values. Both are template tags named `sql` that hold raw SQL. An author who knows one will expect the other to work the same way. The refusal message helps ("write any other text inside the template"), but the design reason is not written down: contract SQL becomes DDL and has no parameters, so a value cannot be bound, and Prisma never quotes a value into SQL. This is a deliberate homonym across two planes, and it should be stated where the decision lives.

Suggestion: add one sentence to ADR 268 after the interpolation paragraph: "The query lane's `db.raw.sql` (ADR 247) binds interpolated values as parameters. Contract SQL becomes DDL, which has no parameters, so the contract builder's `sql` splices only other `sql` values." No code change.

### A06. The parity fixture does not cover a full-text index with several weight groups and a `where`

Location: test/integration/test/authoring/parity/sql-expressions/contract.ts and schema.prisma (the `post_body_search` index).

Issue: the parity fixture is the test that proves the slice's main invariant: PSL and TypeScript emit byte-identical contracts. After the merge, its only full-text index has one field. The new shape from TML-3431, several weighted fields, now meets slice 3's `where` in both languages, and nothing checks that the two surfaces agree on `columns`, `options.weightGroups` and the canonical `where` together. The paths are independent, so the risk is small, but the fixture is the place where a future change to either would show.

Suggestion: change `post_body_search` to two weight groups in both files, for example `@@fullTextIndex([[body, email]], …)` or add a `title` field and use `[[title], body]`, with a multi-line `where`. Regenerate `expected.contract.json`.

## Out of scope for this pass

- Whether the error reference's long `CONTRACT.ARGUMENT_INVALID` and `CONTRACT.DEFAULT_INVALID` entries are readable is a learnability question, not a system-design one.
- The `fullTextIndex({ where })` shorthand in both fragments' front matter does not match the call signature `fullTextIndex(fields, { where })`. The body tables show the real call, so I leave it to the code reviewer.

## Fixes check, 2026-10-08

Commits `79e9498810` (docs) and `cab6bcce23` (code). I read both diffs and the files at HEAD. I did not run tests.

| Finding | Result | Evidence |
| --- | --- | --- |
| A01 | Fixed | Both fragments now say "`fullTextIndex` stores its fields and language as data, renders no SQL, and is not affected". The error reference example is `Index "post_title_lower" expression: `. |
| A02 | Fixed | `fullTextIndexOwner` writes `Full-text index on fields "title", "subtitle", "text"` (full-text-index.ts line 111). Both tests and the error reference use the new form. Design 15.3 explains why "on fields" differs from `Index on "<Model>"`. |
| A03 | Partly | Design 15.3 describes the every-field form. Status line 10 still says "2b made full-text indexes span several fields"; it was TML-3431 (#30562). |
| A04 | Fixed | ADR 268 now names `.defaultSql()` (removed at 8.0.0 by TML-3286) and `.default({ kind: 'function', expression })`, and says both store the string without canonicalization. |
| A05 | Fixed | ADR 268 now contrasts the tag with `db.raw.sql` (ADR 247): contract SQL becomes DDL, which has no parameters. |
| A06 | Fixed | The parity fixture's `post_body_search` is `[[title, email], body]` with a multi-line `where` in both files. The fix also adds an interpolated value with a line comment, an escaped backtick and tab indentation. |

### A07. The extension fragment does not describe the new rule for `sql` values from another copy of the package

Location: upgrade-instructions/pending/sql-expression-literals-ts/extension/instructions.md lines 110 and 116; packages/2-sql/1-core/contract/src/sql-expression.ts lines 129-147.

Issue: `cab6bcce23` changes what counts as a `sql` value. `isSqlExpression` now returns true for any object that carries the marker and has a string `text`, including one made by another installed copy of the package. A new export, `readSqlExpression`, turns such a value into this copy's `SqlExpression` and canonicalizes its text. `requireSqlExpression` and `.default()` use it. The fragment for extension authors lists `SqlExpression`, `isSqlExpression` and `requireSqlExpression` as the module's exports. It does not mention `readSqlExpression`. It also does not say that `isSqlExpression` does not prove a value is this copy's instance. An extension that checks with `isSqlExpression` and then reads `.text` gets text that may not be canonical. Inside the repo, only the `sql` tag does this, and it canonicalizes the joined text afterwards, so it is safe.

Suggestion: in the `sql-tag-lives-in-sql-contract` section, add `readSqlExpression` to the list of exports. Say in one sentence that code which reads a value it did not make should use `readSqlExpression` or `requireSqlExpression`, not `isSqlExpression` followed by `.text`, because only those two canonicalize a value made by another copy. Low priority.
