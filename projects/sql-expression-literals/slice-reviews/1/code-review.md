# Code review: slice 1, line comments in raw SQL are safe (TML-3287)

Branch `tml-3287-line-comments-in-raw-sql`, range `origin/main..HEAD` (5 commits, 979f6ac56e to 8bcdab3ad4). Reviewer lens: principal engineer, failure modes first.

## Summary

The design is implemented faithfully. Every site listed in design 14.3 renders through `renderOpaqueSql`, the node fields hold `OpaqueSql`, the contract-free factories still take strings, and `normalizeSqlBody` follows the new rule. No committed `ops.json`, `migration.json` or `contract.json` changed, and no committed artefact contains `--`.

One real regression slipped through: the SQLite TypeScript renderer that writes `migration.ts` files still passes the whole `OpaqueSql` node to `jsonToTsSource`, so a planned SQLite migration with a function default is written as `fn({ text: "now()" })`. That file fails to typecheck and throws when it runs. No test covers it. The upgrade fragment's claim that the compiler catches every stale read is false for exactly this kind of code, and the wire-name change is filed only under the `extension` audience although it is visible to apps.

## What looks solid

- `OpaqueSql` is small, frozen, and exported from the `exports/ast` barrel only. `renderOpaqueSql` is a pure function with the documented rule.
- All adapter render sites (PG default, CHECK, policy USING and WITH CHECK, index element list and WHERE; SQLite default) and all template-string sites (PG `addCheckConstraint`, both `buildColumnDefaultSql`, PG `alterColumnType` USING) go through `renderOpaqueSql`. A grep for templates that interpolate `.expression`, `.using`, `.withCheck` or `.where` in both adapters and both targets found no other SQL-placing site. `SET DEFAULT` takes its clause from `buildColumnDefaultSql`, so it is covered. The data-transform `SELECT [NOT] EXISTS (…)` wrapper is correctly left alone.
- Direct constructions of the four nodes outside tests are exactly the ones the brief lists, and each wraps with `opaqueSql`.
- `renderOpaqueSql` edge cases are safe: `--` inside a string constant, `--` on a line other than the last, a body already ending in a line break, and CRLF all get one extra `\n`, which only ends a comment or adds whitespace. Postgres and SQLite both end a `--` comment at `\n`.
- `normalizeSqlBody` is idempotent on both branches (the `--` survives normalization, so the second pass takes the same branch), handles CRLF and lone CR, drops whitespace-only lines, and is unchanged for bodies without `--` and for one-line bodies. The pinned hash table (`naming.test.ts` line 508) is untouched.
- `autoincrement()` and `now()` checks read `.text` in both adapters; the planners compare the contract string before wrapping.
- The PGlite integration test was run red first (5 of 5 failed, `wip/s1/pg-integration-red.log`) and each case asserts a database effect, not only SQL text.
- Existing render tests keep exact SQL assertions; only node-field assertions changed to `opaqueSql(...)`.
- The Postgres TypeScript renderers read `.text`, and example migration regeneration (`fixtures:check`) produced no diff, so `fn(...)` and `checkExpression(...)` printing is exercised for Postgres.

## Findings

### F01 — SQLite migration renderer prints `fn({ text: ... })` (High)

Location: packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts lines 68–74

Issue: `renderDdlColumnDefault` still calls `jsonToTsSource(def.expression)`. `jsonToTsSource` takes `unknown`, so the compiler accepted the object. I ran `CreateTableCall.renderTypeScript()` from the built `dist` with `fn("datetime('now')")` and got:

```
this.createTable({ table: "t", columns: [col("created", "TEXT", { notNull: true, default: fn({ text: "datetime('now')" }) })] })
```

Every SQLite migration the planner writes for a table with a function default (for example `@default(now())`) is affected. The generated `migration.ts` fails typecheck because `fn` takes a string. If it runs anyway, `fn` wraps the object, `def.expression.text === 'now()'` is false, and `renderOpaqueSql` throws `sql.text.includes is not a function`. The `ops.json` written at plan time is correct, so `fixtures:check` cannot see this; there is no SQLite example with migrations and no SQLite renderer test with a function default (all 125 SQLite target migration tests pass at HEAD).

Suggestion: read `.text`, as the Postgres renderer does, and add a test that renders a `CreateTableCall` with `fn(...)` and asserts the whole output string. The test must fail at HEAD.

```ts
return `fn(${jsonToTsSource(def.expression.text)})`;
```

### F02 — Upgrade fragment says the compiler reports every stale read; it does not (Medium)

Location: upgrade-instructions/pending/line-comments-in-raw-sql/extension/instructions.md, paragraph beginning "Code that reads `.expression`"

Issue: The fragment says "the TypeScript compiler reports each one as a type error". That is true for `=== 'now()'` comparisons and for passing the field to a `string` parameter. It is false for template interpolation (`` `DEFAULT (${def.expression})` `` compiles and emits `DEFAULT ([object Object])`) and for any `unknown`-typed sink such as `jsonToTsSource` or `JSON.stringify`. F01 is this exact failure in our own code. An extension author with a custom adapter or renderer follows the fragment, sees a clean typecheck, and ships broken DDL.

