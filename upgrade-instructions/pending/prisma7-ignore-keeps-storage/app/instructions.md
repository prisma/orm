---
changes:
  - id: prisma7-ignore-keeps-storage
    summary: |
      A Prisma 7 schema read with `prisma7Schema()` keeps the columns, tables, keys, indexes and foreign keys of `@ignore` fields and `@@ignore` models in the contract's storage, as storage with no model. A project whose Prisma 7 schema uses `@ignore` or `@@ignore` gets a new storage hash, so it emits its contract and signs its database again, recording a migration first if Prisma 8 already plans its migrations. The detection matches a `.prisma` file that uses `@ignore` or `@@ignore`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@ignore\b'
---

# A Prisma 7 schema's `@ignore` and `@@ignore` objects stay in the contract

The contract read from a Prisma 7 schema now describes every table and column Prisma 7 created, including those of `@ignore` fields and `@@ignore` models. The ORM still leaves them out of its models. The contract's storage hash therefore changes for a schema that uses `@ignore` or `@@ignore`, and the database's signature no longer matches it.

Emit the contract again:

```bash
prisma contract emit
```

If Prisma 7 still applies the migrations (you have no `migrations/app` folder of Prisma 8 migrations yet), sign the database again:

```bash
prisma db sign
```

If Prisma 8 already plans the migrations, first plan a migration, then sign the database. The migration creates the ignored objects, which a database replayed from your migrations needs; the database you sign already has them, so signing marks it as up to date and `prisma db migrate` applies nothing to it:

```bash
prisma migration plan --name keep-ignored-objects
prisma db sign
```

Do not run `prisma db migrate` against a database before signing it: the migration would try to create objects that already exist.
