# Saved samples written by 8.0.0-rc.26

These files and records were written by the code of the release candidate `8.0.0-rc.26`, the first release whose stored files carry a format version and whose hashes follow the fixed hash rules. The root `package.json` still said `8.0.0-rc.25` when they were written, because that version is bumped when the release is cut; `8.0.0-rc.25` itself wrote files in the earlier formats.

They were written on 2026-11-25 by `regenerate.test.ts` (see [the procedure](../README.md)), and are replaced by the `8.0.0` set when `8.0.0` is cut.

- `postgres/project/`: a PostgreSQL project with the pgvector extension pack. Its contract has an enum, a relation with an index, and a vector column. It has three application migrations, the third a data migration that fills a new required column, and the pgvector pack's own migrations, refs and snapshots.
- `postgres/database/`: the rows of `prisma_contract.marker`, `prisma_contract.ledger` and `prisma_contract.contract` after `db migrate` applied those migrations, one JSON file per table.
- `mongo/project/`: a MongoDB project whose contract has an enum, a relation with an index and an optional field, with three migrations, refs and snapshots.
- `mongo/database/`: the documents of `_prisma_migrations` after `db migrate` applied those migrations, in canonical Extended JSON.
