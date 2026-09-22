# Non-ported — composites-object-upsert-update

- `packages/client/tests/functional/composites/object/upsert-update.ts` › `optional > update` — optional composite partial update in upsert's update branch (`update: { content: { upsert: { update: { text }, set: null } } }`) — Prisma 8 has no partial composite-field `update` sub-operator.
- `packages/client/tests/functional/composites/object/upsert-update.ts` › `optional > update push nested list` — optional composite partial update pushing to nested upvotes list in upsert — same gap.
- `packages/client/tests/functional/composites/object/upsert-update.ts` › `optional > update set nested list` — optional composite partial update replacing nested upvotes list in upsert — same gap.
- `packages/client/tests/functional/composites/object/upsert-update.ts` › `required > update` — required composite partial update in upsert's update branch (`update: { content: { update: { text } } }`) — no partial composite `update` sub-operator in Prisma 8.
- `packages/client/tests/functional/composites/object/upsert-update.ts` › `required > update push nested list` — required composite partial update pushing to nested upvotes list in upsert — same gap.
- `packages/client/tests/functional/composites/object/upsert-update.ts` › `required > update set nested list` — required composite partial update replacing nested upvotes list in upsert — same gap.
- `packages/client/tests/functional/composites/object/upsert-update.ts` › `unset` (required variant) — asserts Prisma-specific "Unknown argument `unset`" throw on required composite in upsert — no such validation in Prisma 8.
- `packages/client/tests/functional/composites/object/upsert-update.ts` › `upsert set` (required variant) — asserts Prisma-specific "Unknown argument `upsert`" throw for `content: { upsert: {...} }` — no such validation.
- `packages/client/tests/functional/composites/object/upsert-update.ts` › `upsert set` (optional variant) — composite-level `content: { upsert: { update: {...}, set: {...} } }` in upsert's update branch — no equivalent in Prisma 8.
- `packages/client/tests/functional/composites/object/upsert-update.ts` › `upsert update` (required variant) — asserts Prisma-specific "Unknown argument `upsert`" throw — no such validation.
- `packages/client/tests/functional/composites/object/upsert-update.ts` › `upsert update` (optional variant) — composite-level `content: { upsert: { update: { upvotes: { push: {...} } }, set: null } }` in upsert's update branch — no equivalent.
