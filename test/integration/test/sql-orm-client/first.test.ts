import { describe, expect, it, vi } from 'vitest';
import { createUsersCollection, timeouts, withCollectionRuntime } from './integration-helpers';
import { seedUsers } from './runtime-helpers';

describe('integration/first', () => {
  it(
    'first() returns first matching row and null when no row matches',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Alice', email: 'alice2@example.com' },
        ]);

        const found = await users.first({ name: 'Alice' });
        const foundByFn = await users.first((user) => user.id.eq(2));
        const missing = await users.first({ id: 999 });

        expect(found).not.toBeNull();
        expect(found?.name).toBe('Alice');
        expect(foundByFn).toEqual({
          id: 2,
          name: 'Alice',
          email: 'alice2@example.com',
          invitedById: null,
          address: null,
        });
        expect(missing).toBeNull();
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'firstOrThrow() returns the first matching row and rejects when no row matches',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime).select('id', 'email');

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Alice', email: 'alice2@example.com' },
        ]);

        expect(await users.orderBy((user) => user.id.desc()).firstOrThrow()).toEqual({
          id: 2,
          email: 'alice2@example.com',
        });
        expect(await users.firstOrThrow({ email: 'alice@example.com' })).toEqual({
          id: 1,
          email: 'alice@example.com',
        });
        expect(await users.firstOrThrow((user) => user.id.eq(2))).toEqual({
          id: 2,
          email: 'alice2@example.com',
        });
        const configure = vi.fn();
        expect(
          await users.orderBy((user) => user.id.asc()).firstOrThrow(undefined, configure),
        ).toEqual({ id: 1, email: 'alice@example.com' });
        expect(await users.firstOrThrow({ id: 2 }, configure)).toEqual({
          id: 2,
          email: 'alice2@example.com',
        });
        expect(configure).toHaveBeenCalledTimes(2);
        await expect(users.firstOrThrow({ id: 999 })).rejects.toMatchObject({
          code: 'RUNTIME.NO_ROWS',
          message: 'Expected at least one row, but none were returned',
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'first() respects existing orderBy() modifiers',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Bob', email: 'bob-1@example.com' },
          { id: 2, name: 'Bob', email: 'bob-2@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);

        const found = await users
          .where({ name: 'Bob' })
          .orderBy((user) => user.id.desc())
          .first();

        expect(found).toEqual({
          id: 2,
          name: 'Bob',
          email: 'bob-2@example.com',
          invitedById: null,
          address: null,
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
