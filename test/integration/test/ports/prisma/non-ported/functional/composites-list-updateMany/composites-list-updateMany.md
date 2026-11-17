# Non-ported — composites-list-updateMany

- `packages/client/tests/functional/composites/list/updateMany.ts` › `updateMany` — filtered per-element embedded-list update via `updateMany` (`contents: { updateMany: { data, where } }`) — Prisma 8 has no filtered per-element embedded-list mutation surface.
- `packages/client/tests/functional/composites/list/updateMany.ts` › `deleteMany` — filtered per-element embedded-list delete via `updateMany` (`contents: { deleteMany: { where } }`) — same gap.
- `packages/client/tests/functional/composites/list/updateMany.ts` › `unset` — asserts Prisma-specific "Unknown argument `unset`" throw for `contents: { unset: true }` — Prisma 8 exposes no `unset` operator on a required embedded list and does not produce this Prisma validation error.
- `packages/client/tests/functional/composites/list/updateMany.ts` › `upsert set` — asserts Prisma-specific "Unknown argument `upsert`" throw for `contents: { upsert: { ... } }` — no embedded-list `upsert` operator; no equivalent Prisma validation error.
- `packages/client/tests/functional/composites/list/updateMany.ts` › `upsert update` — asserts Prisma-specific "Unknown argument `upsert`" throw for `contents: { upsert: { ... } }` — same as above.
