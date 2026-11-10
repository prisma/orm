---
changes:
  - id: prisma7-schema-states-constraint-names
    summary: |
      A contract from `prisma7Schema(...)` now states the name of each primary key and foreign key whose Prisma 7 name differs from the name Prisma 8 derives: a `map` on `@id`, `@@id` or `@relation`, the primary key of an implicit many-to-many junction (`_PostToTag_AB_pkey`), and a foreign key name Prisma 7 cut to 63 bytes. A contract with any of these gets a new storage hash. Re-emit, then re-sign, plan a migration, or run `db update`, depending on who manages each database.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '\bprisma7Schema\s*\('
---

# Contracts from a Prisma 7 schema state the constraint names Prisma 7 chose

## `prisma7-schema-states-constraint-names`

For each project whose `prisma.config.ts` uses `prisma7Schema(...)`, run `prisma contract emit`. If the storage hash in the emitted `contract.json` is unchanged, the schema has none of these constraints and nothing else is needed. Otherwise, handle each database the application uses by how it is managed:

1. **Prisma 7 still owns the migrations** (the database was signed before the handover). Run `prisma db sign` against it. Prisma 7 created the database, so it already has the names the contract now states; only the contract changed. Until it is signed, `prisma db verify` reports a mismatch and the application logs a marker warning on its first query; queries still run.

2. **Prisma 8 owns the migrations.** Run `prisma migration plan --name constraint-names` and apply it with `prisma db migrate --advance-ref db`. The migration renames each affected constraint from the name Prisma 8 derived to the name Prisma 7 chose. On a database Prisma 7 built, the constraints already have those names, so each rename is skipped; on a database Prisma 8 built from the migrations, they are renamed.

3. **Prisma 8 created the database with `prisma db init` or `prisma db update`**, as for a test or preview database. Run `prisma db update`. It reads the constraint names from the database and renames each one whose name differs from the contract's, for example `_PostToTag_pkey` to `_PostToTag_AB_pkey`.