Suggestion: say plainly that interpolation into a template string and `unknown`-typed functions are not reported, and tell the reader to search for them. Optionally add a second, advisory detection pattern such as `\$\{[^}]*\.(expression|using|withCheck|where)\}` and `jsonToTsSource\([^)]*\.(expression|using|withCheck|where)\)`; both are noisy, so they belong in prose if not in `detection`.

### F03 — Wire-name change needs an `app` fragment (Medium)

Location: upgrade-instructions/pending/line-comments-in-raw-sql/ (only `extension/` exists)

Issue: The one-time wire-name change affects whoever owns the contract: the emitted `contract.json` (the policy, index and check names are stored there), the storage hash, and the next planned migration. Per the skill, contract files and on-disk migrations belong to the `app` audience. The coverage check did not demand an `app` fragment only because `examples/` did not change; it checks declarations, not audience correctness. Filing the change under `extension` alone means app users who follow the published app guide never see it.

Suggestion: add `upgrade-instructions/pending/line-comments-in-raw-sql/app/instructions.md` with the `sql-with-a-line-comment-gets-a-new-wire-name` change and its prose. Keep or drop the extension copy. A usable detection for the app copy works on emitted contracts, where a line break inside a body is the two characters `\n`:

```yaml
detection:
  glob: "**/contract.json"
  matches:
    - '"[^"]*--[^"]*\\n|"[^"]*\\n[^"]*--'
```

This matches `"a --c\nb"` and `"x\n-- c"`, and does not match `"a -- c"` (no line break) or a file where `--` and `\n` sit in different strings. Test it against both before shipping.

### F04 — Detection pattern misses qualified construction (Low)

Location: upgrade-instructions/pending/line-comments-in-raw-sql/extension/instructions.md, frontmatter `matches`

Issue: I tested the pattern. It matches `new FunctionColumnDefault('now()')` and `new  PostgresCreateIndex ({`, and correctly does not match `new PostgresCreateIndexCall(`, `new MyFunctionColumnDefault(` or `renew CheckExpressionConstraint(`. It misses `new ast.FunctionColumnDefault('x')` (namespace import), and it also fires on code already migrated (`new FunctionColumnDefault(opaqueSql('x'))`), which is acceptable for a detector.

Suggestion: allow an optional qualifier:

```
\bnew\s+(?:[\w$]+\.)?(FunctionColumnDefault|CheckExpressionConstraint|PostgresCreatePolicy|PostgresCreateIndex)\s*\(
```

### F05 — `normalizeSqlBody` doc contradicts itself (Low)

Location: packages/2-sql/1-core/schema-ir/src/naming.ts lines 123–127

Issue: The new paragraph explains that only bodies with `--` and a line break change. The unchanged last line still says "any change re-suffixes all wire names", which this change shows to be false.

Suggestion: reword to "any change to this function can re-suffix wire names; a change must say which bodies it affects", or drop the sentence and link ADR 234 "Normalizer stability".

### F06 — SQLite line-comment test asserts a substring (Low)

Location: packages/3-targets/6-adapters/sqlite/test/lower-to-execute-request.test.ts lines 137–144

Issue: `expect(result.sql).toContain('"n" INTEGER DEFAULT (1 -- c\n)')` would still pass if the renderer added something after the closing parenthesis on the same line. It fails if the fix is removed, so it does its job, but it is weaker than the Postgres exact-SQL tests.

Suggestion: assert the whole `result.sql` with `toBe`, as the neighbouring Postgres lowering tests do.

### F07 — Integration test repeats non-null assertions (Low)

Location: packages/3-targets/6-adapters/postgres/test/migrations/opaque-sql-line-comment.integration.test.ts lines 37–176

Issue: `driver` is `PostgresControlDriver | undefined` and every use writes `driver!`. That is noise and hides a missing driver behind a runtime error.

Suggestion: a small `requireDriver()` helper, or follow whatever the neighbouring integration tests do.

## Deferred (out of scope)

- Planner-side wrapping in both `buildColumnDefaultSql` functions cannot be reached with `--`: `assertSafeDefaultExpression` rejects comment tokens first. The wrap keeps the invariant uniform, as the design says; it cannot have a behaviour test. No action.
- A hand-written `migration.ts` whose policy, check or index body has `--` on a non-final line would produce different `ops.json` bytes (one extra `\n`) if its author re-runs it to re-emit. Committed `ops.json` files are only checked by hash, not re-derived, so nothing breaks on apply. Worth one sentence in the `app` fragment (F03), not a code change.
- Postgres stores policies and checks in deparsed form, so comments never reach introspection. SQLite stores the `CREATE TABLE` text verbatim, so a hand-written `fn('1 -- c')` default would be introspected with its comment. Before this slice such a statement did not run at all, so this is not a regression.
- `jsonToTsSource(value: unknown)` lets any non-JSON object through silently. A narrower signature would have caught F01. That is a framework change outside this slice.
- The three publish-shell tarball tests and the `cli-telemetry` e2e failure in `wip/s1/test-packages.log` are the known local failures; not related to this slice.

