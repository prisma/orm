# Non-ported — legacy-run-command-raw

- `packages/client/tests/functional/0-legacy-ports/run-command-raw/tests.ts` › `aggregate` — `$runCommandRaw` executes an arbitrary Mongo aggregate command and returns the command envelope (`cursor.firstBatch`, `cursor.id`, `ok`) — Prisma 8's public Mongo raw surface exposes collection operations, not arbitrary database commands or their command-response envelope.
