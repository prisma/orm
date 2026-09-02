import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract as ContractDifferentNames } from './_fixture/different-names/generated/contract';
import contractDifferentNamesJson from './_fixture/different-names/generated/contract.json' with {
  type: 'json',
};
import type { Contract as ContractIdenticalNames } from './_fixture/identical-names/generated/contract';
import contractIdenticalNamesJson from './_fixture/identical-names/generated/contract.json' with {
  type: 'json',
};
import type { Contract as ContractNoMap } from './_fixture/no-map/generated/contract';
import contractNoMapJson from './_fixture/no-map/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/multi-schema
// (postgres matrix entry only; sqlserver is non-ported).
//
// Upstream suite: CRUD across two postgres schemas (base.User, transactional.Post)
// with three @@map variants: no mapping, identical table names, different table names.
//
// Prisma @@schema("x") maps to prisma-next `namespace x { model ... }`.
// Cross-namespace relation: `posts transactional.Post[]` / `author base.User?`.
// ORM access: db.base.User, db.transactional.Post.
//
// Non-ported (all in inbox):
//   - sqlserver matrix variants (2×create, 2×read, 2×update, 2×delete) — provider not supported

// ─── helpers ────────────────────────────────────────────────────────────────

function withMultiSchemaNoMap(fn: Parameters<typeof withPostgresPort<ContractNoMap>>[1]) {
  return withPostgresPort<ContractNoMap>({ contractJson: contractNoMapJson }, fn);
}

function withMultiSchemaIdenticalNames(
  fn: Parameters<typeof withPostgresPort<ContractIdenticalNames>>[1],
) {
  return withPostgresPort<ContractIdenticalNames>({ contractJson: contractIdenticalNamesJson }, fn);
}

function withMultiSchemaDifferentNames(
  fn: Parameters<typeof withPostgresPort<ContractDifferentNames>>[1],
) {
  return withPostgresPort<ContractDifferentNames>({ contractJson: contractDifferentNamesJson }, fn);
}

// ─── mapTable = false ────────────────────────────────────────────────────────

