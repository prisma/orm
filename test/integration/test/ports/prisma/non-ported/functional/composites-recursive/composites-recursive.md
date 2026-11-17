# Non-ported — composites-recursive

- `packages/client/tests/functional/composites/recursive/tests.ts` › `can create recursive model` — creates a document with a recursive composite type `ListNode` (a `type` that references itself via `next: ListNode?`) — Prisma 8's contract emitter cannot process self-referential value objects (hits a maximum call stack size error during schema resolution); the schema itself cannot be emitted.
