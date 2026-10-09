# Code review: slice 5, migration files write `sql` values (TML-3297)

Range: `24258f35e7...HEAD` on local branch `l65-5` (c542a4e7d5, 14366dbb90, efff1058f1, d2122b9135). Read against design.md section 17, plan.md "Slice 5" and "Done conditions for every slice", spec.md requirement 8 and the Project DoD. Probe logs are in `wip/5-review/` (gitignored). Scratch tests were deleted after the runs.

## Summary

The slice is correct. Every hostile text I tried keeps its SQL through render, run and `ops.json`, in both targets, and every migration function treats a string and a `sql` value of the same text the same way. Four findings remain: no SQLite test catches an unused `sql` import, the refusal message for a wrong value is inaccurate, a multi-line template can carry trailing whitespace that editors strip, and `test:packages` has not been shown green at HEAD.

## What looks solid

- **The renderer keeps SQL unchanged.** 49 hostile texts went through the real calls (`CreateTableCall` with `fn` and `checkExpression`, `AddCheckConstraintCall`, `CreateIndexCall` with expression and `where`, `SetDefaultCall`, `CreatePostgresRlsPolicyCall` with `using` and `withCheck`; on SQLite `CreateTableCall`, `AddColumnCall`, `RecreateTableCall`). For each, the generated file ran under `tsx`, and its `ops.json` equalled `renderOps(calls)`. 98 Postgres cases (with and without function defaults, because defaults refuse `--` and `$$`) and 49 SQLite cases passed. The texts: backticks, backslashes (`E'\n'`, trailing `\`, `\\`), `${`, `\${`, `$${`, `` \` ``, `\u`, `\x`, `\0`, a lone surrogate, an emoji, SOH, VT, FF, DEL, U+0085, U+2028, U+2029, a BOM, a leading NBSP, NUL, CRLF, lone CR, leading and trailing blank lines, shared indentation, first-line-only indentation, tabs, mixed tab and space indentation, whitespace-only and NBSP-only inner lines, an empty inner line, trailing spaces, `--` at line end and as a last-line comment, backslash at line end, `` `) `` and `})` inside the text, `*/`, the empty text and a single space.
- **The probe can fail.** With the canonical check and the `${` escape removed from `renderTaggedTemplateSource` (and framework-components rebuilt), 27 of the 98 Postgres cases failed: CR, CRLF, leading or trailing blank lines, shared indentation, whitespace-only lines, `${`, `\${`, the lone surrogate and others. Evidence: `wip/5-review/plant-pg.log`.
- **The character fallback is a readability rule, not a correctness rule.** Under the same plant, SOH, VT, FF, DEL, U+2028 and U+2029 written raw inside the template still round-tripped. Only the lone surrogate changed (UTF-8 replaces it). The fallback is still right: it keeps invisible characters out of the file.
- **Conversion happens once, at the method entry.** The IR and `ops.json` do not change. `pnpm migrations:regen:examples` leaves every committed example migration unchanged.
- **Values from another installed copy and wrong values.** A marker object (`Symbol.for('@prisma/sql-expression')`) with indented text, passed to `fn`, `checkExpression`, `addCheckConstraint`, `createIndex` (expression and `where`), `createRlsPolicy` (`using`, `withCheck`) and `alterColumnType` (`using`) in a hand-written file, gave the same `ops.json` as the canonical strings. A number, a plain object, `null` and a `String` object at each of seven sites were refused with `CONTRACT.ARGUMENT_INVALID`.
- **Generated files typecheck and import `sql` exactly when used.** A generated Postgres file and a generated SQLite file, each with every SQL site, typecheck against the built facades (`packages/3-extensions/{postgres,sqlite}/dist/migration.mjs`) with `noUnusedLocals` on, both when every text is a template and when every text falls back. A negative control (an unused `sql` import added by hand) fails with TS6133. The public shells `@prisma/orm-target-postgres/target/migration` and `@prisma/orm-target-sqlite/target/migration` export `sql`.
- **A real planner-generated file runs end to end.** `test/integration/test/cli-journeys/sql-expression-literals.e2e.test.ts` plans, self-emits (runs the generated `migration.ts`), applies and verifies a schema with a multi-line CHECK and `--` comments. It passes at HEAD.
- **The implementer's planted defects are real.** `wip/5/plant-*.log` shows each fix removed and a test failing: passthrough of `sqlTextOf` in each method, missing import in each target, tagged postcheck, untagged spec default, and each renderer check.

## Findings

### C01. No SQLite test fails when `sql` is imported but not used

Location: packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts lines 107–112; packages/3-targets/3-targets/sqlite/test/migrations/render-typescript.test.ts

Issue: An unused `sql` import is a lint error in the user's project (`noUnusedImports`, `noUnusedLocals`) in every generated SQLite migration. Postgres has an `it.each` over every call class that asserts the import appears exactly when a template is printed. SQLite has only positive cases. I made SQLite's `sqlTagImports` always return the requirement. All 224 tests in `@internal/target-sqlite test/migrations` still passed. No SQLite test typechecks a generated file either.

Suggestion: Mirror the Postgres test in the SQLite `render-typescript.test.ts`: for one call of each class, plus an `AddColumnCall` and a `RecreateTableCall` with a fallback default and with no function default, assert `facadeImportNames(output).includes('sql') === /\bsql`/.test(body)`.

Evidence:

```
# sqlTagImports planted to `const usesTag = true || texts.some(...)`
mise exec -- pnpm --filter @internal/target-sqlite test test/migrations
      Tests  224 passed (224)
```

(`wip/5-review/plant-sqlite-always-import.log`.)

### C02. The refusal message says a `sql` value is required, but a string is accepted, and it does not name the argument

Location: packages/2-sql/4-lanes/relational-core/src/contract-free/column.ts lines 21–25 (calls `requireSqlExpression(value, 'SQL text')`)

Issue: A wrong value in any SQL argument of a migration file gives `CONTRACT.ARGUMENT_INVALID: SQL text must be a sql`...` value.` That is wrong: a string is also accepted, and the string form is permanent. The message also does not say which argument failed. A file has many SQL arguments, so the user must search. This path is reached from JavaScript, from `as never` or `as any` casts, and from `null` written for an absent option.

Suggestion: Give `sqlTextOf` the argument's name and say both forms, for example `createIndex extras.where must be a string or a sql`...` value.` Keep `requireSqlExpression` unchanged for its other callers. Add the name at each call site (`fn`, `checkExpression`, `addCheckConstraint expression`, `createIndex expression`, `createIndex extras.where`, `createRlsPolicy using` / `withCheck`, `alterColumnType using`, SQLite `addColumn` / `recreateTable` default expression). Update the `column.test.ts` assertion.

Evidence: a hand-written Postgres migration file with `using: (null as never)`, run under `tsx`:

```
{"error":"CONTRACT.ARGUMENT_INVALID: SQL text must be a sql`...` value.\nSQL text must be a sql`...` value.\n"}
```

The same message came from all 28 cases (four wrong values at seven sites).

### C03. A multi-line template can hold trailing whitespace that editors remove on save

Location: packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts lines 192–200 (`templateHoldsUnchanged`)

Issue: A multi-line text whose line ends in spaces or a tab is written as a template with that trailing whitespace in the file. A common editor setting (VS Code `files.trimTrailingWhitespace`, `.editorconfig` `trim_trailing_whitespace`) strips it when the user saves the file. Users do edit migration files, for example to fill placeholders. Inside a SQL string constant that spans lines (`'a  \nb'`), the change alters the stored value and the operation, with no warning. The string-literal form writes `\n`, so it is immune. PSL `sql` literals have the same exposure, so this is a choice, but here the fix costs one condition.

Suggestion: In `templateHoldsUnchanged`, return `false` when the text has a line break and any line matches `/[ \t]$/`. Add a fallback case to the `tagged-literal.test.ts` table.

Evidence: `renderTaggedTemplateSource('sql', "x = 'a  \nb'")` returns ``sql`\nx = 'a  \nb'\n` `` with `usesTag: true` (probe output, case "trailing spaces on a line").

### C04. `pnpm test:packages` has not been shown green at HEAD

Location: done condition in plan.md "Done conditions for every slice"; `wip/5/v-test-packages.log`

Issue: The implementer's only `test:packages` run (15:51) failed in 4 files. One was this slice's test, `render-typescript.roundtrip.test.ts` "a migration file written with sql values produces the same ops.json as one written with strings", which timed out at 8000 ms under full load. Commit efff1058f1 (15:53) raised that timeout to `repeatedScriptRuns` and split out the typecheck, but `test:packages` was not run again. The other three failures (`all-shells-tarball`, `module-identity`, `cross-shell-tarball`) are `pnpm install` failures with "High-risk trust downgrade for @vercel/detect-agent@1.2.5". They come from the registry, not from this slice, but the report does not classify them.

Suggestion: Run `pnpm test:packages` once at HEAD and save the log. Record the three tarball failures as an environment failure with that fingerprint (`ci-failure-classification`), or show that they also fail on `main`.

Evidence: I ran each touched test file alone at HEAD, and all pass: adapter-postgres 49, adapter-sqlite 5, target-postgres 108, target-sqlite 226, framework-components `tagged-literal.test.ts` 110, relational-core `column.test.ts` 14 (`wip/5-review/t-*.log`).

```
wip/5/v-test-packages.log:
 FAIL  |@internal/adapter-postgres| test/migrations/render-typescript.roundtrip.test.ts > ... > a migration file written with sql values produces the same ops.json as one written with strings
Error: Test timed out in 8000ms.
 Test Files  4 failed | 1736 passed (1740)
```

## Deferred (out of scope)

- **Adapter tests read framework-components from `dist`.** A change to `renderTaggedTemplateSource` is invisible to the adapter round-trip tests until `@internal/framework-components` is rebuilt. My first planted run passed all 98 cases for this reason. This is how the workspace resolves packages, not something this slice introduced. Anyone planting a defect in a framework package must rebuild it first.
- **The structure of `renderTaggedTemplateSource`, the name `MigrationSqlText`, and the ADR 195 wording.** These are system-design concerns, covered by the architect review (A01–A04 in `system-design-review.md`).

## Already addressed

None. This is the first code-review round for slice 5.

## Acceptance-criteria verification

| AC | Verdict | Detail |
| --- | --- | --- |
| AC1: `renderTaggedTemplateSource` single-line, multi-line, backtick, backslash, `${`; fallback for leading whitespace, blank first line, CR, NBSP-only line (plan "Slice 5" test 1) | **PASS** | `tagged-literal.test.ts` asserts the exact source and `usesTag`. Each template case is also read back through `resolveTemplateTagEscapes` and `canonicalizeTaggedLiteralBody` after 6-space indentation and must equal the input. The fallback table asserts the exact string literal for each named case, plus trailing blank line, whitespace-only line, NUL. |
| AC2: Adapter round trip with a multi-line CHECK, a policy predicate with `"userId"`, an index `where` and a fallback text; `ops.json` equals `renderOps(calls)` (test 2) | **PASS** | Postgres `render-typescript.roundtrip.test.ts` adds `user_email_length` (multi-line), `withCheck: ("userId" = auth.uid())`, `where`, and `expression: '  lower(email)'` (fallback). It asserts each rendered form, runs the file and checks `toEqual(renderOps(calls))`. SQLite adds a multi-line and a fallback `fn` default the same way. My 147 hostile-text cases extend this to every site. |
| AC3: each Postgres migration function, called with strings and with `sql` values of the same text, gives identical ops (test 3) | **PASS** | `postgres-migration-op-builders.test.ts` covers `createIndex` expression and `extras.where`, `addCheckConstraint`, `createRlsPolicy` `using` and `withCheck`, `alterColumnType` `using`, `fn` and `checkExpression`, comparing whole ops through a lowerer that serializes the AST. The implementer's passthrough plants fail it (`wip/5/plant-sqlTextOf-passthrough-opbuilders.log`: 6 failed). |
| AC4: committed `examples/prisma-8-demo` migrations still produce their committed `ops.json` (test 4; Project DoD) | **PASS** | I ran `pnpm migrations:regen:examples`; `git status` shows no change. The three named migrations hold `fn`, `checkExpression`, `where` or `expression` as strings. |
| AC5: a file written with `sql` values (Postgres and SQLite) produces the same `ops.json` as the same file with strings (test 5) | **PASS** | Both adapter round-trip files write one hand-written file twice (strings, `sql` templates) and assert byte-equal `ops.json`. Postgres covers CHECK, `where`, policy predicates, `fn`, `alterColumnType`; SQLite covers `createTable` `fn`, `addColumn` and `recreateTable` function defaults. The tests assert the `sql` form was used and that the string run holds the expected SQL. |
| AC6: SQLite `renderPostcheck` still writes a string; the renderer falls back for a lone surrogate, a control character, U+2028, U+2029 (test 6) | **PASS** | `op-factory-call.test.ts` "renders a column default as a sql template and its planner-built postcheck SQL as a string" asserts the whole rendered call; the tagged-postcheck plant fails it. The four fallbacks are rows of the `tagged-literal.test.ts` table. |
| AC7: `sqlTextOf` rebuilds a value from another copy (indented text comes back canonical) and refuses anything else (test 7) | **PASS** | `column.test.ts` passes a marker object with indented text and asserts the canonical string; a plain object is refused with the exact code and message. My probe confirms the same through every migration function in a running file. The message itself is C02. |
| AC8: the Postgres facade exports `sql`; the `sql` import appears exactly when a template was printed (test 8) | **PASS** | `render-typescript.test.ts` asserts `migrationFacade.sql === sql`, and for every call class plus template and fallback-only calls, that the import list holds `sql` exactly when the body holds `` sql` ``. A second test pins which classes print templates. The SQLite equivalent is missing (C01). |
| AC9: spec requirement 8 and the Project DoD line, a newly generated `migration.ts` writes a single-line text with both quote kinds as a template literal | **PASS** | It is now a `sql` template: `tagged-literal.test.ts` "both quote kinds" and the round trip's ``checkExpression("user_email_check", sql`"email" <> ''`)``. A text with both quote kinds that the tag cannot hold falls back to an untagged template (tested). |
| AC10: done conditions (build, typecheck, test:packages, lint family, fixtures:check, upgrade coverage, e2e files the slice depends on) | **WEAK** | Build, typecheck, lint, lint:deps, lint:casts (delta 0), lint:throws (delta 0), check:error-reference, fixtures:check, lint:framework-vocabulary and check:upgrade-coverage logs pass. The e2e journey passes when I run it. `test:packages` has no green run at HEAD (C04). |

### Summary

| Result | Count | ACs |
| --- | --- | --- |
| PASS | 9 | AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9 |
| FAIL | 0 | |
| NOT VERIFIED | 0 | |
| WEAK | 1 | AC10 |
