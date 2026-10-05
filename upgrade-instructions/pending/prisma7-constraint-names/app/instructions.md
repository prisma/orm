---
changes:
  - id: prisma7-schema-states-constraint-names
    summary: |
      A contract from `prisma7Schema(...)` now states the name of each primary key and foreign key whose Prisma 7 name differs from the name Prisma 8 derives: a `map` on `@id`, `@@id` or `@relation`, the primary key of an implicit many-to-many junction (`_PostToTag_AB_pkey`), and a foreign key name Prisma 7 cut to 63 bytes. A contract with any of these gets a new storage hash. Re-emit, then re-sign each database, or plan a migration if Prisma 8 already owns the migrations.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '\bprisma7Schema\s*\('
---

# Contracts from a Prisma 7 schema state the constraint names Prisma 7 chose

## `prisma7-schema-states-constraint-names`

For each project whose `prisma.config.ts` uses `prisma7Schema(...)`:

1. Run `prisma contract emit`. If the storage hash in the emitted `contract.json` is unchanged, the schema has none of these constraints and nothing else is needed.

2. If Prisma 7 still owns the migrations, run `prisma db sign` against every database the application uses. The database already has the names Prisma 7 created; only the contract changed. Until a database is signed, `prisma db verify` reports a mismatch and the application logs a marker warning on its first query; queries still run.

3. If Prisma 8 already owns the migrations, run `prisma migration plan --name constraint-names` and apply it with `prisma db migrate --advance-ref db`. The migration renames each affected constraint from the name Prisma 8 derived to the name Prisma 7 chose. On a database Prisma 7 built, the constraints already have those names, so each rename is skipped; on a database Prisma 8 built from the migrations, they are renamed.
