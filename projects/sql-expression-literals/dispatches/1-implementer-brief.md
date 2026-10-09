# Brief: slice 1, line comments in raw SQL are safe (TML-3287)

You implement slice 1 of the project "SQL expression literals". You work in the git worktree at the current directory, on branch `tml-3287-line-comments-in-raw-sql`, which starts from `origin/main`. This slice depends on no other slice. Do not read, write or run anything outside this worktree. Do not use `/tmp`; use the gitignored `wip/` folder for scratch files. Run node, pnpm and git through `mise exec --`.

The project files (`projects/sql-expression-literals/`) are not on this branch and live outside this worktree, which you may not read, so this brief carries everything you need; the design section is copied below.

## Read first

1. `CLAUDE.md` at the worktree root and `.agents/rules/README.md`, then the rules it lists under Testing, TypeScript & Typing and Architecture.
2. The design section and the tests list below.
3. ADR 234 (`docs/architecture docs/adrs/ADR 234 - Content-addressed wire names for Postgres-normalized objects.md`) and `docs/architecture docs/subsystems/7. Migration System.md`.

## Outcome

Every place the Postgres and SQLite planners put contract SQL inside a statement holds it as an `OpaqueSql` node and renders it through `renderOpaqueSql`, so a body whose last line ends in a `--` comment produces valid DDL. Wire names keep line breaks in bodies that contain `--`, so moving a line break around a comment changes the name. Output and names for every body without `--` are unchanged; no committed `ops.json`, `migration.json` or wire name changes.

## Design (project design.md section 14, checked against `main` on 2026-09-30)

### 14.1 The node and its renderer

New file `packages/2-sql/4-lanes/relational-core/src/ast/opaque-sql.ts`; add `export * from '../ast/opaque-sql';` to `src/exports/ast.ts` (that file is an `exports/` barrel, where re-exports are allowed).

```ts
/**
 * SQL text that Prisma does not parse, placed inside a larger statement: a CHECK or policy predicate, an index element
 * list or predicate, a column default, or an ALTER COLUMN TYPE conversion. ADR 244 calls such text opaque.
 */
export class OpaqueSql {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
    Object.freeze(this);
  }
}

export function opaqueSql(text: string): OpaqueSql {
  return new OpaqueSql(text);
}

/**
 * The text as a statement includes it. Text containing `--` ends with a line break, so a line comment on its last
 * line cannot hide what the statement writes after it.
 */
export function renderOpaqueSql(sql: OpaqueSql): string {
  return sql.text.includes('--') ? `${sql.text}\n` : sql.text;
}
```

The invariant: every site that places contract SQL inside a statement renders it through `renderOpaqueSql`. Output is byte-identical to today for any text without `--`, and no committed `ops.json` contains `--`, so no committed `ops.json` or `migrationHash` changes.

### 14.2 DDL nodes hold `OpaqueSql`

Node fields become `OpaqueSql`; node constructors take `OpaqueSql`; contract-free factories that migration files call keep taking strings and wrap them with `opaqueSql`.

| Node | Field | Factory that wraps |
| --- | --- | --- |
| `FunctionColumnDefault` (`relational-core/src/ast/ddl-types.ts`, line 53) | `expression: OpaqueSql` | `fn(expression: string)` in `relational-core/src/contract-free/column.ts` (line 27) |
| `CheckExpressionConstraint` (same file, line 213) | `expression: OpaqueSql` | `checkExpression(name, expression: string)` (same, line 62) |
| `PostgresCreatePolicy` (`postgres/src/core/ddl/nodes.ts`, line 207) | `using`, `withCheck`: `OpaqueSql \| undefined` | `createPolicy` in `postgres/src/contract-free/ddl.ts` (line 128; options keep `using?: string`, `withCheck?: string`) |
| `PostgresCreateIndex` (same, line 300) | `where: OpaqueSql \| undefined`; `elements: { columns } \| { expression: OpaqueSql }` (`DdlIndexElements`, line 296) | `createIndex` in `postgres/src/contract-free/ddl.ts` (line 173; options take `elements: CreateIndexElements`, `where: string \| undefined`) |

