import type { PortContext } from '../../../../_harness/postgres';
import type { Contract as RepresentativeContract } from './_fixture/default-nomap/generated/contract';

// Shared helpers for the relationMode-in-separate-gh-action m:n port.
//
// Upstream: prisma/prisma@a6d0155
//   packages/client/tests/functional/relationMode-in-separate-gh-action/tests_m-to-n.ts
//
// The three models (PostManyToMany, CategoryManyToMany, and the explicit
// junction CategoriesOnPostsManyToMany) are identical across every fixture
// variant; only the underlying @relation actions / @map physical names differ,
// and neither surfaces through the domain-facing ORM API (which is keyed on
// model/field names, not physical column/table names or FK actions). So every
// variant's `db` handle is structurally identical at the ORM surface, and the
// helpers are typed against one representative variant and reused everywhere.
type Db = PortContext<RepresentativeContract>['db'];

export const expectedPostsIfNoChange = [
  { id: '1', published: null },
  { id: '2', published: null },
];

export const expectedCategoriesIfNoChange = [
  { id: '1-cat-a', published: null },
  { id: '1-cat-b', published: null },
  { id: '2-cat-a', published: null },
  { id: '2-cat-b', published: null },
];

export const expectedJunctionIfNoChange = [
  { categoryId: '1-cat-a', postId: '1' },
  { categoryId: '1-cat-b', postId: '1' },
  { categoryId: '2-cat-a', postId: '2' },
  { categoryId: '2-cat-b', postId: '2' },
];

/**
 * Faithful translation of upstream `createXPostsWith2CategoriesSQLDb({ count: 2 })`.
 *
 * Upstream batches the two nested creates into a single `$transaction([...])`;
 * per the port harness each test runs against a fresh database, so the batch
 * is pure setup seeding and is faithfully expressed as two sequential awaited
 * nested creates (same nested-create API shape, no batch-transaction feature).
 */
export async function seedTwoPostsWithTwoCategories(db: Db): Promise<void> {
  for (const id of ['1', '2']) {
    await db.public.PostManyToMany.create({
      id,
      categories: (categories) =>
        categories.create([
          { category: (category) => category.create({ id: `${id}-cat-a` }) },
          { category: (category) => category.create({ id: `${id}-cat-b` }) },
        ]),
    });
  }
}

export function allPosts(db: Db) {
  return db.public.PostManyToMany.select('id', 'published')
    .orderBy((post) => post.id.asc())
    .all();
}

export function allCategories(db: Db) {
  return db.public.CategoryManyToMany.select('id', 'published')
    .orderBy((category) => category.id.asc())
    .all();
}

export function allJunction(db: Db) {
  return db.public.CategoriesOnPostsManyToMany.select('postId', 'categoryId')
    .orderBy((row) => row.categoryId.asc())
    .all();
}
