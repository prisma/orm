# Non-ported — reconnect

The suite tests `prisma.$disconnect()` followed by `prisma.$connect()` — Prisma Client's explicit lifecycle management on the same client instance. Prisma 8's postgres facade does not expose `$connect`/`$disconnect`; the driver-level `close()` is terminal ("call close() before reconnecting with a new binding" — a new binding, not a reconnect on the same instance). The subject (explicit disconnect + reconnect without re-instantiation) cannot be expressed.

- `packages/client/tests/functional/reconnect/tests.ts` › `can disconnect and reconnect` — verifies `findMany`, then `$disconnect()`, then `$connect()`, then `findMany` again on the same client instance — no `$disconnect`/`$connect` reconnect lifecycle on Prisma 8 postgres facade; `runtime.close()` is terminal
