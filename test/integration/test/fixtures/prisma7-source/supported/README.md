# Prisma 7 supported fixture

`schema.prisma` is `../reference/schema.prisma` with every construct the interpreter reports as an error removed, and nothing else changed. It is the input for the zero-findings end-to-end proof: apply `migration.sql` to a dev database, then `contract emit`, `db sign`, `db verify` must succeed with no findings.

## Removed relative to `../reference/`

- `view UserSummary`
- `NativeTypes.citext String @db.Citext`

The reference schema has no `relationMode`, so nothing else needed removing. `previewFeatures = ["multiSchema", "views"]` is kept on purpose: the interpreter ignores preview features other than `multiSchema`.

Still covered: every scalar with and without `?` and as `[]`, every accepted `@db.*` type (including `@db.Bit(8)`, `@db.VarBit(8)`, `@db.Xml`, `@db.Oid` and `@db.Money`), native enums with `@@map` and member `@map` in both schemas, `@updatedAt` in all three forms, every default function and literal, `@id`, `@@id`, `@unique`, `@@unique`, `@@index` with and without `map:` and with `type: Hash`, negative, long, tiny, and trailing-zero number defaults, a `BigInt` default beyond 2^53, list defaults of every number type and of `DateTime` and `Bytes`, an empty `@db.VarChar(n)` list default, `DateTime` string defaults on `@db.Date`, `@db.Time`, `@db.Timetz`, and `@db.Timestamptz` (one before year 1), `@db.Char` with no length, explicit relations with omitted actions on required and optional scalars, an optional relation over a required column, a composite foreign key mixing an optional and a required column, the unnamed, named, self-referential, and cross-schema implicit many-to-many relations, multiSchema, `@ignore`, `@@ignore`, and an `Unsupported("tsvector")` field, which becomes a raw column with no field (ADR 273).

`migration.sql` needs no extensions.

## How `migration.sql` was produced

- Prisma version: `prisma@7.10.0` (schema engine `0edf323efd1d98336f3f0a68684b56f689b900d3`).
- Date: 2026-10-27.
- Run from a scratch directory containing a copy of `schema.prisma` and the same `prisma.config.ts` as described in `../reference/README.md`:

```bash
pnpm dlx prisma@7.10.0 migrate diff --from-empty --to-schema schema.prisma --script -o migration.sql
```

The output differs from `../reference/migration.sql` only by the removed `citext` column; the view produced no SQL there either.
