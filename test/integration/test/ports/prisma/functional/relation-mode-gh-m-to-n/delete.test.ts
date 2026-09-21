import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import cascadeNoMapJson from './_fixture/cascade-nomap/generated/contract.json' with {
  type: 'json',
};
import type { Contract as RepresentativeContract } from './_fixture/default-nomap/generated/contract';
import defaultNoMapJson from './_fixture/default-nomap/generated/contract.json' with {
  type: 'json',
};
import noactionNoMapJson from './_fixture/noaction-nomap/generated/contract.json' with {
  type: 'json',
};
import restrictNoMapJson from './_fixture/restrict-nomap/generated/contract.json' with {
  type: 'json',
};
import {
  allCategories,
  allJunction,
  allPosts,
  expectedCategoriesIfNoChange,
  expectedJunctionIfNoChange,
  expectedPostsIfNoChange,
  seedTwoPostsWithTwoCategories,
} from './_shared';

// Port of prisma/prisma@a6d0155
//   packages/client/tests/functional/relationMode-in-separate-gh-action/tests_m-to-n.ts
//   → describe('[delete]') block, m:n mandatory (explicit) — SQL Databases.
//
// Scope: relationMode=foreignKeys only (relationMode=prisma entries non-ported).
// Only isSchemaUsingMap=false (`-nomap`) variants run here. @map changes only
// physical names, which never surface through the domain-facing ORM API, so
// the map variants add emit coverage in emit-map.test.ts rather than duplicate
// this runtime matrix. Every fixture variant is run under one representative
// Contract type; the DB-level FK actions that distinguish them are exercised
// at runtime.
//
// Each [delete] test seeds two posts each with two categories first (upstream
// `beforeEach` → `createXPostsWith2CategoriesSQLDb({ count: 2 })`).

// DEFAULT, SetNull(==DEFAULT schema), NoAction and Restrict all leave the
// junction FK with no ON DELETE cascade, so deleting a referenced parent throws.
const THROW_ON_DELETE_FIXTURES: ReadonlyArray<{ label: string; contractJson: unknown }> = [
  { label: 'DEFAULT (no action) / map=false', contractJson: defaultNoMapJson },
  { label: 'NoAction / map=false', contractJson: noactionNoMapJson },
  { label: 'Restrict / map=false', contractJson: restrictNoMapJson },
];

const CASCADE_DELETE_FIXTURES: ReadonlyArray<{ label: string; contractJson: unknown }> = [
  { label: 'Cascade / map=false', contractJson: cascadeNoMapJson },
];

const ALL_DELETE_FIXTURES = [...THROW_ON_DELETE_FIXTURES, ...CASCADE_DELETE_FIXTURES];

describe('ports/prisma/functional/relationMode-gh-m-to-n › [delete]', () => {
  // --- onDelete: DEFAULT, Restrict, NoAction, SetNull — deleting parent throws ---
  for (const { label, contractJson } of THROW_ON_DELETE_FIXTURES) {
    describe(`${label} — onDelete: DEFAULT, Restrict, NoAction, SetNull`, () => {
      it(
        '[delete] post throws',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await seedTwoPostsWithTwoCategories(db);

            await expect(db.public.PostManyToMany.where({ id: '1' }).delete()).rejects.toThrow();

            expect(await allPosts(db)).toEqual(expectedPostsIfNoChange);
            expect(await allCategories(db)).toEqual(expectedCategoriesIfNoChange);
            expect(await allJunction(db)).toEqual(expectedJunctionIfNoChange);
          }),
        timeouts.spinUpPpgDev,
      );

      it(
        '[delete] category throws',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await seedTwoPostsWithTwoCategories(db);

            await expect(
              db.public.CategoryManyToMany.where({ id: '1-cat-a' }).delete(),
            ).rejects.toThrow();

            expect(await allPosts(db)).toEqual(expectedPostsIfNoChange);
            expect(await allCategories(db)).toEqual(expectedCategoriesIfNoChange);
            expect(await allJunction(db)).toEqual(expectedJunctionIfNoChange);
          }),
        timeouts.spinUpPpgDev,
      );
    });
  }

  // --- onDelete: Cascade — deleting parent cascades to the junction ---
  for (const { label, contractJson } of CASCADE_DELETE_FIXTURES) {
    describe(`${label} — onDelete: Cascade`, () => {
      it(
        '[delete] post succeeds and cascades junction rows',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await seedTwoPostsWithTwoCategories(db);

            await db.public.PostManyToMany.where({ id: '1' }).delete();

            expect(await allPosts(db)).toEqual([{ id: '2', published: null }]);
            expect(await allCategories(db)).toEqual(expectedCategoriesIfNoChange);
            expect(await allJunction(db)).toEqual([
              { categoryId: '2-cat-a', postId: '2' },
              { categoryId: '2-cat-b', postId: '2' },
            ]);
          }),
        timeouts.spinUpPpgDev,
      );

      it(
        '[delete] category succeeds and cascades junction rows',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await seedTwoPostsWithTwoCategories(db);

            await db.public.CategoryManyToMany.where({ id: '1-cat-a' }).delete();

            expect(await allPosts(db)).toEqual(expectedPostsIfNoChange);
            expect(await allCategories(db)).toEqual([
              { id: '1-cat-b', published: null },
              { id: '2-cat-a', published: null },
              { id: '2-cat-b', published: null },
            ]);
            expect(await allJunction(db)).toEqual([
              { categoryId: '1-cat-b', postId: '1' },
              { categoryId: '2-cat-a', postId: '2' },
              { categoryId: '2-cat-b', postId: '2' },
            ]);
          }),
        timeouts.spinUpPpgDev,
      );
    });
  }

  // --- [delete] junction succeeds (action-independent) ---
  for (const { label, contractJson } of ALL_DELETE_FIXTURES) {
    describe(label, () => {
      it(
        '[delete] junction row succeeds',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await seedTwoPostsWithTwoCategories(db);

            await db.public.CategoriesOnPostsManyToMany.where({
              postId: '1',
              categoryId: '1-cat-a',
            }).delete();

            expect(await allPosts(db)).toEqual(expectedPostsIfNoChange);
            expect(await allCategories(db)).toEqual(expectedCategoriesIfNoChange);
            expect(await allJunction(db)).toEqual([
              { categoryId: '1-cat-b', postId: '1' },
              { categoryId: '2-cat-a', postId: '2' },
              { categoryId: '2-cat-b', postId: '2' },
            ]);
          }),
        timeouts.spinUpPpgDev,
      );
    });
  }
});
