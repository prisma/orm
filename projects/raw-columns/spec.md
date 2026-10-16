# Project: Raw columns

_Linear: [Raw columns](https://linear.app/prisma-company/project/raw-columns-f8b71d02e514) (P-TML-1159). Design: ADR 273, "A column of a type no data type claims is a raw column"._

## Purpose

A column whose database type no data type in the stack claims (`ltree`, `hstore`, `tsvector`, `circle`, a domain of the user's own) can be described, created, verified and read by Prisma 8. A Prisma 7 project with `Unsupported("...")` fields can adopt Prisma 8.

## At a glance

```prisma
model Category {
  id     Int           @id
  path   Raw("ltree")
  search Raw("tsvector")?
  area   Raw("circle") @default(sql`'<(0,0),1>'::circle`)
}
```

The contract stores `path` as data type `sql/raw` with `{ "sql": "ltree" }` and codec `sql/raw@1`. `migration plan` writes `"path" ltree NOT NULL`. `db verify` compares `ltree` with the type the database reports. The ORM reads and writes `path` as `unknown`. A Prisma 7 schema's `search Unsupported("tsvector")?` becomes the same kind of column, with no field on the model.

## Non-goals

- Interpreting raw values: no filters, ordering, or literal defaults on raw columns.
- Substituting a data type an extension pack provides for `Unsupported("...")`.
- Printing a raw column that no field maps (`contract print` refuses unmapped columns until TML-3469).
- Codecs for the types that are raw today (citext, money and others): GA plan, stream 2 row 5.

## Cross-cutting requirements

- One mechanism: a raw column is a column with a data type and a codec. No consumer (planner, verify, runtime, emitter, `contract print`) gets a branch on `sql/raw`; where a consumer cannot handle it, the data type's declaration or the codec's declaration is what changes.
- The `sql` text is the type as the catalog prints it, with no schema for a base type. Verify compares exactly.
- Postgres and SQLite both register the data type and the codec.

## Project Definition of Done

Inherits `drive/calibration/dod.md`. Project-specific:

- A Prisma 8 schema with `Raw("tsvector")`, `Raw("circle")` and `Raw("cidr")` fields emits, plans, migrates, and verifies strictly with no findings against a real database; the ORM creates and reads rows through those fields with values typed `unknown`.
- A literal default on a raw field is refused at emit; a `sql` default is created and verified.
- Changing a field from `Raw("tsvector")` to `Raw("text")` plans an `ALTER COLUMN ... TYPE`.
- `contract print` writes a raw field as `Raw("...")`, and the printed schema reads back as the same contract.
- `contract infer` still refuses a type no data type claims.
- A Prisma 7 schema with `Unsupported("...")` fields reads into raw columns with no field, and strict `db verify` against the database Prisma 7 built reports nothing.
- ADR 273 matches the shipped code.

## References

- ADR 273, ADR 267 (columns no field maps), ADR 254 (data types), ADR 268 (`sql` values), ADR 252 (the Prisma 7 reader).