Move `CreateIndexElements` (`{ readonly columns: readonly string[] } | { readonly expression: string }`) from `postgres/src/core/migrations/operations/indexes.ts` (line 46) to `postgres/src/core/ddl/nodes.ts`, next to `DdlIndexElements`. `operations/indexes.ts`, `contract-free/ddl.ts` and `core/migrations/op-factory-call.ts` (line 80) import it from there.

These places build nodes directly and wrap their string with `opaqueSql`: `op-factory-call.ts` lines 147 and 149, the temporary default in `postgres/src/core/migrations/planner-recipes.ts` line 64, and `sqlite/src/core/migrations/column-ddl-rendering.ts` line 96. Search for `new FunctionColumnDefault(`, `new CheckExpressionConstraint(`, `new PostgresCreatePolicy(` and `new PostgresCreateIndex(` to confirm there are no others outside tests. Code that reads these fields reads `.text`, including the adapters' `autoincrement()` and SQLite `now()` checks and the TypeScript renderers.

### 14.3 Every site renders through `renderOpaqueSql`

| Site (line on `main`) | New template |
| --- | --- |
| PG `pgRenderDdlColumnDefault` (`3-targets/6-adapters/postgres/src/core/control-adapter.ts` line 1868) | `` `DEFAULT (${renderOpaqueSql(def.expression)})` `` |
| PG CHECK in CREATE TABLE (same, line 1944) | `` `CONSTRAINT ${quoteIdentifier(name)} CHECK (${renderOpaqueSql(constraint.expression)})` `` |
| PG policy (same, lines 2054 and 2057) | `` ` USING (${renderOpaqueSql(node.using)})` ``, `` ` WITH CHECK (${renderOpaqueSql(node.withCheck)})` `` |
| PG index (same, line 2116 and the element list) | element list `renderOpaqueSql(node.elements.expression)`; `` ` WHERE (${renderOpaqueSql(node.where)})` `` |
| PG `addCheckConstraint` (`postgres/src/core/migrations/operations/constraints.ts` line 157) | `` `... CHECK (${renderOpaqueSql(opaqueSql(expression))})` `` |
| PG `buildColumnDefaultSql`, function case (`postgres/src/core/migrations/planner-ddl-builders.ts` line 168) | `` `DEFAULT (${renderOpaqueSql(opaqueSql(columnDefault.expression))})` `` after `assertSafeDefaultExpression` |
| PG `alterColumnType` hand-written `using` (`postgres/src/core/migrations/operations/columns.ts`) | `` ` USING ${renderOpaqueSql(opaqueSql(options.using))}` `` |
| SQLite `sqliteRenderDdlColumnDefault` (`6-adapters/sqlite/src/core/control-adapter.ts` line 752) | `` `DEFAULT (${renderOpaqueSql(def.expression)})` `` |
| SQLite `buildColumnDefaultSql`, function case (`sqlite/src/core/migrations/planner-ddl-builders.ts` line 81) | `` `DEFAULT (${renderOpaqueSql(opaqueSql(columnDefault.expression))})` `` after `assertSafeDefaultExpression` |

The four rows that wrap a string only to render it are sites a stalled typed-DDL project did not convert to DDL nodes. The index element list keeps its enclosing parentheses and gets no extra pair: it may be a list such as `lower(email), id`. Not changed: the data-transform `SELECT [NOT] EXISTS (…)` wrapper, which wraps a lowered query plan, not contract SQL. The schema IR and contract IR keep strings.

### 14.4 Wire names keep line breaks around `--`

`normalizeSqlBody` (`packages/2-sql/1-core/schema-ir/src/naming.ts` line 125) becomes:

```ts
export function normalizeSqlBody(sql: string): string {
  if (!sql.includes('--')) return sql.replace(/\s+/g, ' ').trim();
  return sql
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}
```

Update its doc: a body with a line comment keeps its line breaks, because a line break ends the comment. The rule gives the same output on its own output, which policies rely on (they normalize twice). Every body without `--`, and every one-line body, hashes exactly as before. No committed body contains `--`, so no committed wire name changes. A user body that already has both `--` and a line break gets a new wire name once; the upgrade fragment says so.

## Tests (each fails if the behaviour it names is removed; write them first)

