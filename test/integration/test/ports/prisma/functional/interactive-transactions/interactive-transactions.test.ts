import { SqlQueryError, UNIQUE_VIOLATION_SQLSTATE } from '@internal/sql-errors';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/interactive-transactions
// (postgres matrix entry; allProviders — this is the postgres port).
//
// prisma-next SUPPORTS interactive transactions via the high-level facade:
//   `postgres({ contract, url }).transaction(async (tx) => { tx.orm.public.User... })`
// Only the array/batch `$transaction([...])` form is absent.
//
// Nested `$transaction` (tx.$transaction(async tx2 => {...})) has no equivalent
// in prisma-next's facade: the tx context gives `tx.orm`/`tx.sql` but no `.transaction()`.
// Transaction options (timeout, maxWait, isolationLevel) are not supported in the facade.
//
// Dispositions:
//   'issue #19137'                         → PORTED (type assertion + runtime resolve)
//   'basic'                                → PORTED
//   'timeout default'                      → NON-PORTED (no timeout config in facade)
//   'timeout override'                     → NON-PORTED (no timeout config in facade)
//   'timeout override by PrismaClient'     → NON-PORTED (no per-client tx options)
//   'rollback throw'                       → PORTED
//   'rollback throw value'                 → PORTED
//   'postgresql: nested create'            → NON-PORTED (no nested tx in facade)
//   'mongodb: nested transactions …'       → mongo-skip (postgres port)
//   'sql: nested rollback'                 → NON-PORTED (no nested tx in facade)
//   'sql: nested rollback restores …'      → NON-PORTED (no nested tx in facade)
//   'sql: nested commit keeps state …'     → NON-PORTED (no nested tx in facade)
//   'sql: disallow concurrent nested …'   → NON-PORTED (no nested tx in facade)
//   'sql: allow nested transactions …'    → NON-PORTED (no nested tx in facade)
//   'sql: nested commit keeps outer …'    → NON-PORTED (no nested tx in facade)
//   'sql: sequential nested …'            → NON-PORTED (no nested tx in facade)
//   'sql: deep nesting (3 levels) works'  → NON-PORTED (no nested tx in facade)
//   'sql: nested rollback can be caught …' → NON-PORTED (no nested tx in facade)
//   'sql: enforce order for nested …'     → NON-PORTED (no nested tx in facade)
//   'sql: child fails if parent tries …'  → NON-PORTED (no nested tx in facade)
//   'sql: child fails if parent rolls …'  → NON-PORTED (no nested tx in facade)
//   'sql: child fails if nested parent …' → NON-PORTED (no nested tx in facade)
//   'mongodb: disallow nested …'          → mongo-skip (postgres port)
//   'forbidden'                            → NON-PORTED (Prisma-specific API methods)
//   'rollback query'                       → PORTED (unique constraint → rollback)
//   'already committed'                    → NON-PORTED (Prisma-specific error/API shape)
//   'batching'                             → NON-PORTED (array/batch $transaction([...]))
//   'batching rollback'                    → NON-PORTED (array/batch $transaction([...]))
//   'batching rollback within callback'    → PORTED (concurrent creates + violation → rollback)
//   'batching timeout override'            → NON-PORTED (array/batch $transaction([...]))
//   'batching raw rollback'                → NON-PORTED (array/batch + $queryRaw)
//   'concurrent'                           → NON-PORTED (array/batch $transaction([...]))
//   'high concurrency with write conflicts' → PORTED (postgres-only)
//   'high concurrency with no conflicts'  → PORTED
//   'rollback with then calls'             → PORTED
//   'rollback with catch calls'            → PORTED
//   'rollback with finally calls'          → PORTED
//   'high concurrency with SET FOR UPDATE' → NON-PORTED ($queryRaw inside tx)
//   'isolation levels > read committed'    → NON-PORTED (no isolationLevel in facade)
//   'isolation levels > read uncommitted'  → NON-PORTED (no isolationLevel in facade)
//   'isolation levels > repeatable read'   → NON-PORTED (no isolationLevel in facade)
//   'isolation levels > serializable'      → NON-PORTED (no isolationLevel in facade)
//   'isolation levels > invalid value'     → NON-PORTED (no isolationLevel in facade)
//   'attempt to set isolation level on mongo' → mongo-skip (postgres port)

