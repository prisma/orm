---
changes:
  - id: prisma7-schema-now-default-writes-on-create
    summary: |
      A contract from `prisma7Schema(...)` now reads Prisma 7's `@default(now())` on a date or time field as both the database default `now()` and the client generator `now` on create, as Prisma 8 PSL reads `@default(now()) @onCreate(now())`. A create through Prisma 8 now writes the current UTC time, as Prisma 7's client did, instead of leaving the column to the database's clock in the session time zone. Re-emit the contract with `prisma contract emit` and commit it. Only the execution hash changes, so the database needs no migration and no `db sign`.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '\bprisma7Schema\s*\('
---

# A Prisma 7 `@default(now())` is written by the client on create

## `prisma7-schema-now-default-writes-on-create`

Prisma 7's client filled a `@default(now())` field itself on create, with the current time in UTC, and also wrote `now()` as the column default for inserts from outside Prisma. A contract from `prisma7Schema(...)` used to keep only the column default, so a create through Prisma 8 got the database's clock. On a `timestamp` column, that is the wall-clock time of the session's time zone, which differs from what Prisma 7 wrote unless the session runs in UTC.

The contract now keeps the column default and adds the `now` generator on create, chosen for the column's type:

```prisma
// Prisma 7 schema, read by prisma7Schema('prisma/schema.prisma')
model Post {
  id        Int      @id @default(autoincrement())
  createdAt DateTime @default(now())
}
```

reads as the Prisma 8 PSL field `createdAt TimestampString(3) @default(now()) @onCreate(now())`. A create that supplies `createdAt` still stores the supplied value. An `INSERT` from outside Prisma still gets the column default.

For each project whose `prisma.config.ts` uses `prisma7Schema(...)`, run `prisma contract emit` again and commit the new `contract.json` and `contract.d.ts`. If the schema has a `@default(now())` field, the generator's id is in the execution section of `contract.json`, so the execution hash changes. The storage hash does not change, and the database marker holds only the storage and profile hashes, so there is no migration to plan and no need to run `prisma db sign`.

If the schema has no `@default(now())` field, the contract does not change and there is nothing to do.
