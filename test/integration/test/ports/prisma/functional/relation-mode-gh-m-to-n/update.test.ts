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
//   → describe('[update]') block, m:n mandatory (explicit) — SQL Databases.
//
// Scope: relationMode=foreignKeys only (relationMode=prisma entries non-ported).
// Only isSchemaUsingMap=false (`-nomap`) variants run here. @map changes only
// physical names, which never surface through the domain-facing ORM API, so
// the map variants add emit coverage in emit-map.test.ts rather than duplicate
// this runtime matrix. Every fixture variant is run under one representative
// Contract type; the DB-level FK actions that distinguish them are exercised
// at runtime.
//
// Each [update] test seeds two posts each with two categories first (upstream
// `beforeEach` → `createXPostsWith2CategoriesSQLDb({ count: 2 })`), reproduced
// here inside each test since the port harness gives every test a fresh DB.

const NO_ACTION_UPDATE_FIXTURES: ReadonlyArray<{ label: string; contractJson: unknown }> = [
  // DEFAULT / SetNull share the no-action schema (SetNull sets supportsRequired=false
  // → no referential-action line emitted → identical to DEFAULT for required m:n).
  { label: 'DEFAULT (no action) / map=false', contractJson: defaultNoMapJson },
  { label: 'NoAction / map=false', contractJson: noactionNoMapJson },
  { label: 'Restrict / map=false', contractJson: restrictNoMapJson },
];

const CASCADE_UPDATE_FIXTURES: ReadonlyArray<{ label: string; contractJson: unknown }> = [
  { label: 'Cascade / map=false', contractJson: cascadeNoMapJson },
];

const ALL_UPDATE_FIXTURES = [...NO_ACTION_UPDATE_FIXTURES, ...CASCADE_UPDATE_FIXTURES];

