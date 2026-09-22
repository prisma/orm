# Non-ported — relation-mode-m-n-mongodb-at-map (MongoDB m:n, @map variant)

Source: `packages/client/tests/functional/relationMode-m-n-mongodb-failing-with-at-map/tests_m-to-n-MongoDB.ts`
(prisma/prisma@a6d0155; MongoDB matrix entry, `isSchemaUsingMap=true` variant with `@map`/`@@map`).
Upstream itself marks six of these `test.failing` because of prisma/prisma#15776; the two "alone"
creates pass upstream.

**Whole-suite gap — same as the non-@map MongoDB suite.** These tests port the same upstream
*two-way embedded implicit many-to-many* schema (`categoryIDs String[]` + `categories CategoryManyToMany[] @relation(fields: [categoryIDs], references: [id])`
on both sides, here with `@map`/`@@map` physical-name overrides). Prisma 8's mongo authoring
rejects the shape at emit (`PSL_ORPHANED_BACKRELATION` — "use an explicit join model for
many-to-many"; the only supported m:n is an explicit junction, a different schema shape) and
requires `id ObjectId @id @map("_id")` rather than the suite's `String @id @map("_id")` with
arbitrary string ids (`PSL_MONGO_ID_REQUIRED`, confirmed empirically). The mongo ORM `create`
also has no nested-relation create. The faithful schema cannot be pushed, so every test is
non-ported. No test files or fixtures were created. One line per source test (upstream
annotations preserved).

- `packages/client/tests/functional/relationMode-m-n-mongodb-failing-with-at-map/tests_m-to-n-MongoDB.ts` › `m:n mandatory (explicit) - MongoDB > [create] > [create] category alone should succeed` — creates a category, asserts findMany shape — two-way embedded implicit m2m schema is inexpressible (PSL_ORPHANED_BACKRELATION; needs explicit join model) and requires ObjectId ids not arbitrary String ids.
- `packages/client/tests/functional/relationMode-m-n-mongodb-failing-with-at-map/tests_m-to-n-MongoDB.ts` › `m:n mandatory (explicit) - MongoDB > [create] > [create] post alone should succeed` — creates a post, asserts findMany shape — same schema-level gap.
- `packages/client/tests/functional/relationMode-m-n-mongodb-failing-with-at-map/tests_m-to-n-MongoDB.ts` › `m:n mandatory (explicit) - MongoDB > [create] > [create] create post [nested] [create] categories [nested] [create] category should succeed` (upstream test.failing, #15776) — nested relation create — same schema gap; no nested-relation create in mongo ORM.
- `packages/client/tests/functional/relationMode-m-n-mongodb-failing-with-at-map/tests_m-to-n-MongoDB.ts` › `m:n mandatory (explicit) - MongoDB > [update] > [update] id (_id) should throw at runtime because id field is read-only/immutable` (upstream test.failing, #15776) — asserts updating `_id` throws — same schema gap.
- `packages/client/tests/functional/relationMode-m-n-mongodb-failing-with-at-map/tests_m-to-n-MongoDB.ts` › `m:n mandatory (explicit) - MongoDB > [update] > [update] (post) optional boolean field should succeed` (upstream test.failing, #15776) — same schema gap.
- `packages/client/tests/functional/relationMode-m-n-mongodb-failing-with-at-map/tests_m-to-n-MongoDB.ts` › `m:n mandatory (explicit) - MongoDB > [update] > [update] (category): optional boolean field should succeed` (upstream test.failing, #15776) — same schema gap.
- `packages/client/tests/functional/relationMode-m-n-mongodb-failing-with-at-map/tests_m-to-n-MongoDB.ts` › `m:n mandatory (explicit) - MongoDB > [delete] > onDelete: > [delete] post should succeed` (upstream test.failing, #15776) — same schema gap.
- `packages/client/tests/functional/relationMode-m-n-mongodb-failing-with-at-map/tests_m-to-n-MongoDB.ts` › `m:n mandatory (explicit) - MongoDB > [delete] > onDelete: > [delete] category should succeed` (upstream test.failing, #15776) — same schema gap.
