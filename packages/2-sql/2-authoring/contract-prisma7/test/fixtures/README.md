# Prisma 7 interpreter fixtures

Each folder is one case: a Prisma 7 schema (`schema.prisma`, or a `schema/` folder for multi-file cases) and either `expected-contract.json` or `expected-diagnostics.json`. `../fixtures.test.ts` interprets every case through the Postgres binding and compares the result with the expected file. Set `UPDATE_PRISMA7_FIXTURES=1` to rewrite the expected files after an intentional change, then run `pnpm biome format --write` on this folder.

## Cases that interpret to a contract

Every case with an `expected-contract.json` is a schema `prisma@7.10.0 validate` accepts, and has a `migration.sql` beside it: the SQL Prisma 7.10.0 generates for that schema against an empty Postgres database. `test/integration/test/prisma7-source/interpreter-fixtures.integration.test.ts` applies each `migration.sql`, interprets the schema, and runs `db verify`. Lenient verify must report nothing. Strict verify must report exactly the tables, columns, indexes, and foreign keys that Prisma 7 still creates for `@ignore` and `@@ignore` constructs. A case with no `migration.sql` fails that test.

`native-type-model-ignored` declares `extensions = [citext]` so that its `migration.sql` creates the `citext` extension before the tables that use it.

## How `migration.sql` is produced

Run these from a scratch folder that holds a copy of the case's schema and this `prisma.config.ts` (use `schema: 'schema'` for a multi-file case). The URL is a placeholder: a diff from empty never connects to it, but the schema engine needs one.

```ts
export default {
  schema: 'schema.prisma',
  datasource: { url: 'postgresql://prisma:prisma@localhost:5432/fixture' },
};
```

```bash
pnpm dlx prisma@7.10.0 validate --schema schema.prisma
pnpm dlx prisma@7.10.0 migrate diff --from-empty --to-schema schema.prisma --script -o migration.sql
```

Copy the resulting `migration.sql` into the case folder unchanged.
