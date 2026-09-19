# Non-ported — enums

- `packages/client/tests/functional/enums/tests.ts` › `fails at runtime when an invalid entry is entered manually in SQLite` — SQLite-only path inserting an invalid enum value via `$executeRaw` and asserting a read-time error — no ORM raw-injection surface in Prisma 8; enum validity is enforced at the postgres DB level, not through a raw-insert-then-read path.
