# Saved samples written by 8.0.0-rc.26

These files and records were written on 2026-11-24 by the code of 8.0.0-rc.26, with `pnpm samples:write` (see [the procedure](../../README.md)). `../8.0.0-rc.26.sha256` lists every file with its SHA-256; once 8.0.0-rc.26 is released, neither changes.

- `postgres/project/`: a PostgreSQL project with the pgvector extension pack, and its `prisma.config.ts` with `{{DB_URL}}` where each run puts its connection string. Its contract has an enum, a relation with an index, and a vector column. It has three application migrations, the third a data migration that fills a new required column and provides an invariant, and the pgvector pack's own migrations, refs and snapshots. The `production` ref requires the invariant and declares database policies; `db` declares neither.
- `postgres/database/`: how Prisma's tables in `prisma_contract` were created (`tables.json`) and their rows after `db migrate --to production`, one JSON file per table. The marker records the policies and the invariant.
- `mongo/project/`: a MongoDB project whose contract has an enum, a relation with an index and a required field filled by a data migration that provides an invariant, with its config, three migrations, refs and snapshots. The refs are as on PostgreSQL.
- `mongo/database/`: the documents of `_prisma_migrations` after `db migrate --to production`, in canonical Extended JSON.
- `<database>/query.json`: the row the tests write and read back through the facade.
