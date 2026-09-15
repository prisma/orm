# Prisma 7 supported fixture

`schema.prisma` is `../reference/schema.prisma` with every construct the slice spec treats as a hard error removed, and nothing else changed. It is the input for the zero-findings end-to-end proof: apply `migration.sql` to a dev database, then `contract emit`, `db sign`, `db verify` must succeed with no findings.

## Removed relative to `../reference/`

- `view UserSummary`
- `Post.search Unsupported("tsvector")?`
- `NativeTypes.citext String @db.Citext`
- `NativeTypes.bit String @db.Bit(8)`
- `NativeTypes.varBit String @db.VarBit(8)`
- `NativeTypes.xml String @db.Xml`
- `NativeTypes.oid Int @db.Oid`
- `NativeTypes.money Decimal @db.Money`

The reference schema has no `relationMode`, so nothing else needed removing. `previewFeatures = ["multiSchema", "views"]` is kept on purpose: the interpreter ignores preview features other than `multiSchema`.

Still covered: every scalar with and without `?` and as `[]`, every accepted `@db.*` type, native enums with `@@map` and member `@map` in both schemas, `@updatedAt` in all three forms, every default function and literal, `@id`, `@@id`, `@unique`, `@@unique`, `@@index` with and without `map:` and with `type: Hash`, explicit relations with omitted actions on required and optional scalars, the unnamed, named, and self-referential implicit many-to-many relations, multiSchema, `@ignore`, and `@@ignore`.

`migration.sql` needs no extensions.

## How `migration.sql` was produced

- Prisma version: `prisma@7.10.0` (schema engine `0edf323efd1d98336f3f0a68684b56f689b900d3`).
- Date: 2026-09-13.
- Run from the scratch directory `wip/prisma7-reference/supported/` (gitignored) containing a copy of `schema.prisma` and the same `prisma.config.ts` as described in `../reference/README.md`:

```bash
pnpm dlx prisma@7.10.0 migrate diff --from-empty --to-schema schema.prisma --script -o migration.sql
```

The output differs from `../reference/migration.sql` only by the seven removed columns; the view produced no SQL there either.
