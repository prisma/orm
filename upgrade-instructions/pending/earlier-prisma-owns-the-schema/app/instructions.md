---
changes:
  - id: earlier-prisma-schema-refuses-schema-changes
    summary: |
      In a project whose contract source is `prisma7Schema(...)` or `prisma6Schema(...)`, `prisma db init`,
      `db update`, `db migrate`, `migration plan` and `migration new` now refuse to run, dry runs included,
      and exit 2 with `MIGRATION.SCHEMA_OWNED_ELSEWHERE`. The earlier Prisma owns the database: apply
      schema changes with it, then run `prisma contract emit` and `prisma db sign`.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '\bprisma[67]Schema\s*\('
---

# The earlier Prisma owns the schema

A project whose `prisma.config.ts` reads its contract with `prisma7Schema(...)` or `prisma6Schema(...)` has an earlier Prisma that migrates the database. Prisma 8 now only signs and verifies that database. These commands refuse before they connect or write anything, and exit 2 with `MIGRATION.SCHEMA_OWNED_ELSEWHERE`:

- `prisma db init`, `prisma db update` and `prisma db migrate`, with or without `--dry-run`
- `prisma migration plan` and `prisma migration new`

Find each script, CI step or task in the project that runs one of them, and replace it with the earlier Prisma's command, followed by the Prisma 8 refresh:

| Contract source | Apply the schema change | Then |
| --- | --- | --- |
| `prisma7Schema(...)` | `prisma7 migrate dev`, or `prisma7 migrate deploy` for a deployed database | `prisma contract emit`, then `prisma db sign` |
| `prisma6Schema(...)` | Prisma 6's `db push` (`pnpm prisma6 db push`) | `prisma contract emit`, then `prisma db sign` |

Delete any migration package that `prisma migration plan` or `migration new` wrote under the project's Prisma 8 `migrations/` directory for such a project: nothing applies it. Keep `migrations/app/refs/` and `migrations/snapshots/`, which `db sign` writes.
