# Prisma 7 number defaults fixture

`schema.prisma` holds `Decimal` and `BigInt` number defaults that a JavaScript `number` cannot carry exactly: a long decimal, a tiny one, a negative one, a whole number, trailing zeros on a bare `@db.Decimal`, on `@db.Decimal(10, 2)` and on the default `DECIMAL(65,30)`, a `Decimal[]` list, a `BigInt` past 2^53, and a `BigInt[]` list. `number-defaults.integration.test.ts` applies `migration.sql`, interprets the schema, and runs strict `db verify`, which must report nothing.

## How `migration.sql` was produced

- Prisma version: `prisma@7.10.0`.
- Date: 2026-09-15.
- Run from a scratch directory holding a copy of `schema.prisma` and the `prisma.config.ts` described in `../reference/README.md`:

```bash
pnpm dlx prisma@7.10.0 migrate diff --from-empty --to-schema schema.prisma --script -o migration.sql
```