describe('ports/prisma/functional/relationMode-gh-m-to-n › [update]', () => {
  // --- Action-independent [update] tests (run across every variant) ---
  for (const { label, contractJson } of ALL_UPDATE_FIXTURES) {
    describe(label, () => {
      it(
        '[update] (post) optional boolean field succeeds',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await seedTwoPostsWithTwoCategories(db);

            await db.public.PostManyToMany.where({ id: '1' }).update({ published: true });

            expect(await allPosts(db)).toEqual([
              { id: '1', published: true },
              { id: '2', published: null },
            ]);
            expect(await allCategories(db)).toEqual(expectedCategoriesIfNoChange);
            expect(await allJunction(db)).toEqual(expectedJunctionIfNoChange);
          }),
        timeouts.spinUpPpgDev,
      );

      it(
        '[update] (category) optional boolean field succeeds',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await seedTwoPostsWithTwoCategories(db);

            await db.public.CategoryManyToMany.where({ id: '1-cat-a' }).update({ published: true });

            expect(await allPosts(db)).toEqual(expectedPostsIfNoChange);
            expect(await allCategories(db)).toEqual([
              { id: '1-cat-a', published: true },
              { id: '1-cat-b', published: null },
              { id: '2-cat-a', published: null },
              { id: '2-cat-b', published: null },
            ]);
            expect(await allJunction(db)).toEqual(expectedJunctionIfNoChange);
          }),
        timeouts.spinUpPpgDev,
      );

      it(
        '[update] junction with non-existing postId throws (foreignKeys)',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await seedTwoPostsWithTwoCategories(db);

            await expect(
              db.public.CategoriesOnPostsManyToMany.where({
                postId: '1',
                categoryId: '1-cat-a',
              }).update({
                postId: '99',
              }),
            ).rejects.toThrow();

            expect(await allPosts(db)).toEqual(expectedPostsIfNoChange);
            expect(await allCategories(db)).toEqual(expectedCategoriesIfNoChange);
            expect(await allJunction(db)).toEqual(expectedJunctionIfNoChange);
          }),
        timeouts.spinUpPpgDev,
      );

      it(
        '[update] junction with non-existing categoryId throws (foreignKeys)',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await seedTwoPostsWithTwoCategories(db);

            await expect(
              db.public.CategoriesOnPostsManyToMany.where({
                postId: '1',
                categoryId: '1-cat-a',
              }).update({
                categoryId: '99',
              }),
            ).rejects.toThrow();

            expect(await allPosts(db)).toEqual(expectedPostsIfNoChange);
            expect(await allCategories(db)).toEqual(expectedCategoriesIfNoChange);
            expect(await allJunction(db)).toEqual(expectedJunctionIfNoChange);
          }),
        timeouts.spinUpPpgDev,
      );

      it(
        '[update] junction postId succeeds',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await seedTwoPostsWithTwoCategories(db);

            await db.public.CategoriesOnPostsManyToMany.where({
              postId: '1',
              categoryId: '1-cat-a',
            }).update({
              postId: '2',
            });

            expect(await allPosts(db)).toEqual(expectedPostsIfNoChange);
            expect(await allCategories(db)).toEqual(expectedCategoriesIfNoChange);
            expect(await allJunction(db)).toEqual([
              { categoryId: '1-cat-a', postId: '2' },
              { categoryId: '1-cat-b', postId: '1' },
              { categoryId: '2-cat-a', postId: '2' },
              { categoryId: '2-cat-b', postId: '2' },
            ]);
          }),
        timeouts.spinUpPpgDev,
      );
    });
  }

  // --- onUpdate: Cascade — updating a parent id cascades to the junction ---
  for (const { label, contractJson } of CASCADE_UPDATE_FIXTURES) {
    describe(`${label} — onUpdate: Cascade`, () => {
      it(
        '[update] post id succeeds and cascades to junction',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await seedTwoPostsWithTwoCategories(db);

            await db.public.PostManyToMany.where({ id: '1' }).update({ id: '3' });

            expect(await allPosts(db)).toEqual([
              { id: '2', published: null },
              { id: '3', published: null },
            ]);
            expect(await allCategories(db)).toEqual(expectedCategoriesIfNoChange);
            expect(await allJunction(db)).toEqual([
              { categoryId: '1-cat-a', postId: '3' },
              { categoryId: '1-cat-b', postId: '3' },
              { categoryId: '2-cat-a', postId: '2' },
              { categoryId: '2-cat-b', postId: '2' },
            ]);
          }),
        timeouts.spinUpPpgDev,
      );

      it(
        '[update] category id succeeds and cascades to junction',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await seedTwoPostsWithTwoCategories(db);

            await db.public.CategoryManyToMany.where({ id: '1-cat-a' }).update({
              id: '1-cat-a-updated',
            });

            expect(await allPosts(db)).toEqual(expectedPostsIfNoChange);
            expect(await allCategories(db)).toEqual([
              { id: '1-cat-a-updated', published: null },
              { id: '1-cat-b', published: null },
              { id: '2-cat-a', published: null },
              { id: '2-cat-b', published: null },
            ]);
            expect(await allJunction(db)).toEqual([
              { categoryId: '1-cat-a-updated', postId: '1' },
              { categoryId: '1-cat-b', postId: '1' },
              { categoryId: '2-cat-a', postId: '2' },
              { categoryId: '2-cat-b', postId: '2' },
            ]);
          }),
        timeouts.spinUpPpgDev,
      );
    });
  }

  // --- onUpdate: NoAction / Restrict — updating a parent id throws ---
  for (const { label, contractJson } of [
    { label: 'NoAction / map=false', contractJson: noactionNoMapJson },
    { label: 'Restrict / map=false', contractJson: restrictNoMapJson },
  ]) {
    describe(`${label} — onUpdate: NoAction, Restrict`, () => {
      it(
        '[update] post id throws',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await seedTwoPostsWithTwoCategories(db);

            await expect(
              db.public.PostManyToMany.where({ id: '1' }).update({ id: '3' }),
            ).rejects.toThrow();

            expect(await allPosts(db)).toEqual(expectedPostsIfNoChange);
            expect(await allCategories(db)).toEqual(expectedCategoriesIfNoChange);
            expect(await allJunction(db)).toEqual(expectedJunctionIfNoChange);
          }),
        timeouts.spinUpPpgDev,
      );

      it(
        '[update] category id throws',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await seedTwoPostsWithTwoCategories(db);

            await expect(
              db.public.CategoryManyToMany.where({ id: '1-cat-a' }).update({
                id: '1-cat-a-updated',
              }),
            ).rejects.toThrow();

            expect(await allPosts(db)).toEqual(expectedPostsIfNoChange);
            expect(await allCategories(db)).toEqual(expectedCategoriesIfNoChange);
            expect(await allJunction(db)).toEqual(expectedJunctionIfNoChange);
          }),
        timeouts.spinUpPpgDev,
      );
    });
  }

  // --- onUpdate: DEFAULT / SetNull — FAITHFUL DIVERGENCE ---
  //
  // Upstream expects update-post-id / update-category-id to SUCCEED for the
  // DEFAULT and SetNull(==DEFAULT schema) matrix entries, because Prisma's
  // implicit default `onUpdate` for a required relation is `Cascade`, so the
  // DB-level FK is created with ON UPDATE CASCADE.
  //
  // prisma-next's implicit default `onUpdate` (no action line) is NO ACTION,
  // so updating a referenced parent id throws an FK violation instead of
  // cascading. This is a genuine implicit-default-semantics gap, not a bendable
  // assertion, so these tests are marked `it.fails`: they run the faithful
  // upstream query + success expectation and are expected to fail today.
  for (const { label, contractJson } of [
    { label: 'DEFAULT (no action) / map=false', contractJson: defaultNoMapJson },
  ]) {
    describe(`${label} — onUpdate: DEFAULT, SetNull (faithful divergence)`, () => {
      it.fails(
        '[update] post id — upstream expects success (implicit onUpdate=Cascade); prisma-next default onUpdate=NoAction throws',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await seedTwoPostsWithTwoCategories(db);

            await db.public.PostManyToMany.where({ id: '1' }).update({ id: '3' });

            expect(await allPosts(db)).toEqual([
              { id: '2', published: null },
              { id: '3', published: null },
            ]);
            expect(await allJunction(db)).toEqual([
              { categoryId: '1-cat-a', postId: '3' },
              { categoryId: '1-cat-b', postId: '3' },
              { categoryId: '2-cat-a', postId: '2' },
              { categoryId: '2-cat-b', postId: '2' },
            ]);
          }),
        timeouts.spinUpPpgDev,
      );

      it.fails(
        '[update] category id — upstream expects success (implicit onUpdate=Cascade); prisma-next default onUpdate=NoAction throws',
        () =>
          withPostgresPort<RepresentativeContract>({ contractJson }, async ({ db }) => {
            await seedTwoPostsWithTwoCategories(db);

            await db.public.CategoryManyToMany.where({ id: '1-cat-a' }).update({
              id: '1-cat-a-updated',
            });

            expect(await allJunction(db)).toEqual([
              { categoryId: '1-cat-a-updated', postId: '1' },
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
