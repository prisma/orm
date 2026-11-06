---
changes:
  - id: mongo-nullable-list-containers
    summary: Re-emit Mongo contracts and migrate validators to accept nullable list containers.
---

# Mongo nullable list containers

For Mongo schemas with nullable list containers (`T[]?` or `T?[]?`), re-emit the current `contract.json` and `contract.d.ts` using your normal `prisma contract emit` command. The collection validator now uses `bsonType: ['null', 'array']` for these fields; element constraints and required-list behavior are unchanged. The changed validator changes the storage hash, so keep the generated contract pair together.

For an existing database, preserve applied migrations and their contract snapshots. Plan a new migration from the existing contract to the re-emitted contract, review the validator update, and apply it through your normal migration deployment flow before writing explicit null containers. Deploying new application code alone does not update a Mongo collection validator. Do not rewrite applied historical migrations or their hashes.

For disposable example or test databases whose migration fixtures are regenerated from source, regenerate that fixture chain with its existing tooling, including referenced contract snapshots and migration metadata, and recreate the disposable database. In this repository, `pnpm fixtures:emit` re-emits current contracts and regenerates example migration fixtures; retain existing content-addressed snapshots alongside any newly emitted snapshots, then run the example's formatter/import organizer if new snapshot paths change import order. This fixture-only procedure is not a production migration procedure.