function withInteractiveTx(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson, replaceDatabase: true }, async (ctx) => {
    // Clear users before each test (upstream uses beforeEach deleteMany)
    await ctx.db.public.User.where((u) => u.id.like('%')).deleteAll();
    await fn(ctx);
  });
}

describe('ports/prisma/functional/interactive-transactions', () => {
  // Regression test for https://github.com/prisma/prisma/issues/19137.
  // Upstream: $transaction takes a callback that must return PromiseLike<R>.
  // A non-async (void-returning) callback is a type error. The transaction
  // still resolves after the type-errored callback.
  it(
    'issue #19137',
    () =>
      withInteractiveTx(async ({ transaction }) => {
        expect.assertions(1);

        await transaction(
          // @ts-expect-error: a void-returning callback is not assignable to (tx) => PromiseLike<R>
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          (_tx) => {
            // no return
          },
        ).then(() => expect(true).toBe(true));
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'basic',
    () =>
      withInteractiveTx(async ({ transaction }) => {
        const result = await transaction(async (tx) => {
          await tx.orm.public.User.create({ id: 'u1', email: 'user_1@website.com' });
          await tx.orm.public.User.create({ id: 'u2', email: 'user_2@website.com' });
          return tx.orm.public.User.all();
        });

        expect(result.length).toBe(2);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'rollback throw',
    () =>
      withInteractiveTx(async ({ db, transaction }) => {
        const result = transaction(async (tx) => {
          await tx.orm.public.User.create({ id: 'u1', email: 'user_1@website.com' });
          throw new Error('you better rollback now');
        });

        await expect(result).rejects.toThrow('you better rollback now');

        const users = await db.public.User.all();
        expect(users.length).toBe(0);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'rollback throw value',
    () =>
      withInteractiveTx(async ({ db, transaction }) => {
        const result = transaction(async (tx) => {
          await tx.orm.public.User.create({ id: 'u1', email: 'user_1@website.com' });
          throw 'you better rollback now';
        });

        await expect(result).rejects.toBe('you better rollback now');

        const users = await db.public.User.all();
        expect(users.length).toBe(0);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'rollback query',
    () =>
      withInteractiveTx(async ({ db, transaction }) => {
        const email = 'user_1@website.com';
        const result = transaction(async (tx) => {
          await tx.orm.public.User.create({ id: 'a1b2c3d4e5f6g7h8i9j0k1l2', email });
          // Duplicate email violates the @unique constraint → rollback
          await tx.orm.public.User.create({ id: 'b2c3d4e5f6g7h8i9j0k1l2m3', email });
        });

        await expect(result).rejects.toMatchObject({
          sqlState: UNIQUE_VIOLATION_SQLSTATE,
        });
        expect(SqlQueryError.is(await result.catch((e: unknown) => e))).toBe(true);

        const users = await db.public.User.where((u) => u.email.eq(email)).all();
        expect(users.length).toBe(0);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'batching rollback within callback',
    () =>
      withInteractiveTx(async ({ db, transaction }) => {
        const email1 = 'user_1@website.com';
        const email2 = 'user_2@website.com';
        const result = transaction(async (tx) => {
          // Concurrent creates (parallel ORM writes within the same tx)
          await Promise.all([
            tx.orm.public.User.create({ id: 'a1b2c3d4e5f6g7h8i9j0k1l2', email: email1 }),
            tx.orm.public.User.create({ id: 'b2c3d4e5f6g7h8i9j0k1l2m3', email: email2 }),
          ]);

          // Duplicate email violates @unique → transaction must roll back
          await tx.orm.public.User.create({ id: 'c3d4e5f6g7h8i9j0k1l2m3n4', email: email1 });
        });

        await expect(result).rejects.toMatchObject({ sqlState: UNIQUE_VIOLATION_SQLSTATE });

        const users = await db.public.User.all();
        expect(users.length).toBe(0);
      }),
    timeouts.spinUpPpgDev,
  );

  it('high concurrency with write conflicts', { timeout: 60_000 }, () =>
    withInteractiveTx(async ({ db, transaction }) => {
      await db.public.User.create({
        id: 'x-user-id-000000000000',
        email: 'x',
        name: 'y',
        val: 1,
      });

      for (let i = 0; i < 5; i++) {
        await Promise.allSettled([
          transaction((tx) => tx.orm.public.User.where({ email: 'x' }).update({ name: 'a' })),
          transaction((tx) => tx.orm.public.User.where({ email: 'x' }).update({ name: 'b' })),
          transaction((tx) => tx.orm.public.User.where({ email: 'x' }).update({ name: 'c' })),
          transaction((tx) => tx.orm.public.User.where({ email: 'x' }).update({ name: 'd' })),
          transaction((tx) => tx.orm.public.User.where({ email: 'x' }).update({ name: 'e' })),
          transaction((tx) => tx.orm.public.User.where({ email: 'x' }).update({ name: 'f' })),
          transaction((tx) => tx.orm.public.User.where({ email: 'x' }).update({ name: 'g' })),
          transaction((tx) => tx.orm.public.User.where({ email: 'x' }).update({ name: 'h' })),
          transaction((tx) => tx.orm.public.User.where({ email: 'x' }).update({ name: 'i' })),
          transaction((tx) => tx.orm.public.User.where({ email: 'x' }).update({ name: 'j' })),
        ]).catch(() => {});
      }
      // No assertion — upstream also has no final assertion for this test;
      // it verifies the engine does not deadlock (no crash/hang).
    }),
  );

  it('high concurrency with no conflicts', { timeout: 60_000 }, () =>
    withInteractiveTx(async ({ db, transaction }) => {
      await db.public.User.create({ id: 'x-user-id-000000000000', email: 'x', name: 'y' });

      for (let i = 0; i < 5; i++) {
        await Promise.allSettled([
          transaction((tx) => tx.orm.public.User.all()),
          transaction((tx) => tx.orm.public.User.all()),
          transaction((tx) => tx.orm.public.User.all()),
          transaction((tx) => tx.orm.public.User.all()),
          transaction((tx) => tx.orm.public.User.all()),
          transaction((tx) => tx.orm.public.User.all()),
          transaction((tx) => tx.orm.public.User.all()),
          transaction((tx) => tx.orm.public.User.all()),
          transaction((tx) => tx.orm.public.User.all()),
          transaction((tx) => tx.orm.public.User.all()),
        ]);
      }
      // Upstream: none of these transactions should fail (no assertion).
    }),
  );

  it(
    'rollback with then calls',
    () =>
      withInteractiveTx(async ({ db, transaction }) => {
        const result = transaction(async (tx) => {
          await tx.orm.public.User.create({ id: 'u1', email: 'user_1@website.com' }).then();

          await tx.orm.public.User.create({ id: 'u2', email: 'user_2@website.com' }).then().then();

          throw new Error('rollback');
        });

        await expect(result).rejects.toThrow('rollback');

        const users = await db.public.User.all();
        expect(users.length).toBe(0);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'rollback with catch calls',
    () =>
      withInteractiveTx(async ({ db, transaction }) => {
        const result = transaction(async (tx) => {
          await tx.orm.public.User.create({ id: 'u1', email: 'user_1@website.com' }).catch();
          await tx.orm.public.User.create({ id: 'u2', email: 'user_2@website.com' }).catch().then();

          throw new Error('rollback');
        });

        await expect(result).rejects.toThrow('rollback');

        const users = await db.public.User.all();
        expect(users.length).toBe(0);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'rollback with finally calls',
    () =>
      withInteractiveTx(async ({ db, transaction }) => {
        const result = transaction(async (tx) => {
          await tx.orm.public.User.create({ id: 'u1', email: 'user_1@website.com' }).finally();

          await tx.orm.public.User.create({ id: 'u2', email: 'user_2@website.com' })
            .then()
            .catch()
            .finally();

          throw new Error('rollback');
        });

        await expect(result).rejects.toThrow('rollback');

        const users = await db.public.User.all();
        expect(users.length).toBe(0);
      }),
    timeouts.spinUpPpgDev,
  );
});