describe('ports/prisma/functional/multi-schema (mapTable=false)', () => {
  it(
    'multischema: create',
    () =>
      withMultiSchemaNoMap(async ({ db }) => {
        const email = 'create-no-map@example.com';
        const title = 'Test Post No Map';

        const created = await db.base.User.select('email')
          .include('posts')
          .create({
            email,
            posts: (posts) => posts.create([{ title }]),
          });

        expect(created).toMatchObject({
          email,
          posts: [{ title }],
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'multischema: read',
    () =>
      withMultiSchemaNoMap(async ({ db }) => {
        const email = 'read-no-map@example.com';
        const title = 'Read Post No Map';

        await db.base.User.create({
          email,
          posts: (posts) => posts.create([{ title }]),
        });

        const rows = await db.base.User.select('email')
          .include('posts')
          .where({ email })
          .where((u) => u.posts.some((p) => p.title.eq(title)))
          .all();

        expect(rows.length).toBe(1);
        expect(rows[0]).toMatchObject({
          email,
          posts: [{ title }],
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'multischema: update',
    () =>
      withMultiSchemaNoMap(async ({ db }) => {
        const email = 'update-no-map@example.com';
        const title = 'Update Post No Map';
        const newEmail = 'update-no-map-new@example.com';
        const newTitle = 'Updated Post No Map';

        await db.base.User.create({
          email,
          posts: (posts) => posts.create([{ title }]),
        });

        await db.transactional.Post.where({ title }).updateAll({ title: newTitle });
        await db.base.User.where({ email }).updateAll({ email: newEmail });

        const rows = await db.base.User.select('email')
          .include('posts')
          .where({ email: newEmail })
          .where((u) => u.posts.some((p) => p.title.eq(newTitle)))
          .all();

        expect(rows.length).toBe(1);
        expect(rows[0]).toMatchObject({
          email: newEmail,
          posts: [{ title: newTitle }],
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'multischema: delete',
    () =>
      withMultiSchemaNoMap(async ({ db }) => {
        const email = 'delete-no-map@example.com';
        const title = 'Delete Post No Map';

        await db.base.User.create({
          email,
          posts: (posts) => posts.create([{ title }]),
        });

        await db.transactional.Post.where({ title }).deleteAll();
        await db.base.User.where({ email }).deleteAll();

        const posts = await db.transactional.Post.where({ title }).all();
        const users = await db.base.User.where({ email }).all();
        expect(posts).toHaveLength(0);
        expect(users).toHaveLength(0);
      }),
    timeouts.spinUpPpgDev,
  );
});

// ─── mapTable = IDENTICAL_NAMES ──────────────────────────────────────────────

describe('ports/prisma/functional/multi-schema (mapTable=IDENTICAL_NAMES)', () => {
  it(
    'multischema: create',
    () =>
      withMultiSchemaIdenticalNames(async ({ db }) => {
        const email = 'create-identical@example.com';
        const title = 'Test Post Identical';

        const created = await db.base.User.select('email')
          .include('posts')
          .create({
            email,
            posts: (posts) => posts.create([{ title }]),
          });

        expect(created).toMatchObject({
          email,
          posts: [{ title }],
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'multischema: read',
    () =>
      withMultiSchemaIdenticalNames(async ({ db }) => {
        const email = 'read-identical@example.com';
        const title = 'Read Post Identical';

        await db.base.User.create({
          email,
          posts: (posts) => posts.create([{ title }]),
        });

        const rows = await db.base.User.select('email')
          .include('posts')
          .where({ email })
          .where((u) => u.posts.some((p) => p.title.eq(title)))
          .all();

        expect(rows.length).toBe(1);
        expect(rows[0]).toMatchObject({
          email,
          posts: [{ title }],
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'multischema: update',
    () =>
      withMultiSchemaIdenticalNames(async ({ db }) => {
        const email = 'update-identical@example.com';
        const title = 'Update Post Identical';
        const newEmail = 'update-identical-new@example.com';
        const newTitle = 'Updated Post Identical';

        await db.base.User.create({
          email,
          posts: (posts) => posts.create([{ title }]),
        });

        await db.transactional.Post.where({ title }).updateAll({ title: newTitle });
        await db.base.User.where({ email }).updateAll({ email: newEmail });

        const rows = await db.base.User.select('email')
          .include('posts')
          .where({ email: newEmail })
          .where((u) => u.posts.some((p) => p.title.eq(newTitle)))
          .all();

        expect(rows.length).toBe(1);
        expect(rows[0]).toMatchObject({
          email: newEmail,
          posts: [{ title: newTitle }],
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'multischema: delete',
    () =>
      withMultiSchemaIdenticalNames(async ({ db }) => {
        const email = 'delete-identical@example.com';
        const title = 'Delete Post Identical';

        await db.base.User.create({
          email,
          posts: (posts) => posts.create([{ title }]),
        });

        await db.transactional.Post.where({ title }).deleteAll();
        await db.base.User.where({ email }).deleteAll();

        const posts = await db.transactional.Post.where({ title }).all();
        const users = await db.base.User.where({ email }).all();
        expect(posts).toHaveLength(0);
        expect(users).toHaveLength(0);
      }),
    timeouts.spinUpPpgDev,
  );
});

// ─── mapTable = DIFFERENT_NAMES ──────────────────────────────────────────────

describe('ports/prisma/functional/multi-schema (mapTable=DIFFERENT_NAMES)', () => {
  it(
    'multischema: create',
    () =>
      withMultiSchemaDifferentNames(async ({ db }) => {
        const email = 'create-different@example.com';
        const title = 'Test Post Different';

        const created = await db.base.User.select('email')
          .include('posts')
          .create({
            email,
            posts: (posts) => posts.create([{ title }]),
          });

        expect(created).toMatchObject({
          email,
          posts: [{ title }],
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'multischema: read',
    () =>
      withMultiSchemaDifferentNames(async ({ db }) => {
        const email = 'read-different@example.com';
        const title = 'Read Post Different';

        await db.base.User.create({
          email,
          posts: (posts) => posts.create([{ title }]),
        });

        const rows = await db.base.User.select('email')
          .include('posts')
          .where({ email })
          .where((u) => u.posts.some((p) => p.title.eq(title)))
          .all();

        expect(rows.length).toBe(1);
        expect(rows[0]).toMatchObject({
          email,
          posts: [{ title }],
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'multischema: update',
    () =>
      withMultiSchemaDifferentNames(async ({ db }) => {
        const email = 'update-different@example.com';
        const title = 'Update Post Different';
        const newEmail = 'update-different-new@example.com';
        const newTitle = 'Updated Post Different';

        await db.base.User.create({
          email,
          posts: (posts) => posts.create([{ title }]),
        });

        await db.transactional.Post.where({ title }).updateAll({ title: newTitle });
        await db.base.User.where({ email }).updateAll({ email: newEmail });

        const rows = await db.base.User.select('email')
          .include('posts')
          .where({ email: newEmail })
          .where((u) => u.posts.some((p) => p.title.eq(newTitle)))
          .all();

        expect(rows.length).toBe(1);
        expect(rows[0]).toMatchObject({
          email: newEmail,
          posts: [{ title: newTitle }],
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'multischema: delete',
    () =>
      withMultiSchemaDifferentNames(async ({ db }) => {
        const email = 'delete-different@example.com';
        const title = 'Delete Post Different';

        await db.base.User.create({
          email,
          posts: (posts) => posts.create([{ title }]),
        });

        await db.transactional.Post.where({ title }).deleteAll();
        await db.base.User.where({ email }).deleteAll();

        const posts = await db.transactional.Post.where({ title }).all();
        const users = await db.base.User.where({ email }).all();
        expect(posts).toHaveLength(0);
        expect(users).toHaveLength(0);
      }),
    timeouts.spinUpPpgDev,
  );
});
