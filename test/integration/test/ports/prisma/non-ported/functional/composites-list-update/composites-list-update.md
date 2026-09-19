# Non-ported — composites-list-update

- `packages/client/tests/functional/composites/list/update.ts` › `updateMany` — filtered per-element embedded-list update (`contents: { updateMany: { data, where } }`) — Prisma 8 has no filtered per-element embedded-list mutation surface (only whole-list `set` and `push`/`pull`/`pop` field-ops).
- `packages/client/tests/functional/composites/list/update.ts` › `deleteMany` — filtered per-element embedded-list delete (`contents: { deleteMany: { where } }`) — same gap as above.
- `packages/client/tests/functional/composites/list/update.ts` › `unset` — asserts a Prisma-specific `Unknown argument \`unset\`` throw for `contents: { unset: true }` — Prisma 8 exposes no `unset` operator on a required embedded list and does not produce this Prisma validation error.
- `packages/client/tests/functional/composites/list/update.ts` › `upsert set` — asserts a Prisma-specific `Unknown argument \`upsert\`` throw for `contents: { upsert: { ... } }` — no embedded-list `upsert` operator; no equivalent Prisma validation error.
- `packages/client/tests/functional/composites/list/update.ts` › `upsert update` — asserts a Prisma-specific `Unknown argument \`upsert\`` throw for `contents: { upsert: { ... } }` — same as above.
