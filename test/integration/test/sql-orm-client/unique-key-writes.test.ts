import { describe, expect, it } from 'vitest';
import {
  createReturningUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { type PgIntegrationRuntime, seedUsers } from './runtime-helpers';

async function seedAdaAndGrace(runtime: PgIntegrationRuntime): Promise<void> {
  await seedUsers(runtime, [
    { id: 1, name: 'Ada', email: 'ada@example.com' },
    { id: 2, name: 'Grace', email: 'grace@example.com' },
  ]);
  runtime.resetExecutions();
}

function userRows(runtime: PgIntegrationRuntime) {
  return runtime.query<{ id: number; name: string }>('select id, name from users order by id');
}

describe('integration/update() and delete() by a unique key', () => {
  it(
    'where({ id }).update() sends one statement and returns the updated row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedAdaAndGrace(runtime);

        const updated = await users
          .select('id', 'name')
          .where({ id: 1 })
          .update({ name: 'Ada Lovelace' });

        expect({ updated, statements: runtime.executions.length }).toEqual({
          updated: { id: 1, name: 'Ada Lovelace' },
          statements: 1,
        });
        expect(await userRows(runtime)).toEqual([
          { id: 1, name: 'Ada Lovelace' },
          { id: 2, name: 'Grace' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'whereUnique() on a unique column sends one statement for update() and returns the updated row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedAdaAndGrace(runtime);

        const updated = await users
          .select('id', 'name')
          .whereUnique({ email: 'grace@example.com' })
          .update({ name: 'Grace Hopper' });

        expect({ updated, statements: runtime.executions.length }).toEqual({
          updated: { id: 2, name: 'Grace Hopper' },
          statements: 1,
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'where({ id }).delete() sends one statement and returns the deleted row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedAdaAndGrace(runtime);

        const deleted = await users.select('id', 'name').where({ id: 1 }).delete();

        expect({ deleted, statements: runtime.executions.length }).toEqual({
          deleted: { id: 1, name: 'Ada' },
          statements: 1,
        });
        expect(await userRows(runtime)).toEqual([{ id: 2, name: 'Grace' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() and delete() by a condition that pins no key send two statements each',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedAdaAndGrace(runtime);

        const updated = await users
          .select('id', 'name')
          .where({ name: 'Ada' })
          .update({ name: 'Ada Lovelace' });
        const deleted = await users.select('id', 'name').where({ name: 'Grace' }).delete();

        expect({ updated, deleted, statements: runtime.executions.length }).toEqual({
          updated: { id: 1, name: 'Ada Lovelace' },
          deleted: { id: 2, name: 'Grace' },
          statements: 4,
        });
        expect(await userRows(runtime)).toEqual([{ id: 1, name: 'Ada Lovelace' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
