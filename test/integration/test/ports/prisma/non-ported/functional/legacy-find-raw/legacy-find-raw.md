# Non-ported — legacy-find-raw

- `packages/client/tests/functional/0-legacy-ports/find-raw/tests.ts` › `all` — findRaw with an empty query returns all raw BSON documents — Prisma 8's public Mongo raw collection exposes aggregate and write/findOneAnd* commands but no raw find command; replacing findRaw with aggregate or the typed ORM would change the mechanism under test.
- `packages/client/tests/functional/0-legacy-ports/find-raw/tests.ts` › `filtered` — findRaw with a raw Mongo filter returns matching raw BSON documents — Prisma 8 has no public raw find command; mapping this to raw aggregate `$match` or typed ORM `.where()` would substitute a different mechanism.
- `packages/client/tests/functional/0-legacy-ports/find-raw/tests.ts` › `projection` — findRaw options apply a raw Mongo projection that excludes `_id` — Prisma 8 has no public raw find command or find projection-options surface; raw aggregate `$project` would be a different operation.
