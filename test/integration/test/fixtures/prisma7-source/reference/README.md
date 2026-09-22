# Prisma 7 reference fixture

`schema.prisma` exercises every construct the Prisma 7 contract source handles or rejects (see `packages/2-sql/2-authoring/contract-prisma7/README.md`). `migration.sql` is what Prisma 7.10.0 generates for it against an empty Postgres database. Both files are the ground truth for the Prisma 7 interpreter; rules are written against this SQL, not from memory.

## How `migration.sql` was produced

- Prisma version: `prisma@7.10.0` (schema engine `0edf323efd1d98336f3f0a68684b56f689b900d3`).
- Date: 2026-09-15.
- Run from a scratch directory containing a copy of `schema.prisma` and this `prisma.config.ts`:

```ts
export default {
  schema: 'schema.prisma',
  datasource: { url: 'postgresql://prisma:prisma@localhost:5432/reference' },
};
```

- Command:

```bash
pnpm dlx prisma@7.10.0 migrate diff --from-empty --to-schema schema.prisma --script -o migration.sql
```

Notes on the run:

- Prisma 7 removed `--to-schema-datamodel`; the flag is now `--to-schema`.
- Without a config file the schema engine exits with `The following required arguments were not provided: --datasource <JSON>` and the CLI prints nothing. The URL in `prisma.config.ts` is a placeholder; a `--from-empty` diff never connects to it.
- `prisma validate` accepts the schema with one warning: `Preview feature "multiSchema" is deprecated. The functionality can be used without specifying it as a preview feature.` The schema keeps `previewFeatures = ["multiSchema", "views"]` so that it shows the interpreter ignoring preview features other than `multiSchema`.
- Prisma 7 rejected no construct in the schema. Nothing was removed.
- `MappedIndexes` pins the index names Prisma 7 derives over `@map`ped columns: `mapped_indexes_first_name_idx` and `mapped_indexes_first_name_other_key` use the column names, not the field names.
- `NumberDefaults`, `ListDefaults`, and `TemporalDefaults` pin how Prisma 7 writes number, list, and `DateTime` string defaults. Numbers are written as typed, without quotes (`DEFAULT -1`, `DEFAULT 1.50`); lists are `ARRAY[...]` with a cast to the column type; a `DateTime` string is written as text with its offset (`'2024-01-02 03:04:05 +02:00'`), whatever the column type.
- `NativeTypes.charNoLength String @db.Char` becomes `CHAR`, which Postgres stores as `character(1)`.
- `Review.author` is an optional relation over a required column, and `CompositeChild.composite` a composite foreign key mixing an optional and a required column. Prisma 7 gives both `ON DELETE RESTRICT ON UPDATE CASCADE`.
- `Label.posts` is an implicit many-to-many relation across schemas. Prisma 7 creates its junction table `_LabelToPost` in `audit`, the schema of `Label`; its column `A` references `Label`.
- The `view UserSummary` block produces no SQL. Prisma Migrate does not create views.

## Applying `migration.sql` to a clean database

The `NativeTypes.citext` column needs the `citext` extension. Run `CREATE EXTENSION IF NOT EXISTS citext;` before applying the script, or `CREATE TABLE "NativeTypes"` fails with `type "citext" does not exist`.

## Ground truth only

This directory records what Prisma 7 does. It is not the input for the zero-findings end-to-end proof (`contract emit`, `db sign`, `db verify`), because the interpreter reports eight constructs in this schema as errors:

- `view UserSummary` (`PSL.PRISMA7_VIEW_UNSUPPORTED`)
- `Post.search Unsupported("tsvector")` (`PSL.PRISMA7_UNSUPPORTED_TYPE`)
- `@db.Citext`, `@db.Bit(8)`, `@db.VarBit(8)`, `@db.Xml`, `@db.Oid`, `@db.Money` on `NativeTypes` (`PSL.PRISMA7_NATIVE_TYPE_UNSUPPORTED`)

Use `../supported/` for the end-to-end proof. It is this schema with those eight constructs removed and nothing else changed.
