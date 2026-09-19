# Prisma 7 implicit many-to-many names in two schemas fixture

`schema.prisma` gives implicit many-to-many relations in schemas `one` and `two` the same name, `X`, so Prisma 7 creates `"one"."_X"` and `"two"."_X"`. `contract infer` cannot read two tables with one name at once, so `implicit-many-to-many-names.integration.test.ts` drops one schema at a time and compares the names infer gives each `_X` table with the interpreter's.

## How `migration.sql` was produced

- Prisma version: `prisma@7.10.0`.
- Date: 2026-09-15.
- Run from a scratch directory holding a copy of `schema.prisma` and the `prisma.config.ts` described in `../reference/README.md`:

```bash
pnpm dlx prisma@7.10.0 migrate diff --from-empty --to-schema schema.prisma --script -o migration.sql
```
