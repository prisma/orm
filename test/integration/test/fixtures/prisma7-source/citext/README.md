# Prisma 7 citext fixture

`schema.prisma` uses `@db.Citext` on single, optional and list fields, in a unique key, an index and the columns of two foreign keys (one behind an `@ignore` relation), and with a literal default, `dbgenerated(...)` with and without an expression, and a list literal. A generator default such as `uuid()` on a citext column is refused, because no generator function binds to the citext codec; the test checks that too. `extension-in-another-schema.prisma` lists `citext(schema: "extensions")` in the datasource beside `@db.Citext` columns; the test checks that the reader reports that entry once, because the pack declares citext in `public`, and reports none of the columns. The Prisma 7 reader reads `@db.Citext` only when the config composes the citext pack, so `prisma7-source/citext.integration.test.ts` interprets it with the pack composed. `expected-contract.json` is the contract it produces.

`migration.sql` is what Prisma 7.10.0 generates for the schema against an empty database. It does not create the extension: Prisma 7 writes `CREATE EXTENSION` only for a datasource `extensions` list with the `postgresqlExtensions` preview feature. Run `CREATE EXTENSION IF NOT EXISTS citext;` before applying it.

## How `migration.sql` was produced

- Prisma version: `prisma@7.10.0`, the `prisma7` binary of `examples/prisma7-adoption`.
- Date: 2026-10-27.
- Run from a scratch directory containing a copy of `schema.prisma` and the `prisma.config.ts` described in `../reference/README.md`, with `DATABASE_URL` set to the same placeholder URL:

```bash
prisma7 validate --schema schema.prisma
prisma7 migrate diff --from-empty --to-schema schema.prisma --script -o migration.sql
```

Prisma 7 accepts `String[] @db.Citext` and creates a `CITEXT[]` column.

Set `UPDATE_PRISMA7_FIXTURES=1` when running the test to rewrite `expected-contract.json` after an intentional change.