- `relational-core/test/ast/opaque-sql.test.ts`: `renderOpaqueSql` returns text without `--` unchanged; appends `\n` to text containing `--` anywhere, including inside a string constant; `OpaqueSql` is frozen.
- `6-adapters/postgres/test/migrations/opaque-sql-line-comment.integration.test.ts` (PGlite, like the neighbouring integration tests): with a body whose last line is `-- trailing comment`, each of these executes and has its effect: CREATE TABLE with a CHECK, `addCheckConstraint` on an existing table, CREATE POLICY with USING and WITH CHECK, CREATE INDEX with the element list `lower(email), id -- c` and with a WHERE predicate.
- `6-adapters/sqlite/test/lower-to-execute-request.test.ts` (extend): `fn('1 -- c')` renders `DEFAULT (1 -- c\n)`.
- `schema-ir/test/naming.test.ts` (extend): `normalizeSqlBody` for these rows: E1 `a --c\nb` and E2 `a --c b` differ; a one-line body and a body without `--` are unchanged from today's output; CRLF and a lone CR end a line; blank and whitespace-only lines are dropped; the function gives the same output on its own output; the pinned hash table in the file is unchanged; check, index and policy hashes of E1 and E2 differ.
- The existing render and lowering tests are updated for the new field types; every exact-SQL assertion stays byte-identical.
- `git status` shows no committed `ops.json` or `migration.json` changed after `pnpm fixtures:check`.

## Docs and upgrade instructions

- ADR 234, "Normalizer stability": the `--` rule and why no existing name changes.
- `docs/architecture docs/subsystems/7. Migration System.md`: new section "Opaque SQL in DDL": the node, the renderer rule, the invariant, the template-string sites, the data-transform exception.
- Upgrade fragment `upgrade-instructions/pending/line-comments-in-raw-sql/extension/instructions.md` (follow `skills-contrib/record-upgrade-instructions/SKILL.md` and the pending fragments as models): change `ddl-nodes-hold-opaque-sql` (detection `**/*.{ts,mts,cts}`: `new (FunctionColumnDefault|CheckExpressionConstraint|PostgresCreatePolicy|PostgresCreateIndex)\(`; say also that code reading `.expression`, `.using`, `.withCheck` or `.where` of these nodes now reads `.text`, which no pattern detects) and `sql-with-a-line-comment-gets-a-new-wire-name` (a body with both `--` and a line break gets a new index, check or policy name once; the next migration renames or recreates it). Add an `app` fragment too if `pnpm check:upgrade-coverage` requires one. Test each detection pattern against a true positive and the nearest false positive.

## Rules

- Repository rules: `pnpm` only, never `npx`, never `vitest` directly (`pnpm test <path>` in the package); no `any`; no bare `as` in production code; no file extensions in imports; no comments unless the code cannot say it (the two doc comments above are the exception, they document exported surface); no re-exports outside `exports/`; test names omit "should"; whole-shape assertions; `pnpm lint:deps` must pass.
- Markdown prose is never hard-wrapped: one paragraph per line.
- After changing exported types in a package, build it before typechecking downstream.

## Verify

Each once, output saved under `wip/s1/` and read from the file: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:casts`, `pnpm lint:throws`, `pnpm check:error-reference`, `pnpm lint:framework-vocabulary`, `pnpm fixtures:check`, `pnpm test:packages`, and `pnpm check:upgrade-coverage --mode pr --prev "$(git merge-base origin/main HEAD)" --head HEAD` after committing. In `test/integration`, run only the files that exercise DDL rendering of checks, indexes, policies and defaults: `pnpm test test/cli-journeys/expression-index-migration test/cli-journeys/rls test/authoring/parity` and any file whose imports you changed. **Never run the full integration or e2e suites; the Bash hook blocks them.** Known local failures to report but not fix: the three publish-shell tarball tests. Rerun any other failing test file alone once.

## Commits

- Small commits, each one step, explicit `git add <paths>`. This brief lives in the gitignored `wip/` folder of this worktree; do not commit it. Describe the work in the commit messages.
- `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution in any commit. Never amend, squash, rebase or force-push. Do not push. Do not open a pull request.

## When you finish or stop

Report in plain English, in short sentences: what you built, each verification result with its log path, whether any committed `ops.json`, `migration.json` or wire name changed (it must not), and anything you could not do.
