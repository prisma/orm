# Non-ported — composites-list-upsert-update

- `packages/client/tests/functional/composites/list/upsert-update.ts` › `updateMany` — filtered per-element embedded-list update inside the upsert's update branch (`contents: { updateMany: { data, where } }`) — Prisma 8 has no filtered per-element embedded-list mutation surface.
- `packages/client/tests/functional/composites/list/upsert-update.ts` › `deleteMany` — filtered per-element embedded-list delete inside the upsert's update branch (`contents: { deleteMany: { where } }`) — same gap.
- `packages/client/tests/functional/composites/list/upsert-update.ts` › `unset` — asserts Prisma-specific "Unknown argument `unset`" throw for `contents: { unset: true }` — Prisma 8 exposes no `unset` operator on a required embedded list and does not produce this Prisma validation error.
- `packages/client/tests/functional/composites/list/upsert-update.ts` › `upsert set` — asserts Prisma-specific "Unknown argument `upsert`" throw for `contents: { upsert: { ... } }` — no embedded-list `upsert` operator; no equivalent Prisma validation error.
- `packages/client/tests/functional/composites/list/upsert-update.ts` › `upsert update` — asserts Prisma-specific "Unknown argument `upsert`" throw for `contents: { upsert: { ... } }` — same as above.
