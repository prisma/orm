# Non-ported — issues-21592-char-truncation

- `packages/client/tests/functional/issues/21592-char-truncation/tests.ts` › `does not truncate the input` — subject: a `String @db.Char(5) @unique` column stores and retrieves a 5-char value without truncation; `@db.Char` attribute is rejected by the Prisma 8 PSL emitter (`PSL_UNSUPPORTED_FIELD_ATTRIBUTE` diagnostic) — non-ported (`@db.Char` PSL attribute unsupported; faithful schema cannot be emitted)
- `packages/client/tests/functional/issues/21592-char-truncation/tests.ts` › `upsert` — subject: upsert on a `@db.Char(5) @unique` field; same `@db.Char` unsupported PSL attribute gap — non-ported (`@db.Char` PSL attribute unsupported; faithful schema cannot be emitted)
