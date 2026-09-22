# Non-ported — relation-mode-gh-m-to-n-mongodb (MongoDB m:n)

Source: `packages/client/tests/functional/relationMode-in-separate-gh-action/tests_m-to-n-MongoDB.ts`
(prisma/prisma@a6d0155; MongoDB matrix entry, `isSchemaUsingMap=false` branch).

**Whole-suite gap — the schema shape is inexpressible.** These tests exercise the upstream
*two-way embedded implicit many-to-many* relation: on both models a scalar FK-array plus a
list relation over it (`categoryIDs String[]` + `categories CategoryManyToMany[] @relation(fields: [categoryIDs], references: [id])`,
and the mirror on the category side). Prisma 8's mongo authoring cannot express this shape.
Confirmed empirically by emitting the faithful fixture (`contract emit`), which rejects it with:

- `PSL_MONGO_ID_REQUIRED` — each model must declare `id ObjectId @id @map("_id")`; the suite uses `String @id @map("_id")` with arbitrary string ids (`'1-cat-a'`).
- `PSL_ORPHANED_BACKRELATION` — "Backrelation list field ... has no matching FK-side relation ... use an explicit join model for many-to-many." Prisma 8 has no two-way embedded implicit m2m; the only supported m:n is an explicit junction model with two FKs, which is a *different* schema shape (different collections, no `categoryIDs`/`postIDs` scalar arrays, different result shapes) — porting via a junction would change the subject under test.

Additionally the mongo ORM `create` accepts only a flat document — there is no nested-relation
`create` (`categories: { create: [...] }`) that the seeding for these suites requires.

No test files or fixtures were created for this suite (non-ported = ledger-only). One line per source test.

- `packages/client/tests/functional/relationMode-in-separate-gh-action/tests_m-to-n-MongoDB.ts` › `m:n mandatory (explicit) - MongoDB > [create] > [create] category alone should succeed` — creates a category, asserts findMany shape with empty `postIDs` — two-way embedded implicit m2m schema is inexpressible (PSL_ORPHANED_BACKRELATION; needs explicit join model) and requires ObjectId ids not arbitrary String ids.
- `packages/client/tests/functional/relationMode-in-separate-gh-action/tests_m-to-n-MongoDB.ts` › `m:n mandatory (explicit) - MongoDB > [create] > [create] post alone should succeed` — creates a post, asserts findMany shape with empty `categoryIDs` — same schema-level gap.
- `packages/client/tests/functional/relationMode-in-separate-gh-action/tests_m-to-n-MongoDB.ts` › `m:n mandatory (explicit) - MongoDB > [create] > [create] create post [nested] [create] categories [nested] [create] category should succeed` — nested relation create populating both implicit m2m ID arrays — same schema gap; mongo ORM create has no nested-relation create.
- `packages/client/tests/functional/relationMode-in-separate-gh-action/tests_m-to-n-MongoDB.ts` › `m:n mandatory (explicit) - MongoDB > [update] > [update] id (_id) should throw at runtime because id field is read-only/immutable` — asserts updating `_id` throws — same schema gap (suite cannot be authored).
- `packages/client/tests/functional/relationMode-in-separate-gh-action/tests_m-to-n-MongoDB.ts` › `m:n mandatory (explicit) - MongoDB > [update] > [update] (post) optional boolean field should succeed` — sets `published` on post, asserts m2m ID arrays preserved — same schema gap.
- `packages/client/tests/functional/relationMode-in-separate-gh-action/tests_m-to-n-MongoDB.ts` › `m:n mandatory (explicit) - MongoDB > [update] > [update] (category): optional boolean field should succeed` — sets `published` on category, asserts m2m ID arrays preserved — same schema gap.
- `packages/client/tests/functional/relationMode-in-separate-gh-action/tests_m-to-n-MongoDB.ts` › `m:n mandatory (explicit) - MongoDB > [delete] > onDelete: > [delete] post should succeed` — deletes a post, asserts remaining categories keep their `postIDs` — same schema gap.
- `packages/client/tests/functional/relationMode-in-separate-gh-action/tests_m-to-n-MongoDB.ts` › `m:n mandatory (explicit) - MongoDB > [delete] > onDelete: > [delete] category should succeed` — deletes a category, asserts remaining posts keep their `categoryIDs` — same schema gap.
