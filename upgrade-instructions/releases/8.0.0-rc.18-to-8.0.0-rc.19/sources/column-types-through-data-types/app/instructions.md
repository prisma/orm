---
changes:
  - id: db-schema-json-names-type-text
    summary: |
      `prisma db schema --json` names each column's type field `typeText` instead of `nativeType`, holding the type as introspection reads it from the database (`integer`, `timestamp(3) with time zone`), and no longer has `resolvedNativeType`. The tree output of `prisma db schema` shows the same text, such as `integer` where it showed `int4`.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs,sh,json}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\bdb schema\b)[\s\S]*\bnativeType\b'
  - id: default-invalid-meta-type-text
    summary: |
      `CONTRACT.DEFAULT_INVALID`, raised when an `autoincrement()` default sits on a Postgres column whose type is not a `SERIAL` type, carries the column's type in `meta.typeText` instead of `meta.nativeType`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\bDEFAULT_INVALID\b)[\s\S]*\bnativeType\b'
---

## `db-schema-json-names-type-text`

A script that reads column types from `prisma db schema --json` reads `typeText`:

```sh
# Before
prisma db schema --json | jq '.schema.tables[].columns[].nativeType'

# After
prisma db schema --json | jq '.schema.tables[].columns[].typeText'
```

The value is the type as introspection reads it from the database: on Postgres the text `format_type` prints (`integer`, `character varying(20)`), not the short names (`int4`, `varchar(20)`) earlier releases printed. It differs from what the database prints in three cases:

- On SQLite, the declared type is lower-cased: a column declared `VARCHAR(255)` reads `varchar(255)`.
- On Postgres, an enum is named as a contract names it: `My Mood` where `format_type` prints `"My Mood"`, and `app.status` for an enum outside `public`.
- On Postgres, a type in a schema that is not on the search path keeps its schema, as `format_type` prints it: `extensions.vector(3)` for a pgvector column when the `extensions` schema is not on the search path, and `vector(3)` when it is.

## `default-invalid-meta-type-text`

Code that reads the column's type from a `CONTRACT.DEFAULT_INVALID` error reads `meta.typeText`:

```ts
// Before
if (error.code === 'CONTRACT.DEFAULT_INVALID') console.log(error.meta.nativeType);

// After
if (error.code === 'CONTRACT.DEFAULT_INVALID') console.log(error.meta.typeText);
```
