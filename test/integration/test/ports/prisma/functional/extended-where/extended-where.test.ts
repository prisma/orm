import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/extended-where
// (postgres matrix entry only). The suite covers multi-field unique where,
// non-PK unique connect, findUnique/OrThrow, update, upsert, delete.
//
// Cursor faithfulness gap:
//   findMany/findFirst/findFirstOrThrow with cursor: prisma-next cursor is
//   exclusive (keyset-after, starts AFTER the cursor row); Prisma cursor is
//   inclusive (starts FROM the cursor row). A faithful port using
//   `.orderBy(...).cursor(...)` is expressible but returns a different result
//   → each cursor test is `it.fails` (faithful port that documents the gap).
//   aggregate cursor tests remain non-ported (Collection.aggregate() ignores
//   cursor state).
//
// Non-portable:
//   - validation tests: Prisma-specific error message snapshots +
//     expectTypeOf / AtLeast type-level tests; non-portable.
//
// Implementation notes:
//   - upstream `setup` creates User with `payment: { create: {} }`.
//     In prisma-next this is expressed as a nested create callback.
//     User.paymentId is mandatory; the nested Payment create populates it.
//   - upsert() does not support nested relation callbacks; where the
//     upstream upsert create clause uses `payment: { create: {} }` we
//     instead pre-create the Payment and provide paymentId directly.
//   - update({}) with no fields returns null (ORM skips the SQL round-trip),
//     so the faithful empty-data update ('update with where 1 unique (PK)')
//     is an it.fails (see failing.md).
//   - 'create with connect 2 uniques' is non-ported: prisma-next's connect
//     criterion accepts a single unique key, not a compound { id, referralId }
//     (see non-ported.md).

type DbHandle = import('../../../../_harness/postgres').PortContext<Contract>['db'];

async function createTestData(db: DbHandle) {
  const userId = randomBytes(12).toString('hex');
  const referralId = randomBytes(12).toString('hex');
  const postId1 = `01${randomBytes(11).toString('hex')}`;
  const postId2 = `02${randomBytes(11).toString('hex')}`;
  const postId3 = `03${randomBytes(11).toString('hex')}`;
  const profileAlias = randomBytes(6).toString('hex');
  const profileEmail = `${randomBytes(6).toString('hex')}@test.io`;
  const ccn = randomBytes(12).toString('hex');

  const user = await db.public.User.create({
    id: userId,
    referralId,
    payment: (p) => p.create({ ccn }),
  });

  await db.public.Post.createAll([
    { id: postId1, title: 'Hello World 1', authorId: user.id },
    { id: postId2, title: 'Hello World 2', authorId: user.id },
    { id: postId3, title: 'Hello World 3', authorId: user.id },
  ]);

  await db.public.Profile.create({
    userId: user.id,
    email: profileEmail,
    alias: profileAlias,
  });

  return { userId: user.id, postId1, postId2, postId3, referralId, ccn };
}

