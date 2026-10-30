---
changes:
  - id: contract-emit-pins-pack-files
    summary: |
      `prisma contract emit` now writes each composed extension pack's files under `migrations/<space-id>/` (the pack's head ref, its contract snapshot and its migrations), as `migration plan` already did. Re-run `prisma contract emit` and commit what it writes under `migrations/`. A project that composes a pack and never ran `migration plan` gains those files; `prisma db sign` needs them.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - 'extensions\s*:\s*\[\s*[^\]\s]'
  - id: packs-declare-their-postgres-extension
    summary: |
      The pgvector, PostGIS and ParadeDB packs now declare their Postgres extension (`vector`, `postgis`, `pg_search`) in their contract, and their head ref no longer requires the `pgvector:install-vector-v1`, `postgis:install-postgis-v1` or `paradedb:install-pg-search-v1` invariant. After `prisma contract emit` moves `migrations/<space-id>/` to the new head, run `prisma db migrate` on each database: one migration moves the pack's space from its old head and creates the extension only if it is missing. A database that has the extension and no pack marker can instead be adopted with `prisma db sign`.
    detection:
      glob: "**/migrations/*/refs/head.json"
      matches:
        - '(?:pgvector:install-vector|postgis:install-postgis|paradedb:install-pg-search)-v1'
---

# Extension packs declare their Postgres extension

Re-run `prisma contract emit` and commit the files it writes under `migrations/`. For pgvector, PostGIS and ParadeDB this moves `migrations/<space-id>/refs/head.json` to a head with no invariants and adds two migrations to `migrations/<space-id>/`: one from the pack's old head and one from the empty contract.

Then bring each database to the new head:

```bash
prisma db migrate
```

On a database the old install migration already ran on, the extension is installed, so the new migration only moves the pack's marker.
