import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

function withDistinct(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

async function seedBasic(
  db: Parameters<Parameters<typeof withPostgresPort<Contract>>[1]>[0]['db'],
) {
  await db.public.User.createAll([
    { id: 1, first_name: 'Joe', last_name: 'Doe', email: '1' },
    { id: 2, first_name: 'Hans', last_name: 'Wurst', email: '2' },
    { id: 3, first_name: 'Joe', last_name: 'Doe', email: '3' },
  ]);
}

async function seedNested(
  db: Parameters<Parameters<typeof withPostgresPort<Contract>>[1]>[0]['db'],
) {
  await db.public.User.createAll([
    { id: 1, first_name: 'Joe', last_name: 'Doe', email: '1' },
    { id: 2, first_name: 'Joe', last_name: 'Doe', email: '2' },
    { id: 3, first_name: 'Rocky', last_name: 'Balboa', email: '3' },
    { id: 4, first_name: 'Papa', last_name: 'Elon', email: '4' },
    { id: 5, first_name: 'Troll', last_name: 'Face', email: '5' },
  ]);
  await db.public.Post.createAll([
    { id: 1, title: '3', author_id: 1 },
    { id: 2, title: '1', author_id: 1 },
    { id: 3, title: '1', author_id: 1 },
    { id: 4, title: '2', author_id: 1 },
    { id: 5, title: '1', author_id: 1 },
    { id: 6, title: '1', author_id: 2 },
    { id: 7, title: '2', author_id: 2 },
    { id: 8, title: '1', author_id: 4 },
    { id: 9, title: '1', author_id: 4 },
    { id: 10, title: '2', author_id: 5 },
    { id: 11, title: '3', author_id: 5 },
    { id: 12, title: '2', author_id: 5 },
  ]);
}

describe('ports/engines/queries/distinct', () => {
  it(
    'empty_database',
    () =>
      withDistinct(async ({ db }) => {
        expect(
          await db.public.User.select('id', 'first_name', 'last_name')
            .distinct('first_name', 'last_name')
            .all(),
        ).toEqual([]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'no_panic',
    () =>
      withDistinct(async ({ db }) => {
        await db.public.User.createAll([
          { id: 1, first_name: 'Joe', last_name: 'Doe', email: '1' },
          { id: 2, first_name: 'Doe', last_name: 'Joe', email: '2' },
        ]);
        expect(await db.public.User.select('id').distinct('first_name', 'last_name').all()).toEqual(
          [{ id: 2 }, { id: 1 }],
        );
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'shorthand_works',
    () =>
      withDistinct(async ({ db }) => {
        await db.public.User.createAll([
          { id: 1, first_name: 'Joe', last_name: 'Doe', email: '1' },
          { id: 2, first_name: 'Joe', last_name: 'Doe', email: '2' },
        ]);
        expect(await db.public.User.select('id').distinct('first_name').all()).toEqual([{ id: 1 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'with_duplicates',
    () =>
      withDistinct(async ({ db }) => {
        await seedBasic(db);
        expect(
          await db.public.User.select('id', 'first_name', 'last_name')
            .distinct('first_name', 'last_name')
            .all(),
        ).toEqual([
          { id: 2, first_name: 'Hans', last_name: 'Wurst' },
          { id: 1, first_name: 'Joe', last_name: 'Doe' },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'with_skip_basic',
    () =>
      withDistinct(async ({ db }) => {
        await seedBasic(db);
        expect(
          await db.public.User.select('id', 'first_name', 'last_name')
            .distinct('first_name', 'last_name')
            .offset(1)
            .all(),
        ).toEqual([{ id: 2, first_name: 'Hans', last_name: 'Wurst' }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'with_skip_orderby',
    () =>
      withDistinct(async ({ db }) => {
        await seedBasic(db);
        expect(
          await db.public.User.select('first_name', 'last_name')
            .orderBy((u) => u.first_name.asc())
            .distinct('first_name', 'last_name')
            .offset(1)
            .all(),
        ).toEqual([{ first_name: 'Joe', last_name: 'Doe' }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'with_skip_orderby_nondistinct',
    () =>
      withDistinct(async ({ db }) => {
        await seedBasic(db);
        expect(
          await db.public.User.select('id', 'first_name', 'last_name')
            .orderBy((u) => u.id.desc())
            .distinct('first_name', 'last_name')
            .all(),
        ).toEqual([
          { id: 3, first_name: 'Joe', last_name: 'Doe' },
          { id: 2, first_name: 'Hans', last_name: 'Wurst' },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'nested_distinct',
    () =>
      withDistinct(async ({ db }) => {
        await seedNested(db);
        expect(
          await db.public.User.select('id')
            .distinct('first_name', 'last_name')
            .orderBy((u) => u.id.asc())
            .include('posts', (posts) =>
              posts
                .select('title')
                .distinct('title')
                .orderBy((p) => p.id.asc()),
            )
            .all(),
        ).toEqual([
          { id: 1, posts: [{ title: '3' }, { title: '1' }, { title: '2' }] },
          { id: 3, posts: [] },
          { id: 4, posts: [{ title: '1' }] },
          { id: 5, posts: [{ title: '2' }, { title: '3' }] },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'nested_distinct_order_by_field',
    () =>
      withDistinct(async ({ db }) => {
        await seedNested(db);
        expect(
          await db.public.User.select('id')
            .distinct('first_name', 'last_name')
            .orderBy([(u) => u.first_name.asc(), (u) => u.last_name.asc()])
            .include('posts', (posts) =>
              posts
                .select('title')
                .distinct('title')
                .orderBy((p) => p.title.asc()),
            )
            .all(),
        ).toEqual([
          { id: 1, posts: [{ title: '1' }, { title: '2' }, { title: '3' }] },
          { id: 4, posts: [{ title: '1' }] },
          { id: 3, posts: [] },
          { id: 5, posts: [{ title: '2' }, { title: '3' }] },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'nested_distinct_reversed',
    () =>
      withDistinct(async ({ db }) => {
        await seedNested(db);
        expect(
          await db.public.User.select('id')
            .distinct('first_name', 'last_name')
            .orderBy((u) => u.id.desc())
            .include('posts', (posts) =>
              posts
                .select('title')
                .distinct('title')
                .orderBy((p) => p.id.desc()),
            )
            .all(),
        ).toEqual([
          { id: 5, posts: [{ title: '2' }, { title: '3' }] },
          { id: 4, posts: [{ title: '1' }] },
          { id: 3, posts: [] },
          { id: 2, posts: [{ title: '2' }, { title: '1' }] },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'nested_distinct_not_in_selection',
    () =>
      withDistinct(async ({ db }) => {
        await seedNested(db);
        expect(
          await db.public.User.select('id')
            .orderBy((u) => u.id.asc())
            .include('posts', (posts) =>
              posts
                .select('id')
                .distinct('title')
                .orderBy((p) => p.id.desc()),
            )
            .all(),
        ).toEqual([
          { id: 1, posts: [{ id: 5 }, { id: 4 }, { id: 1 }] },
          { id: 2, posts: [{ id: 7 }, { id: 6 }] },
          { id: 3, posts: [] },
          { id: 4, posts: [{ id: 9 }] },
          { id: 5, posts: [{ id: 12 }, { id: 11 }] },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );
});
