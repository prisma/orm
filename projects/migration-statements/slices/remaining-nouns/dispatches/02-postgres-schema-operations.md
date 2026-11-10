# Dispatch 2 — three Postgres schema operations

**Slice:** [`../spec.md`](../spec.md) § "What each statement does", Namespaces · **Plan:** [`../plan.md`](../plan.md) · **Branch:** `tml-3537-namespaces`

## Outcome

A hand-written Postgres `migration.ts` can move a table to another schema, rename a schema, and drop a schema. Each is a planner call that renders to `migration.ts` and to `ops.json`, and re-running the file reproduces `ops.json`. The planner does not yet plan any of them from a statement; that is dispatches 3 and 4.

## The three operations

| Operation | SQL | Class | Notes |
| --- | --- | --- | --- |
| Move a table to another schema | `ALTER TABLE "a"."t" SET SCHEMA "b"` | `widening` | Postgres carries indexes, constraints and sequences owned by the table with it, and foreign keys from other tables keep pointing at it. Check that in a test on PGlite rather than assuming it. |
| Rename a schema | `ALTER SCHEMA "a" RENAME TO "b"` | `widening` | Everything in the schema moves with it. |
| Drop a schema | `DROP SCHEMA "a"` | `widening` | Without `CASCADE`: the planner drops the tables first, and each table drop is what the user is asked about. A schema that still holds objects fails at the precheck, naming them. |

Follow `CreateSchemaCall` and `RenameTableCall` in `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` as the pattern. Each new operation needs:

- a call class in the `PostgresOpFactoryCall` union, frozen, with `factoryName`, `operationClass`, `label`, `toOp`, `renderTypeScript` and `importRequirements`;
- a typed DDL node, lowered through the control adapter like `createSchema`, not raw SQL text, unless the DDL builder cannot express it, in which case say so in the report;
- prechecks and postchecks that follow ADR 038's rule (a postcheck may hold before the operation runs only when the operation's full effect is already in place): the table exists in the new schema and not the old one; the schema exists under the new name and not the old one; the schema is gone;
- a facade method on `PostgresMigration` (`postgres-migration.ts`) with the same arguments the call renders, so `migration.ts` re-runs reproduce `ops.json`. Name the methods after the SQL they run, as `createSchema` and `renameTable` are named. The method that moves a table takes `{ schema, table, to }` where `to` is the schema it moves to;
- a `classifyCall` bucket in `issue-planner.ts`: schema renames and table moves go with the renames, and the schema drop after the table drops;
- an entry in `operation-subjects.ts` for the drop, so a destructive subject is never named by factory name alone (a schema drop loses nothing itself, but map it);
- the operation id scheme the others use.

## Do

1. Tests first, red before each change, in the Postgres target package: the call renders the expected TypeScript and the expected `ops.json`; each facade method produces the same operation as the call; each operation applies on PGlite against a real table and its checks hold afterwards and skip a second run; the table move keeps a foreign key from another table and the table's own index and primary key; the schema drop fails its precheck while a table remains.
2. Implement the three calls, nodes, facade methods, buckets and subjects.
3. Update the error reference if a new error code is added. Add the three methods to the Postgres migration facade's documentation where `createSchema` and `renameTable` are documented (grep for them in `docs/` and the package READMEs).

## Do not

- Do not plan any of these from a statement or from the diff. Dispatches 3 and 4 do that.
- Do not add SQLite versions; SQLite has no schemas.
- Do not change `diff-database-schema.ts` or `statement-planning.ts`.

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run only named files inside `test/integration` with `pnpm test <file>`.
- Use the shell's Node and `pnpm`. Never `npx`.
- No comments where the code can say it; no bare `as` casts in production code (`blindCast`/`castAs` from `@internal/utils/casts`); no file extensions in imports; no backwards-compatibility exports.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines. Stage files explicitly.
- Do not push. Do not open a PR.
- Save slow command output under `wip/` and read the file.

## Done when

- Typecheck; lint and tests with coverage in the Postgres target package and any other touched package; `lint:deps`; `fixtures:check`; `check:error-reference` if a code was added; `lint:throws`; `lint:casts`.
- `pnpm --filter @internal/target-postgres test` (or the package's real name) is green, including the new PGlite tests.
- The hand-off to dispatches 3 and 4 is true: the three calls can be constructed by the planner and rendered.

## Report

Plain English, short sentences: the three method names and their arguments, what the PGlite tests showed about what moves with a table, the gates run with results, anything the brief did not cover, and the commits.
