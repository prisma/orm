---
changes:
  - id: prisma7-ignore-keeps-storage
    summary: |
      A Prisma 7 schema read with `prisma7Schema()` keeps the columns, tables, keys, indexes and foreign keys of `@ignore` fields and `@@ignore` models in the contract's storage, as storage with no model. Ignored objects now meet every rule of the reader, so a schema that loaded only because they were dropped can be refused. A project whose Prisma 7 schema uses `@ignore` or `@@ignore` gets a new storage hash: it emits its contract again and brings each existing database to the new hash, after recording a migration if Prisma 8 already plans its migrations. The detection matches a `.prisma` file that uses `@ignore` or `@@ignore`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@ignore\b'
---

# A Prisma 7 schema's `@ignore` and `@@ignore` objects stay in the contract

The contract read from a Prisma 7 schema now describes every table and column Prisma 7 created, including those of `@ignore` fields and `@@ignore` models. The ORM still leaves them out of its models. The contract's storage hash therefore changes for a schema that uses `@ignore` or `@@ignore`, and no existing database's signature matches it any more.

## A schema that loaded before can be refused

An ignored field or model now becomes part of the contract, so it meets every rule the reader applies, not only to the fields Prisma 8 maps. `prisma contract emit` can refuse a schema that loaded before only because its ignored objects were dropped. Each diagnostic says what to change in the Prisma 7 schema. Common examples, not every case:

- `PSL.PRISMA7_NATIVE_TYPE_UNSUPPORTED`: a `@db.*` column type with no Prisma 8 codec, on an `@ignore` field or in an `@@ignore` model. `PSL.PRISMA7_UNSUPPORTED_TYPE`: an `Unsupported("...")` field in an `@@ignore` model. `@ignore` and `@@ignore` no longer work around a missing codec; the schema cannot be read until Prisma 8 supports the type.
- `PSL.PRISMA7_INDEX_ARGUMENT_UNSUPPORTED`: an index on an `@@ignore` model with `sort`, `length` or `ops` arguments, such as the `sort: Desc` that `prisma db pull` writes.
- `PSL.PRISMA7_REFERENTIAL_ACTION_UNSUPPORTED`: an `@ignore` relation with `onDelete: SetNull` or `SetDefault` over a required field that cannot take it.
- `PSL.PRISMA7_JSON_NULL_DEFAULT_UNSUPPORTED`: an ignored `Json` field with `@default("null")`.

## While Prisma 7 still applies the migrations

If you have no `migrations/app` folder of Prisma 8 migrations yet, emit the contract and sign each existing database again:

```bash
prisma contract emit
prisma db sign
```

## After Prisma 8 took over the migrations

Emit the contract, then plan a migration before anything else. The migration creates the ignored objects, which a database rebuilt from `migrations/` needs:

```bash
prisma contract emit
prisma migration plan --name keep-ignored-objects
```

Then bring each existing database (production, staging, every developer's) to the new hash. Either sign it:

```bash
prisma db sign
```

or run your usual deploy step with the `db` ref:

```bash
prisma db migrate --advance-ref db
```

`db migrate` skips each create because the object already exists. Plain `prisma db migrate` also brings the database to the new hash, but leaves the `db` ref behind, so the next `migration plan` would plan the same migration again; run `prisma db sign` afterwards to move the ref.

If you signed before planning, the `db` ref points at a hash that is not in the migration graph, and `prisma migration plan` fails with `MIGRATION.HASH_NOT_IN_GRAPH`. Plan from the hash the database had before, which `prisma migration list` shows as the last migration's destination:

```bash
prisma migration plan --from <previous hash> --name keep-ignored-objects
```
