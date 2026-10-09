# Code review: slice 4, migration files write template literals (TML-3290)

Branch `tml-3290-migration-files-template-literals`, range `tml-3287-line-comments-in-raw-sql...HEAD` (4 commits: `f2ee73b42c`, `a3f278df88`, `c1396c1514`, `660f57ffd3`). Reviewed at HEAD `660f57ffd3`.

## Summary

The slice does what the brief asks. `tsQuotedTextSource` writes a single-line text that holds both quote kinds as an untagged template literal, and its escaping is correct. `tsObjectSource` gives exactly the old object layout for every input `jsonToTsSource` can produce. The five listed render sites use it, and the tests pin exact output. `ops.json` and the committed migrations do not change.

The main gap is coverage, not correctness. Three other render sites still write SQL text as an escaped string: Postgres `SetDefaultCall.defaultSql`, SQLite `AddColumnCall` (the column's `defaultSql`), and SQLite `RecreateTableCall` (column `defaultSql` and postcheck `sql`). The brief did not list them, but the new doc paragraph says "each SQL text (a column default, ...)" is handled, which is not true for these calls (F01). Two small escaping edge cases remain: a lone surrogate is corrupted when the file is written as UTF-8 (F02), and other control characters are written raw (F03).

## What looks solid

- Escaping order is right: backslash first, then backtick, then `${`. I evaluated the output with `eval` for 16 inputs, including `\${`, `$${`, a trailing backslash, a backslash before a backtick, `A` and `\x41` as text, tab and NUL. Every template evaluated to exactly the original text.
- The fallback list is right. A raw CR in a template literal is normalised to LF when evaluated, so CR must fall back; U+2028 and U+2029 fall back too; LF falls back by design.
- `tsObjectSource` keeps the old layout. The added `!singleLine.includes('\n')` check cannot change `jsonToTsSource` output: a nested multi-line array or object is always longer than its one-line form, which already exceeded 80 characters, and `tsStringLiteral` never emits a raw line break. Key rendering (`renderKey`, including `__proto__`), `{}` for no entries, two-space indentation and the trailing comma are the same code as before.
- The policy renderer keeps `input: RenderedRlsPolicyLiteral`, so drift from `createRlsPolicy`'s parameter type is still a compile error. Entry order follows `input`'s key order, `undefined` values are dropped as before, and `using`/`withCheck` go through `tsQuotedTextSource`.
- Tests assert exact strings with `toBe`, and the roundtrip tests execute the written file with `tsx` and compare `ops.json` to `renderOps(calls)`.
- Biome: `style/noUnusedTemplateLiteral` is `"error"` in `biome.jsonc` and is not switched off for test files. Test files on this branch hold untagged, no-interpolation templates with quotes, and `pnpm lint` exits 0 (`wip/s4/lint.log`, `wip/s4/summary.log`). So Biome does not report a template that holds a quote.
- Prettier formats untagged templates as they are, so `singleQuote: true` in `migration-ts.ts` does not rewrite them.

## Findings

### F01. Three SQL text sites still write escaped strings, and the doc paragraph says every SQL text is handled

- Location: `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` line 682 (`SetDefaultCall.renderTypeScript`, `defaultSql: ${jsonToTsSource(this.defaultSql)}`); `packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts` line 398 (`AddColumnCall.renderTypeScript`, `column: ${jsonToTsSource(this.column)}`, where `SqliteColumnSpec.defaultSql` is the full `DEFAULT …` clause) and line 334 (`RecreateTableCall.renderTypeScript`, `contractTable.columns[].defaultSql` and `postchecks[].sql`); `docs/architecture docs/subsystems/7. Migration System.md` line 216.
- Issue: The planner reaches all three. `SetDefaultCall` comes from `mapColumnDefaultNodeIssue` in `issue-planner.ts` when a default is added or changed on an existing column; a text default such as `DEFAULT 'say "hi"'::text` or a function default like `concat("prefix", 'user')` holds both quote kinds and still renders with escaped quotes. SQLite `AddColumnCall` comes from `issue-planner.ts` line 280. So the same default renders as a template in `createTable` and as an escaped string in `addColumn` (SQLite) or `setDefault` (Postgres). The doc paragraph lists "a column default" among the texts written as templates, which is only partly true.
- Suggestion: Route `SetDefaultCall.defaultSql` through `tsQuotedTextSource` (one line, plus one exact-output test). For SQLite `AddColumnCall` and `RecreateTableCall`, either render the spec with `tsObjectSource` so `defaultSql` and postcheck `sql` go through `tsQuotedTextSource`, or leave them and narrow the doc paragraph to name the calls it covers. My recommendation: fix `SetDefaultCall` in this slice, and narrow the doc for the SQLite whole-spec calls with a line in the project's deferred list.

### F02. A lone surrogate in a template literal is corrupted when the file is written

- Location: `packages/1-framework/1-core/ts-render/src/ts-string-literal.ts`, `tsQuotedTextSource`.
- Issue: `tsStringLiteral` uses `JSON.stringify`, which escapes a lone surrogate as `\udXXX`. The template path writes it raw. Written as UTF-8 it becomes U+FFFD, so the evaluated text differs from the original. I confirmed this with `"a"='\uD800'`: `eval` of the output matches before a UTF-8 round trip and does not match after. SQL text rarely holds a lone surrogate, so the risk is low, but it is a regression from the old path.
- Suggestion: Fall back to `tsStringLiteral` when `!text.isWellFormed()` (or `/[\uD800-\uDFFF]/u.test(text)`), and add a test.

### F03. Other control characters are written raw into the template

- Location: same function.
- Issue: Tab, NUL, VT, FF, DEL and other C0 control characters are valid raw inside a template and evaluate correctly, but they become invisible or confusing characters in a committed `migration.ts`. The string-literal path writes them as visible escapes.
- Suggestion: Fall back to `tsStringLiteral` for `[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]` (tab can stay raw). Low priority.

### F04. The policy renderer picks SQL fields by string key

- Location: `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` lines 1800 to 1810.
- Issue: `(key === 'using' || key === 'withCheck') && typeof value === 'string'` is not checked against `RenderedRlsPolicyLiteral`. If either field is renamed, this still compiles and silently falls back to escaped strings. The `.filter(value !== undefined)` is also redundant, since `ifDefined` already omits absent keys.
- Suggestion: Hold the keys in a constant typed against the literal type, for example `const sqlTextKeys: ReadonlySet<keyof RenderedRlsPolicyLiteral> = new Set(['using', 'withCheck'])`, so a rename is a compile error.

### F05. No executed test covers a template that needs escaping

- Location: `packages/3-targets/6-adapters/postgres/test/migrations/render-typescript.roundtrip.test.ts`.
- Issue: The roundtrip texts hold only quotes. Backslash, backtick and `${` escaping is checked only by string equality in `ts-string-literal.test.ts`. I verified those expected strings evaluate back to the input, but no test runs them through `tsx`.
- Suggestion: Add one CHECK or policy predicate with a backslash and `${` (for example `"a" ~ '\d' AND "b" <> '${x}'`) to the Postgres roundtrip, so the `ops.json` comparison covers escaping.

### F06. The `migrations:regen:examples` no-diff check does not exercise the renderer

- Location: `scripts/regen-example-migrations.mjs`; `wip/s4/migrations-regen-examples.log`, `wip/s4/regen-status.log`.
- Issue: The script runs the committed `migration.ts` files to rewrite `ops.json`; it never renders `migration.ts`. So "no diff" proves `ops.json` is stable but says nothing about the renderer. Two committed files hold both quote kinds and would change if scaffolded again: `examples/prisma-8-demo/migrations/app/20260422T0720_initial/migration.ts` line 87 and `examples/prisma-8-demo/migrations/app/20260922T1218_add_post_title_search/migration.ts` line 22. That matches the brief (they are not regenerated).
- Suggestion: Say this in the pull request description, so a reviewer does not read the regen result as proof about rendering and is not surprised the two files keep escaped quotes.

## Deferred

- Integration journey `test/cli-journeys/expression-index-migration`: timed out twice on the loaded machine (`wip/s4/integration-journeys.log` hook timeout, `wip/s4/integration-expression-index-rerun.log` test timeout at 30 s). Leave to CI. The RLS journey files passed.
- `test:packages` failures: the three publish-shell tarball tests (known local failures), `cli-telemetry` `cli-e2e.test.ts` (timeout, still failed on rerun at the 5 s limit, unrelated to this slice), and the Postgres roundtrip `RawSqlCall` test (8 s timeout; the file passed alone in `wip/s4/rerun-pg-roundtrip.log`). None touch this change; CI decides.
- Prettier formatting of emitted templates is not tested end to end. Prettier leaves untagged templates alone, so I do not ask for a test.

## Acceptance-criteria verification

| Criterion from the brief | Verdict | What I read |
|---|---|---|
| `ts-string-literal.test.ts`: both quote kinds give a template | PASS | Test file; exact `toBe`. I reran both ts-render files: 28 passed (`wip/review-s4/ts-render-tests.log`). |
| One quote kind, no quote give a string literal | PASS | Single-only, double-only and no-quote tests; each fails if the both-kinds condition is loosened. |
| Line break and U+2028 give a string literal | PASS | LF, CR, U+2028 and U+2029 tests; each fails if the line-break check is removed. |
| Backtick, backslash, `${` escaped inside a template | PASS | Three tests; I checked each expected string evaluates to the input. |
| `json-to-ts-source.test.ts`: `tsObjectSource` layout rules | PASS | Tests for `{}`, one line with quoted key, over 80 characters, and an entry holding a line break. |
| `jsonToTsSource` output unchanged for objects | PASS | Existing object tests still pass; I showed the added line-break check cannot fire for `jsonToTsSource` input. |
| Postgres `CreateTableCall` exact output | PASS | `op-factory-call.test.ts`, default and CHECK as templates. |
| Postgres `AddColumnCall` exact output | PASS | `op-factory-call.lowering.test.ts`. |
| Postgres `CreateIndexCall` exact output | PASS | Expression and `where` both as templates. |
| Postgres `AddCheckConstraintCall` exact output | PASS | Existing expectation updated from escaped string to template. |
| Postgres `CreatePostgresRlsPolicyCall` exact output | PASS | Multi-line policy with `using` and `withCheck` as templates. |
| SQLite `render-typescript.test.ts` default as template | PASS | `toContain` of the whole `createTable` call; red log `wip/s4/sqlite-red.log` shows it failed before the change. |
| Postgres roundtrip with both-quote CHECK, policy predicate, index `where`; `ops.json` equals `renderOps` | PASS | Test adds all three, asserts the templates appear, runs `tsx`, compares `ops.json`. Passed in `wip/s4/pg-roundtrip.log`. |
| SQLite roundtrip with both-quote text | PASS | Function default only (SQLite has no CHECK, `where` or policy call here). `wip/s4/sqlite-roundtrip.log`. |
| `migrations:regen:examples` produces no diff | WEAK | Exit 0 and empty `wip/s4/regen-status.log`, but the script does not render `migration.ts` (F06). |
| `ops.json` unchanged | PASS | Empty regen status; `fixtures:check` exit 0. |
| Committed migration files not regenerated | PASS | Diff stat touches no file under `examples/`. |
| No migration function, type or import change | PASS | Diff changes only renderers, ts-render exports, tests and one doc. |
| Biome `noUnusedTemplateLiteral` does not report emitted templates | PASS | Rule is `"error"`; test files with such templates lint clean; `pnpm lint` exit 0. |
| Doc paragraph in `7. Migration System.md` | WEAK | Present and one line, but overclaims "each SQL text" (F01). |
| Upgrade fragment only if required | PASS | No fragment added; `wip/s4/upgrade-coverage.log` shows the check ran with no error. |
| Integration journeys (expression-index, RLS) | NOT VERIFIED | RLS passed; expression-index timed out twice (Deferred). |

## Counts

| Category | Count |
|---|---|
| Findings | 6 (F01 medium; F02 to F06 low) |
| PASS | 19 |
| WEAK | 2 |
| FAIL | 0 |
| NOT VERIFIED | 1 |
