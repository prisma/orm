---
changes:
  - id: pack-extension-found-on-search-path
    summary: |
      The pgvector, PostGIS, ParadeDB and citext packs declare their extension in the unbound namespace, so `db sign` and `db verify` accept the extension in any schema on the connection's search path, such as Supabase's `extensions`. Each pack has a new head and one new migration with no operations. A project that composes one of these packs runs `prisma contract emit`, which writes the pack's new migration under `migrations/<pack>/`, and then `prisma db migrate`, which applies it without changing the database.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs,cjs}"
      matches:
        - '@prisma/orm-extension-(pgvector|postgis|paradedb)/control|@prisma/orm-postgres-contrib/citext/control'
  - id: remove-pack-extension-declaration
    summary: |
      An application contract may not declare an extension that a composed pack declares. `contract emit` refuses such a PSL declaration with `PSL_ENTITY_DECLARED_BY_PACK`, and `migration plan` and `db update` refuse it as a conflict. Remove the application's own `extension vector {}`, `extension postgis {}`, `extension pg_search {}` or `extension citext {}` block, or its `extension(...)` handle, when the project composes the pack that declares it.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      matches:
        - 'extension\s+(vector|postgis|pg_search|citext)\s*\{'
        - 'extension\(\s*[''"](vector|postgis|pg_search|citext)[''"]'
---

# Pack extensions are found through the search path

The pgvector pack's contract now declares `vector` in the unbound namespace, the same as this PSL:

```prisma
namespace unbound {
  extension vector {}
}
```

## `pack-extension-found-on-search-path`

1. Run `prisma contract emit`. It writes the pack's new migration and head under `migrations/<pack>/`.
2. Run `prisma db migrate` against each database. The new migration has no operations.

A database where the extension is in a schema that is not on the connection's search path now fails `db verify`, and the message names the schema and the search path. Add that schema to the search path of the role the application connects as, or reinstall the extension in a schema on the search path.

## `remove-pack-extension-declaration`

If the project composes the pgvector, PostGIS, ParadeDB or citext pack, delete the application's own declaration of that pack's extension, then run `prisma contract emit`. The pack installs the extension. Keep the declaration of any other extension.