function withExtendedWhere(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/extended-where', () => {
  // ─── findMany with cursor (it.fails: exclusive vs inclusive) ─────────────

  it.fails(
    'findMany with cursor 1 unique (PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { postId2 } = await createTestData(db);
        const data = await db.public.Post.orderBy((p) => p.id.asc())
          .cursor({ id: postId2 })
          .all();
        // Prisma inclusive cursor: postId2 + postId3 = 2 rows
        // prisma-next exclusive cursor: only postId3 = 1 row → assertion fails
        expect(data.length).toBe(2);
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'findMany with cursor 2 uniques (PK & non-PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { postId2 } = await createTestData(db);
        const data = await db.public.Post.orderBy([(p) => p.id.asc(), (p) => p.title.asc()])
          .cursor({ id: postId2, title: 'Hello World 2' })
          .all();
        // Prisma inclusive cursor: postId2 + postId3 = 2 rows
        // prisma-next exclusive cursor: only postId3 = 1 row → assertion fails
        expect(data.length).toBe(2);
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'findMany with cursor 1 unique (non-PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        await createTestData(db);
        const data = await db.public.Post.orderBy((p) => p.title.asc())
          .cursor({ title: 'Hello World 2' })
          .all();
        // Prisma inclusive cursor: Hello World 2 + Hello World 3 = 2 rows
        // prisma-next exclusive cursor: only Hello World 3 = 1 row → assertion fails
        expect(data.length).toBe(2);
      }),
    timeouts.spinUpPpgDev,
  );

  // ─── findFirst with cursor (it.fails: exclusive vs inclusive) ────────────

  it.fails(
    'findFirst with cursor 1 unique (PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { postId2 } = await createTestData(db);
        const data = await db.public.Post.orderBy((p) => p.id.asc())
          .cursor({ id: postId2 })
          .first();
        // Prisma inclusive cursor starts FROM postId2; first() returns postId2
        // prisma-next exclusive cursor starts AFTER postId2; first() returns postId3 → assertion fails
        expect(data?.id).toBe(postId2);
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'findFirst with cursor 2 uniques (PK & non-PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { postId2 } = await createTestData(db);
        const data = await db.public.Post.orderBy([(p) => p.id.asc(), (p) => p.title.asc()])
          .cursor({ id: postId2, title: 'Hello World 2' })
          .first();
        expect(data?.id).toBe(postId2);
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'findFirst with cursor 1 unique (non-PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { postId2 } = await createTestData(db);
        const data = await db.public.Post.orderBy((p) => p.title.asc())
          .cursor({ title: 'Hello World 2' })
          .first();
        expect(data?.id).toBe(postId2);
      }),
    timeouts.spinUpPpgDev,
  );

  // ─── findFirstOrThrow with cursor (it.fails: exclusive vs inclusive) ──────

  it.fails(
    'findFirstOrThrow with cursor 1 unique (PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { postId2 } = await createTestData(db);
        const data = await db.public.Post.orderBy((p) => p.id.asc())
          .cursor({ id: postId2 })
          .first();
        if (!data) throw new Error('Expected to find post');
        expect(data.id).toBe(postId2);
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'findFirstOrThrow with cursor 2 uniques (PK & non-PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { postId2 } = await createTestData(db);
        const data = await db.public.Post.orderBy([(p) => p.id.asc(), (p) => p.title.asc()])
          .cursor({ id: postId2, title: 'Hello World 2' })
          .first();
        if (!data) throw new Error('Expected to find post');
        expect(data.id).toBe(postId2);
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'findFirstOrThrow with cursor 1 unique (non-PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { postId2 } = await createTestData(db);
        const data = await db.public.Post.orderBy((p) => p.title.asc())
          .cursor({ title: 'Hello World 2' })
          .first();
        if (!data) throw new Error('Expected to find post');
        expect(data.id).toBe(postId2);
      }),
    timeouts.spinUpPpgDev,
  );

  // ─── findUnique ───────────────────────────────────────────────────────────

  it(
    'findUnique with where 1 unique (PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { userId } = await createTestData(db);
        const data = await db.public.User.first({ id: userId });
        expect(data?.id).toBe(userId);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'findUnique with where 2 uniques (PK & non-PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { postId1 } = await createTestData(db);
        const data = await db.public.Post.where({ id: postId1 })
          .where({ title: 'Hello World 1' })
          .first();
        expect(data?.id).toBe(postId1);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'findUnique with where 1 unique (non-PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { postId2 } = await createTestData(db);
        const data = await db.public.Post.first({ title: 'Hello World 2' });
        expect(data?.id).toBe(postId2);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'findUnique with nested where on optional 1:1 not found',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { userId } = await createTestData(db);
        // Faithful port of upstream filtered nested include:
        //   findUnique({ where: { id }, include: { payment: { where: { ccn: 'not there' } } } })
        // prisma-next expresses this as .include('payment', p => p.where(...)); a
        // non-matching filter nulls out the to-one relation.
        const data = await db.public.User.where({ id: userId })
          .include('payment', (p) => p.where({ ccn: 'not there' }))
          .first();
        expect(data?.payment).toBeNull();
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'findUnique with nested where on optional 1:1 found',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { userId, ccn } = await createTestData(db);
        // Faithful port of upstream filtered nested include with a matching filter:
        //   include: { payment: { where: { ccn: vars.ccn } } } → payment not null
        const data = await db.public.User.where({ id: userId })
          .include('payment', (p) => p.where({ ccn }))
          .first();
        expect(data?.payment).not.toBeNull();
      }),
    timeouts.spinUpPpgDev,
  );

  // ─── findUniqueOrThrow ────────────────────────────────────────────────────

  it(
    'findUniqueOrThrow with where 1 unique (PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { userId } = await createTestData(db);
        const data = await db.public.User.first({ id: userId });
        if (!data) throw new Error('Expected to find user');
        expect(data.id).toBe(userId);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'findUniqueOrThrow with where 2 uniques (PK & non-PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { postId1 } = await createTestData(db);
        const data = await db.public.Post.where({ id: postId1 })
          .where({ title: 'Hello World 1' })
          .first();
        if (!data) throw new Error('Expected to find post');
        expect(data.id).toBe(postId1);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'findUniqueOrThrow with where 1 unique (non-PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { postId1 } = await createTestData(db);
        const data = await db.public.Post.first({ title: 'Hello World 1' });
        if (!data) throw new Error('Expected to find post');
        expect(data.id).toBe(postId1);
      }),
    timeouts.spinUpPpgDev,
  );

  // ─── create with connect ──────────────────────────────────────────────────

  it(
    'create with connect 1 unique (PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const userId = randomBytes(12).toString('hex');
        const userReferralId = randomBytes(12).toString('hex');
        const user = await db.public.User.create({
          id: userId,
          referralId: userReferralId,
          payment: (p) => p.create({ ccn: randomBytes(12).toString('hex') }),
        });

        await db.public.Profile.create({
          alias: `alias_${randomBytes(4).toString('hex')}`,
          email: `${randomBytes(4).toString('hex')}@test.io`,
          user: (u) => u.connect({ id: user.id }),
        });

        const profile = await db.public.Profile.first({ userId: user.id });
        expect(profile).not.toBeNull();
      }),
    timeouts.spinUpPpgDev,
  );

  // 'create with connect 2 uniques (PK & non-PK)' is non-ported.
  // Upstream (create.ts:62-67) connects via a COMPOUND criterion
  //   user: { connect: { id: userId, referralId: userReferralId } }
  // — two unique keys in a single connect object. prisma-next's connect
  // criterion is a union of per-constraint objects (one unique key at a time);
  // a compound { id, referralId } connect is a type error, so the multi-key
  // connect input cannot be faithfully expressed. Recorded in non-ported.md.

  it(
    'create with connect 1 unique (non-PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const userId = randomBytes(12).toString('hex');
        const userReferralId = randomBytes(12).toString('hex');
        const user = await db.public.User.create({
          id: userId,
          referralId: userReferralId,
          payment: (p) => p.create({ ccn: randomBytes(12).toString('hex') }),
        });

        await db.public.Profile.create({
          alias: `alias_${randomBytes(4).toString('hex')}`,
          email: `${randomBytes(4).toString('hex')}@test.io`,
          user: (u) => u.connect({ referralId: userReferralId }),
        });

        const profile = await db.public.Profile.first({ userId: user.id });
        expect(profile).not.toBeNull();
      }),
    timeouts.spinUpPpgDev,
  );

  // ─── update ──────────────────────────────────────────────────────────────

  it.fails(
    'update with where 1 unique (PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { userId } = await createTestData(db);
        // Faithful port: upstream update({ where: { id }, data: {} }) — empty
        // no-op update still returns the addressed row (update.ts:15-22).
        // prisma-next's update({}) skips the SQL round-trip and returns null,
        // so data?.id is undefined → assertion fails. Recorded in failing.md.
        const data = await db.public.User.where({ id: userId }).update({});
        expect(data?.id).toBe(userId);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'update with where 2 uniques (PK & non-PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { postId1 } = await createTestData(db);
        const data = await db.public.Post.where({ id: postId1 })
          .where({ title: 'Hello World 1' })
          .update({ title: 'Hello World 4' });
        expect(data?.title).toBe('Hello World 4');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'update with where 1 unique (non-PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        await createTestData(db);
        const data = await db.public.Post.where({ title: 'Hello World 2' }).update({
          title: 'Hello World 5',
        });
        expect(data?.title).toBe('Hello World 5');
      }),
    timeouts.spinUpPpgDev,
  );

  // ─── upsert ──────────────────────────────────────────────────────────────

  it(
    'upsert with where 1 unique (PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { userId } = await createTestData(db);
        const newReferralId = randomBytes(12).toString('hex');
        // upsert() does not support nested relation callbacks; pre-look up
        // the existing paymentId so we can provide it in the create path.
        const existingUser = await db.public.User.first({ id: userId });
        const paymentId = existingUser?.paymentId ?? '';
        const data = await db.public.User.where({ id: userId }).upsert({
          create: { id: userId, referralId: newReferralId, paymentId },
          update: { referralId: newReferralId },
          conflictOn: { id: userId },
        });
        expect(data.referralId).toBe(newReferralId);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'upsert with where 2 uniques (PK & non-PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { postId1, userId } = await createTestData(db);
        const data = await db.public.Post.where({ id: postId1 })
          .where({ title: 'Hello World 1' })
          .upsert({
            create: { id: postId1, title: 'Hello World 1', authorId: userId },
            update: { title: 'Hello World 4' },
            conflictOn: { id: postId1 },
          });
        expect(data.title).toBe('Hello World 4');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'upsert with where 1 unique (non-PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { postId2, userId } = await createTestData(db);
        const data = await db.public.Post.upsert({
          create: { id: postId2, title: 'Hello World 2', authorId: userId },
          update: { title: 'Hello World 5' },
          conflictOn: { title: 'Hello World 2' },
        });
        expect(data.title).toBe('Hello World 5');
      }),
    timeouts.spinUpPpgDev,
  );

  // ─── delete ──────────────────────────────────────────────────────────────

  it(
    'delete with where 2 uniques (PK & non-PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { postId1 } = await createTestData(db);
        const deleted = await db.public.Post.where({ id: postId1 })
          .where({ title: 'Hello World 1' })
          .delete();
        expect(deleted).not.toBeNull();
        const row = await db.public.Post.first({ id: postId1 });
        expect(row).toBeNull();
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'delete with where 1 unique (non-PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        await createTestData(db);
        const deleted = await db.public.Post.where({ title: 'Hello World 2' }).delete();
        expect(deleted).not.toBeNull();
        const row = await db.public.Post.first({ title: 'Hello World 2' });
        expect(row).toBeNull();
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'delete with where 1 unique (PK)',
    () =>
      withExtendedWhere(async ({ db }) => {
        const { userId } = await createTestData(db);
        // Faithful port: single PK delete. onDelete: Cascade on Post.author and
        // Profile.user (restored in the fixture) removes the child rows, matching
        // upstream prisma.user.delete({ where: { id } }) (delete.ts:31-37).
        const deleted = await db.public.User.where({ id: userId }).delete();
        expect(deleted).not.toBeNull();
        const row = await db.public.User.first({ id: userId });
        expect(row).toBeNull();
      }),
    timeouts.spinUpPpgDev,
  );
});
