# Non-ported — composites-object-updateMany

- `packages/client/tests/functional/composites/object/updateMany.ts` › `optional > update` — optional composite partial update via `updateMany` (`content: { upsert: { update: { text }, set: null } }`) — Prisma 8 has no partial composite-field `update` sub-operator.
- `packages/client/tests/functional/composites/object/updateMany.ts` › `optional > update push nested list` — optional composite partial update pushing to nested upvotes list via `updateMany` (`content: { upsert: { update: { upvotes: { push: [...] } }, set: null } }`) — same gap.
- `packages/client/tests/functional/composites/object/updateMany.ts` › `optional > update set nested list` — optional composite partial update replacing nested upvotes list via `updateMany` — same gap.
- `packages/client/tests/functional/composites/object/updateMany.ts` › `required > update` — required composite partial update via `updateMany` (`content: { update: { text } }`) — no partial composite `update` sub-operator in Prisma 8.
- `packages/client/tests/functional/composites/object/updateMany.ts` › `required > update push nested list` — required composite partial update pushing to nested upvotes list via `updateMany` — same gap.
- `packages/client/tests/functional/composites/object/updateMany.ts` › `required > update set nested list` — required composite partial update replacing nested upvotes list via `updateMany` — same gap.
- `packages/client/tests/functional/composites/object/updateMany.ts` › `unset` (required variant) — asserts Prisma-specific "Unknown argument `unset`" throw on required composite — no such validation in Prisma 8.
- `packages/client/tests/functional/composites/object/updateMany.ts` › `upsert set` (required variant) — asserts Prisma-specific "Unknown argument `upsert`" throw for `content: { upsert: {...} }` — no such validation.
- `packages/client/tests/functional/composites/object/updateMany.ts` › `upsert set` (optional variant) — composite-level `content: { upsert: { update: {...}, set: {...} } }` operator via `updateMany` — no equivalent in Prisma 8.
- `packages/client/tests/functional/composites/object/updateMany.ts` › `upsert update` (required variant) — asserts Prisma-specific "Unknown argument `upsert`" throw — no such validation.
- `packages/client/tests/functional/composites/object/updateMany.ts` › `upsert update` (optional variant) — composite-level `content: { upsert: { update: { upvotes: { push: {...} } }, set: null } }` via `updateMany` — no equivalent in Prisma 8.