## Acceptance-criteria verification

| Item | Verdict | What I read |
| --- | --- | --- |
| `opaque-sql.test.ts`: text without `--` unchanged | PASS | test file; ran it (3 passed) |
| `opaque-sql.test.ts`: appends `\n` when `--` anywhere, including in a string constant | PASS | cases `price > 0 -- positive`, `-- leading\nprice > 0`, `note <> '--'`, exact `toEqual` |
| `opaque-sql.test.ts`: `OpaqueSql` is frozen | PASS | `Object.isFrozen` assertion |
| PGlite integration: CREATE TABLE with CHECK | PASS | test lines 63–83; also covers a function default; red log shows it failed before the fix |
| PGlite integration: `addCheckConstraint` on existing table | PASS | lines 85–100 |
| PGlite integration: CREATE POLICY with USING and WITH CHECK | PASS | lines 102–128, asserts `pg_policies` whole rows |
| PGlite integration: CREATE INDEX element list `lower(email), id -- c` | PASS | lines 130–149, asserts `indexdef` |
| PGlite integration: CREATE INDEX with WHERE | PASS | lines 151–175 |
| SQLite `fn('1 -- c')` renders `DEFAULT (1 -- c\n)` | WEAK | substring assertion (F06) |
| `naming.test.ts`: E1 and E2 differ | PASS | exact outputs `'a --c\nb'`, `'a --c b'`; ran file (82 passed) |
| `naming.test.ts`: one-line and no-`--` bodies unchanged | PASS | two cases with exact expected output |
| `naming.test.ts`: CRLF and lone CR end a line | PASS | exact outputs |
| `naming.test.ts`: blank and whitespace-only lines dropped | PASS | exact output |
| `naming.test.ts`: idempotent | PASS | four bodies, both branches |
| `naming.test.ts`: pinned hash table unchanged | PASS | diff has no edits in the pinned block (line 508) |
| Check, index and policy hashes of E1 and E2 differ | PASS | `computeCheckContentHash`, `computeIndexContentHash` (expression and where), `computeContentHash` in `rls-canonicalize.test.ts` (using and withCheck) |
| Existing render and lowering tests keep exact SQL | PASS | test diffs change only node-field assertions |
| ALTER COLUMN TYPE USING with `--` | PASS | `op-factory-call.lowering.test.ts`, exact `toBe` |
| Site: PG `pgRenderDdlColumnDefault` | PASS | control-adapter.ts line 1868 |
| Site: PG CHECK in CREATE TABLE | PASS | line 1944 |
| Site: PG policy USING and WITH CHECK | PASS | lines 2054, 2057 |
| Site: PG index element list and WHERE | PASS | lines 2105, 2116; no extra parentheses around the list |
| Site: PG `addCheckConstraint` | PASS | operations/constraints.ts line 158 |
| Site: PG `buildColumnDefaultSql` function case | PASS | planner-ddl-builders.ts line 169, after the safety check |
| Site: PG `alterColumnType` USING | PASS | operations/columns.ts line 80 |
| Site: SQLite `sqliteRenderDdlColumnDefault` | PASS | 6-adapters/sqlite control-adapter.ts line 752 |
| Site: SQLite `buildColumnDefaultSql` function case | PASS | planner-ddl-builders.ts line 82 |
| Readers of the fields use `.text` (brief 14.2) | FAIL | SQLite TypeScript renderer does not (F01) |
| No committed `ops.json`, `migration.json` or wire name changes | PASS | no `.json` in the diff; grep of 563 committed `ops/migration/contract.json` files finds no `--`; `wip/s1/fixtures-check.log`; clean `git status` |
| ADR 234 "Normalizer stability" | PASS | new paragraph states the rule, why no committed name changes, and idempotence |
| Migration System "Opaque SQL in DDL" | PASS | node, rule, invariant, template-string sites, data-transform exception all present |
| Upgrade fragment, `ddl-nodes-hold-opaque-sql` | WEAK | content correct except the compiler claim (F02); pattern tested (F04) |
| Upgrade fragment, `sql-with-a-line-comment-gets-a-new-wire-name` | WEAK | wrong audience only (F03) |
| `check:upgrade-coverage` | PASS | `wip/s1/upgrade-coverage.log` exits cleanly; it did not require an `app` fragment |

## Counts

| Severity | Count |
| --- | --- |
| High | 1 |
| Medium | 2 |
| Low | 4 |
| Total | 7 |

| Verdict | Count |
| --- | --- |
| PASS | 30 |
| WEAK | 3 |
| FAIL | 1 |
| NOT VERIFIED | 0 |
