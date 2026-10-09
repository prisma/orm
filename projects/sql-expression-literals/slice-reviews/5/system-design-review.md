# System design review: slice 5, migration files write `sql` values (TML-3297)

## Scope

Range: `24258f35e7...HEAD` on local branch `l65-5`, four commits (c542a4e7d5, 14366dbb90, efff1058f1, d2122b9135). I read the code at HEAD and checked it against design.md section 17, plan.md "Slice 5", design-notes.md decision 10, ADR 195, ADR 268, the Migration System doc ("Planner IR", "Opaque SQL in DDL"), design.md section 20, and the pending upgrade fragments. I did not run builds or tests. I read `wip/5/v-upgrade-coverage.log`; the coverage check passed with no output.

What the slice adds, in structural terms:

- One new input type, `MigrationSqlText = string | SqlExpression`, and one reader, `sqlTextOf`, in `@internal/sql-relational-core/contract-free`. Every migration function that takes opaque SQL now takes this type and turns it into a string at its entry. The IR and the stored option types stay strings.
- One new renderer, `renderTaggedTemplateSource(tag, text)`, in framework-components `shared/tagged-literal.ts`. It writes `` sql`...` `` when the tag reads the text back unchanged, and otherwise falls back to `tsQuotedTextSource`.
- `sql` is exported from both targets' migration modules, and each call's `importRequirements()` adds it when a rendered text uses the tag.
- ADR 195 gets a "Recorded exception" section.

What holds up well:

