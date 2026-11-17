# Non-ported — logging-types

- `packages/client/tests/functional/logging-types/tests.ts` › `check that query and info logs match their declared types` — subscribes to typed Prisma Client `query` and `info` events, executes a query, and validates every event payload field — non-portable because prisma-8 exposes no public client `$on`-style query/info event subscription or corresponding typed event payload surface.