- Dependency direction is right. `relational-core` (lanes) imports `sql-contract` (core); the targets import framework-components `authoring` (shared plane) and `ts-render`. `framework-components` already depended on `ts-render`.
- The IR is unchanged. Conversion happens once, at the method entry, so `ops.json` and the planner do not change. This is the narrowest place to put it.
- There is one `sql` value. The migration module re-exports the same `sql` the contract builder uses, so a migration file and a contract write raw SQL with the same function.
- The Postgres test that checks, for every call class, that the `sql` import appears exactly when the output holds a `` sql` `` template is the right architectural test for import tracking. The round-trip tests that run a generated file and compare `ops.json` prove the main property: the new output means the same thing as the IR.

## Findings

### A01. `renderTaggedTemplateSource` mixes three concerns that belong to three places

Location: packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts lines 179-211; packages/1-framework/1-core/ts-render/src/ts-string-literal.ts lines 26-42; packages/3-targets/3-targets/postgres/src/core/migrations/render-typescript.ts lines 145-151; packages/3-targets/3-targets/sqlite/src/core/migrations/render-typescript.ts lines 131-137

Issue: The function promises that "the tag reads it back unchanged". That promise depends on three separate things:

1. How the TypeScript `sql` function reads a template: `resolveTemplateTagEscapes` and `canonicalizeTaggedLiteralBody`, in `sql-contract`.
2. How TypeScript template syntax works: which characters need escapes, and how to escape a backtick, `${` and a backslash. `ts-render` already owns this in `tsQuotedTextSource` and `needsEscapeSequence`. The new `holdsCharacterThatNeedsAnEscape` and the escape chain on line 185 are copies of that code with one change (line breaks and tabs are allowed).
3. How the targets' `indent()` helper treats blank lines. The `WHITESPACE_ONLY_LINE` check exists only because `indent()` uses `line.trim()`, which treats a line holding only a non-breaking space as blank, while the canonicalization does not. That fact lives in two target packages, but the check that depends on it lives in the framework.

So a framework function encodes a detail of two target files, and duplicates a `ts-render` rule. If `indent()` or `needsEscapeSequence` changes, nothing ties the change back to this function.

The `tag` parameter suggests the function works for any tag. It only works for a tag whose TypeScript function reads a template the way `sql` does. No other tag has a TypeScript function today, so the parameter is speculative.

The name also reads wrong in its module. Its sibling `printTaggedLiteral` writes PSL. `renderTaggedTemplateSource` writes TypeScript, but nothing in the name says so. `ts-render` names its functions `ts…Source` (`tsQuotedTextSource`, `tsObjectSource`, `jsonToTsSource`). And the module now has two read-back predicates, `printedTaggedLiteralReadsBack` (PSL) and the private `templateHoldsUnchanged` (TypeScript), with different rules and no shared name.

Suggestion: Split the function along those lines.

- In `ts-render`, add the template syntax: a function that writes a tagged template literal for a text, and a predicate for "this text can be written inside a template literal with no escape sequence". Both should share `needsEscapeSequence` with `tsQuotedTextSource`.
- Next to `printSqlExpressionLiteral` in `sql-contract/src/sql-expression.ts`, add `sqlTemplateSource(text)`. It decides whether the `sql` tag reads the text back and calls the `ts-render` writer. It has no `tag` parameter.
- Make the targets' `indent()` treat as blank exactly the lines the canonicalization treats as blank (`/^[ \t]*$/`). The special check then disappears. If that is not wanted, put the rule in a comment at `indent()`, which is where it would break.

If the function stays where it is, at least rename it `tsTaggedTemplateSource` and state in its doc comment that it is correct only for a tag whose TypeScript function canonicalizes with `canonicalizeTaggedLiteralBody`.

### A02. `MigrationSqlText` names a consumer, and the type is used outside migration files

Location: packages/2-sql/4-lanes/relational-core/src/contract-free/column.ts lines 18-23, 38-39, 73-77; callers packages/3-targets/3-targets/postgres/src/core/migrations/issue-planner.ts line 468 and packages/3-targets/3-targets/postgres/src/contract-free/control-bootstrap.ts lines 12-39

Issue: The type is the parameter type of `fn` and `checkExpression`. Those are contract-free DDL factories. The planner calls `checkExpression` when it builds the IR, and the control bootstrap calls `fn('now()')` to build Prisma's own tables. Neither is a migration file. The doc comment also says "SQL in a migration-file argument". A fresh reader would expect the type to be specific to migration files, and would not expect to see it on a factory the planner uses.

What the type actually is: raw SQL given either as a `sql` value or as a string, before it is read. That is true in any caller.

Suggestion: Rename it to describe that, for example `SqlTextInput`. This also matches the `*Input` suffix the same diff uses in the SQLite migration (`SqliteColumnSpecInput`, `SqliteTableSpecInput`). Keep the remark that the string form is permanent, but move the part about committed migration files to the Migration System doc, which already says it.

### A03. ADR 195's exception says both forms read the same text, which is true only for canonical text

Location: docs/architecture docs/adrs/ADR 195 - Planner IR with two renderers.md lines 131-133

Issue: The section says "The migration functions take a `sql` value or a string and read the same text from either, so the factory still receives the IR's value." That is not true in general. A `sql` value canonicalizes its text and a string does not, so `` sql`  x` `` and `'  x'` give different text. ADR 268 and the Migration System doc say this correctly. What makes the exception safe is a property of the renderer: it writes a template only when canonicalization leaves the text unchanged. The section mentions the fallback in its last sentence but does not say that this is the reason the factory gets the IR's value.

The section also does not say that the method signatures now differ from the IR's types. The "Factory alignment" section just above says signatures are "aligned 1:1" with the call argument shapes. After this slice, for example, `createIndex` takes `Omit<CreateIndexExtras, 'where'> & { where?: MigrationSqlText }` while `CreateIndexCall` holds `CreateIndexExtras`. The exception covers what the file writes, but not this change to the API.

A smaller point: the example names `CreateIndexCall.where`, but `where` is a field of the call's extras.

Suggestion: Reword the middle of the section to state the invariant. For example: "Each migration function that takes opaque SQL accepts a `sql` value or a string and converts it to a string at its entry. A `sql` value's text is canonical and a string's is not, so the renderer writes a template only when canonicalization leaves the text unchanged. The factory therefore receives the IR's text either way." Add one sentence saying the parameter types of those methods are wider than the IR's types. Write the example as `extras.where`.

### A04. The rule for which SQL becomes a `sql` template is explained by where the SQL came from, but enforced by parameter type

Location: docs/architecture docs/subsystems/7. Migration System.md line 125 (last sentences); packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts lines 988-992; docs/architecture docs/adrs/ADR 195 - Planner IR with two renderers.md line 133

Issue: The doc says the SQLite postcheck SQL stays a string "because it is not the contract's SQL". But nothing in the IR records where a text came from. `AddCheckConstraintCall.expression` and `RecreatePostcheck.sql` are both plain strings. The real rule in the code is simpler: the renderer writes a `sql` template exactly where the migration function's parameter accepts a `sql` value. `postchecks[].sql` does not, so the file must pass a string.

The provenance reason also does not hold in general. If the planner one day builds a check expression itself and passes it to `AddCheckConstraintCall`, the file will show it as `` sql`...` ``, and the stated reason will be false. A user who edits a migration file by hand also sees raw SQL in two forms in one file and has no stated rule for which form a field takes.

There is a structural distinction that does hold. The places that take a `sql` value are exactly the opaque SQL fragments that the planner places inside a larger statement, which "Opaque SQL in DDL" lists. A postcheck is a whole query, like the statement of `rawSql`. That distinction is in the types and the docs already.

Suggestion: State the rule that way in the Migration System doc and in ADR 195: a migration function takes a `sql` value for an opaque SQL fragment placed inside a DDL statement (the list in "Opaque SQL in DDL"), and the renderer writes a template exactly there. A whole statement or query, such as a `recreateTable` postcheck or `rawSql`, stays a string. Drop "because it is not the contract's SQL".

### A05. The skill gives the new API in a broken code span and does not mention canonicalization

Location: skills/prisma-8/references/migrations.md line 367 and line 55

Issue: Line 367 puts `` fn(sql`expression`) `` inside a single-backtick code span. The inner backtick ends the span, so the text renders broken. The same line says the functions accept "a `sql` value ... or a string", but not that the two differ: a `sql` value is canonicalized and a string is not. This skill is what an agent reads before it edits a migration file. An agent that "tidies" a generated file by wrapping a fallback string in `sql` changes the SQL the migration runs. The upgrade instructions warn about this; the skill does not. Line 55 lists the symbols in the rendered import line and does not include `sql`.

Suggestion: Use a double-backtick code span on line 367. Add one sentence: generated files write a string where the `sql` tag would change the text, so leave those strings as strings. Add `sql` to the import list on line 55.

### A06. `sqlTextOf` reports a wrong message and an undocumented raise site

Location: packages/2-sql/4-lanes/relational-core/src/contract-free/column.ts lines 21-23; docs/reference/error-reference.md line 242 (`CONTRACT.ARGUMENT_INVALID`)

Issue: For a value that is neither a string nor a `sql` value, `sqlTextOf` calls `requireSqlExpression(value, 'SQL text')`. The message is "SQL text must be a sql`...` value." For a function that also accepts strings, that message is wrong, and "SQL text" does not name the argument that was bad. The error reference lists every place that raises `CONTRACT.ARGUMENT_INVALID` with a `sql` message and its `what` values, but not the migration functions. The `CONTRACT.` prefix is also odd for an argument in a migration file, which is not contract authoring; the reference describes this code as being for "the contract-authoring surface".

Suggestion: Give `sqlTextOf` its own message, for example "`<argument>` must be a sql`...` value or a string", with the argument named by the caller. Add the raise site and its `what` value to the error reference. Whether to keep the `CONTRACT.` code is a smaller decision; if it stays, the reference should say that migration functions raise it too.

### A07. The new render and import helpers are copied in both targets, and imports are listed apart from rendering

Location: packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts lines 188-213 and the `importRequirements()` methods of `CreateTableCall`, `AddColumnCall`, `SetDefaultCall`, `AddCheckConstraintCall`, `CreateIndexCall`, `CreatePostgresRlsPolicyCall`; packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts lines 103-125 and the `importRequirements()` methods of `CreateTableCall`, `AddColumnCall`, `RecreateTableCall`

Issue: `sqlTextSource` and `sqlTagImports` are the same code in both targets, differing only in the module constant. Each call also lists the texts it renders twice: once in `renderTypeScript()` and once in `importRequirements()` (for example `columnSqlTexts` plus `constraintSqlTexts` in `CreateTableCall`). If a later change renders one more SQL text and forgets the second list, the generated file uses `sql` without importing it and does not compile. The existing code already works this way for other symbols (`constraintImportSymbols`), so this follows the current pattern. Postgres has a test over every call class that would catch the mistake. SQLite has only the round-trip tests, which cover the calls they happen to build.

Suggestion: Put one helper in the SQL family (for example in `relational-core` next to `sqlTextOf`, or in `family-sql` control) that takes the module specifier and returns both the source and the import. Better still, render each SQL text as a small `TsExpression` that carries its own import, so a call's imports are collected from what it rendered and the two lists cannot drift. At minimum, add the per-class "imports `sql` exactly when it prints a template" test to SQLite.

### A08. Postgres and SQLite express the wider input types in different shapes

Location: packages/3-targets/3-targets/postgres/src/core/migrations/postgres-migration.ts lines 515, 577-580, 646-649, 710-726; packages/3-targets/3-targets/sqlite/src/core/migrations/sqlite-migration.ts lines 306-335

Issue: Postgres writes each wider type inline in the method signature (`Omit<CreateIndexExtras, 'where'> & { where?: MigrationSqlText }`) and repeats it in the private converter below. SQLite names its wider types (`ColumnDefaultInput`, `SqliteColumnSpecInput`, `SqliteTableSpecInput`) but does not export them, although they type protected methods of an exported class that users subclass. These are sibling designs for the same idea, built two ways. A user cannot name the parameter type of either.

Suggestion: Pick one shape for both targets. Named `*Input` types, written once and used in both the signature and the converter, read best. Export them from the target's migration module only if users are expected to build these arguments outside a method call; otherwise keep them private in both targets.

### A09. The upgrade instructions differ from design section 20 without a recorded reason

Location: upgrade-instructions/pending/sql-expression-literals-ts/app/instructions.md lines 62 and 89; upgrade-instructions/pending/sql-expression-literals-ts/extension/instructions.md lines 71 and 98; projects/sql-expression-literals/design.md section 20, slice 5 row and first paragraph

Issue: Design section 20 says slice 5 adds a fragment `migration-files-sql-values/extension` with the change `migration-functions-accept-sql-values`, and says "Never edit another PR's fragment; a new fragment names the pending fragment it supersedes." The slice adds no fragment and edits the slice 3 fragment, which merged with #30558. The coverage check passes, so no fragment was required.

The edit itself is the right call. The old sentence ("migration functions keep taking strings") became false, the fragment has not been released, and two fragments that contradict each other in one release would be worse for users. The record-upgrade-instructions skill allows fixes to a fragment through normal review. But the design still says the opposite.

Suggestion: Update design section 20: slice 5 adds no fragment because its API changes only widen parameter types and add an export, and it corrects the unreleased slice 3 fragment in place because the sentence about migration files became false.

## Out of scope for this pass

- Whether `renderTaggedTemplateSource`'s fallbacks are complete and correct for every input, and whether the planted-defect logs show each test can fail: code review.
- Readability of the generated files for users: devrel lens.

## Fixes check

Commits checked: ada268bae6 and 5d7fc74dd9 (docs), 7226832a37 (code), on `l65-5`. I read the diff `d2122b9135..HEAD`. I did not run builds or tests.

| Finding | Status | Evidence |
| --- | --- | --- |
| A01 | Partly fixed | Renamed to `tsTaggedTemplateSource`. The escape chain now comes from the new `tsTemplateText` in `ts-render`, which `tsQuotedTextSource` also uses. The doc comment states the condition (the tag must canonicalize as `canonicalizeTaggedLiteralBody` does, which holds for `sql`). Still open: `holdsCharacterThatNeedsAnEscape` in tagged-literal.ts lines 210-219 still copies `needsEscapeSequence` in ts-string-literal.ts. The check for whitespace-only lines still depends on the targets' `indent()`, with no note at `indent()`. The generic `tag` parameter remains. These were the lesser parts of the suggestion, and the brief chose the minimum. I accept that. |
| A02 | Fixed | `MigrationSqlText` is now `SqlTextInput` in column.ts line 20. Its doc comment no longer names migration files. |
| A03 | Fixed | ADR 195 lines 131-137 now state the invariant: a template is written only when canonicalization leaves the text unchanged, so the method receives the IR's text. It says the methods are wider than the IR's types, and the example is `extras.where`. |
| A04 | Fixed | ADR 195 and Migration System doc line 125 now state the rule by where the SQL sits: a fragment placed inside a DDL statement takes a `sql` value, and a whole statement or query (`rawSql`, the `recreateTable` postchecks) stays a string. "Because it is not the contract's SQL" is gone. |
| A05 | Fixed | The skill's line 367 no longer nests backticks, and it says that a `sql` value is canonicalized while a string is kept as written, so a committed string should not be wrapped. Line 55 lists `sql`. |
| A06 | Fixed | `sqlTextOf(value, what)` throws ``<what> must be a string or a sql`...` value.`` with `meta: { what }`. Every call site names its argument. The error reference lists the raise site and every `what` form. See A11 for one sentence left over. |
| A07 | Fixed | Each call builds its source and its imports in one pass through a `SqlTextSources` object (`#written()`), so the two cannot drift. Both targets use one shared helper, `createSqlTextSources`. SQLite now has the test over every call class, plus a test that the fixture list covers every class. See A10 for where the helper lives. |
| A08 | Fixed | Postgres now declares named, module-local `CreateIndexExtrasInput`, `AlterColumnTypeOptionsInput` and `RlsPolicyInput` (postgres-migration.ts lines 720-732), the same shape SQLite uses. |
| A09 | Fixed | Design section 20's slice 5 row says no fragment is added, why, and that the unreleased slice 3 fragments are corrected in place. |

### A10. The migration-file render helper lives in the `sql` value's module and copies `ImportRequirement`

Location: packages/2-sql/1-core/contract/src/sql-text-sources.ts lines 1-31; packages/2-sql/1-core/contract/src/exports/sql-expression.ts lines 2-6

Issue: `createSqlTextSources` writes the SQL texts of a generated migration-file call and collects that call's imports. That is code generation for migration files. It lives in `sql-contract` and is exported from the `sql-expression` entry point, next to the `sql` value itself. A reader who opens the module for `sql` values now finds a migration renderer in it.

`sql-contract` does not depend on `ts-render`, so the helper declares its own `SqlTagImport { moduleSpecifier; symbol }`. That is a second name for `ImportRequirement` from `ts-render`. The targets push it into an `ImportRequirement[]` only because the shapes happen to match.

`@internal/family-sql/control` is a SQL family package in the migration plane. Both targets already import it, and it can depend on `ts-render`. It is a closer home for the helper.

Suggestion: Move `createSqlTextSources` and `SqlTextSources` to `family-sql`'s control entry point, if `pnpm lint:deps` allows. Use `ImportRequirement` there and delete `SqlTagImport`. If the helper must stay in `sql-contract`, give it its own entry point, for example `@internal/sql-contract/migration-render`, and add `ts-render` as a dependency so it can return `ImportRequirement`.

### A11. The error reference says the migration raise site happens "while building the contract"

Location: docs/reference/error-reference.md line 242 (end of the `CONTRACT.ARGUMENT_INVALID` entry)

Issue: The new sentence about `sqlTextOf` is added before the entry's closing sentence: "Raised while authoring/building the contract, before emit." A migration function raises the error when the migration file runs, not while the contract is built. Read in order, the entry now says something false about the new site.

Suggestion: In the `sqlTextOf` sentence, say when the error is raised, for example "raised when the migration file runs". Or narrow the closing sentence to the contract-authoring sites.

### A12. Design section 17 still describes the replaced code

Location: projects/sql-expression-literals/design.md section 17.1 (the code block near line 676) and section 17.2 (the paragraph on `importRequirements()`)

Issue: Section 17.1 still shows `sqlTextOf(value: SqlTextInput): string` with no `what` parameter. It says a non-string value is read with `requireSqlExpression(value, 'SQL text')`, and its doc comment still says "SQL in a migration-file argument". Section 17.2 still says each call computes its imports by calling `tsTaggedTemplateSource` again over a separate list of texts. The code now builds both through `createSqlTextSources`. The design is the record later slices and reviewers read, so it should match the code.

Suggestion: Update 17.1 to the two-argument `sqlTextOf` and its message, and replace the 17.2 import paragraph with one sentence about `createSqlTextSources`.

## Review of f84d9c1101

Scope: `git show f84d9c1101`. It moves `createSqlTextSources` to `@internal/family-sql/control`, and it adds a step after prettier, `indentTaggedTemplates`, that `formatMigrationTs` runs inside `writeMigrationTs`. I read the code and tests. I did not run anything.

A10 is fixed. `createSqlTextSources` now lives in `packages/2-sql/9-family/src/core/migrations/sql-text-sources.ts`, is exported from `@internal/family-sql/control`, and returns `ImportRequirement`. `SqlTagImport` is gone.

The step itself sits in the right package: `writeMigrationTs` already formats every generated file in `migration-tools`. Rendering with known indentation would not work instead. The renderer writes each call on one line, and only prettier decides where lines break and how deep the template's line ends up. Prettier options cannot help either: prettier keeps template text as written, and re-indents an embedded template only through a plugin's `embed` hook, which is how it formats `css`, `graphql` and `html` templates. So some step after prettier is needed. My findings are about who owns the rule the step depends on, and how the step is tested and documented.

### A13. The step changes any tagged template, but nothing passes it the tags it may safely change

Location: packages/1-framework/3-tooling/migration/src/indent-tagged-templates.ts lines 1-9, 35 (`TAG_CHARACTER`) and 57-61; packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts lines 178-198 (`tsTaggedTemplateSource` at line 186)

Issue: The step moves the body of every multi-line template whose opening backtick follows an identifier character, whatever the tag is. That is safe only for a tag whose function removes the indentation all lines share. For `String.raw`, a `graphql` tag, or the Postgres `tsquery` tag, the step changes the value. The file then produces different `ops.json` than `renderOps`, with no error.

The rule that makes it safe is written only in the step's doc comment: "Generated migration files write such a template only with a tag that removes the shared indentation". Neither side holds that rule in code:

- `tsTaggedTemplateSource` writes multi-line templates for any `tag` its caller passes.
- The caller that picks the tag is in the SQL family (`createSqlTextSources`).
- The step that depends on the rule is in framework tooling, and it has no way to check it.

A new target or extension that writes a multi-line template with another tag breaks the rule without touching any file that states it. The step is generic because it ignores the tag, not because the framework decided which tags are safe.

The framework cannot name `sql`, which is family vocabulary. So the list of safe tags has to come from the family, as data.

Suggestion: Make the safe tags an input. For example, `formatMigrationTs(source, { indentInsensitiveTags })`, where the list comes from the plan that rendered the file. `MigrationPlanWithAuthoringSurface` already hands the CLI the file's source, so it can also say which of its tags remove shared indentation. The SQL family then supplies `['sql']`, and the step moves only templates whose tag is on the list. State the rule once, at `tsTaggedTemplateSource`: a caller passes only a tag whose function removes shared indentation, because the formatter re-indents the body. The step's doc comment then links to that statement.

### A14. One construct the step cannot follow turns it off for the whole file

Location: packages/1-framework/3-tooling/migration/src/indent-tagged-templates.ts lines 10-32 and 42-62

Issue: The step is a partial TypeScript lexer that reads one line at a time. When it meets a block comment, a `${` inside a template, or a string it cannot close on its line, it returns the whole file unchanged. Generated SQL files hold none of these today, so this works. But a scaffold change elsewhere in the file, such as a `/** … */` doc comment, would silently turn the step off for every template in the file. The templates would keep the renderer's two-space indentation. That is still correct SQL, but it is the layout this commit set out to fix, and no test would notice.

For generated input of a known shape, a conservative text step is an acceptable design. The alternative is a prettier plugin that uses prettier's own syntax tree and indentation through its `embed` hook. That is more robust but heavier, and it is not recorded anywhere.

Suggestion: Keep the text step, but have it skip only a template it cannot follow instead of the whole file. Teach it to skip a block comment, since a generated file may plausibly gain one. Record the prettier-plugin alternative and why it was not chosen in the Migration System doc (see A17).

### A15. Two places decide how deep the template body is indented

Location: packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts lines 193-197; packages/1-framework/3-tooling/migration/src/indent-tagged-templates.ts lines 85-90; packages/1-framework/3-tooling/migration/src/migration-ts.ts lines 43-50

Issue: `tsTaggedTemplateSource` now indents a multi-line body by two spaces. The step then removes the indentation the lines share and adds the opening line's indentation plus two spaces. So the renderer's indentation matters only when the step does not run or gives up. The two-space unit is written in both places, and it also repeats prettier's default `tabWidth`, which the `format` call does not set. A framework function that prints a value now carries a layout choice that belongs to the file formatter.

Suggestion: Let the formatter own the layout. Either have `tsTaggedTemplateSource` write the body without added indentation and let the step place it, or keep the renderer's indentation as the fallback but set `tabWidth: 2` in the `format` call and have the step take its unit from that same constant.

### A16. No test runs a formatted file and compares its `ops.json`

Location: packages/3-targets/3-targets/postgres/test/migrations/render-typescript.test.ts and packages/3-targets/3-targets/sqlite/test/migrations/render-typescript.test.ts (the new `formatMigrationTs` tests); packages/3-targets/6-adapters/{postgres,sqlite}/test/migrations/render-typescript.roundtrip.test.ts

Issue: The property that makes this commit safe is that the file `writeMigrationTs` writes produces the same `ops.json` as `renderOps`. The new target tests check only the layout of the formatted text. The adapter round-trip tests run the output of `renderTypeScript` without `formatMigrationTs`. So the file users actually get, after prettier and the new step, is never run against `renderOps`. A defect in the step that changed a template's value would pass every test.

Suggestion: In one round-trip test per target, pass the rendered source through `formatMigrationTs` before writing it. Include a multi-line `sql` template nested deep enough that the step moves it. Assert that `ops.json` equals `renderOps(calls)`.

### A17. The docs do not describe the formatting step or the rule it depends on

Location: docs/architecture docs/subsystems/7. Migration System.md line 125; docs/architecture docs/adrs/ADR 195 - Planner IR with two renderers.md lines 133-135

Issue: The Migration System doc says a multi-line text "is written on its own lines inside the template". It does not say that the formatter re-indents the template after prettier, or that this is safe only because the `sql` tag removes shared indentation. ADR 195's argument for why the exception is safe reasons only about the renderer: the file holds a template only when canonicalization leaves the text unchanged. After this commit the file's raw template text is also changed by the formatter. The argument still holds, but only because of a second property of the tag, and that property is not stated.

Suggestion: Add one sentence to each. In the Migration System doc: `writeMigrationTs` re-indents each multi-line tagged template under the line it opens on, and does so only for tags that remove shared indentation (with A13's list as the source). In ADR 195: the formatter changes only indentation that all lines share, which the `sql` tag removes, so the text is unchanged.
