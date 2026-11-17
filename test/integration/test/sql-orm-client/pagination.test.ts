import { describe, expect, it } from 'vitest';
import { createUsersCollection, timeouts, withCollectionRuntime } from './integration-helpers';
import { seedUsers } from './runtime-helpers';

describe('integration/pagination', () => {
  it(
    'cursor() applies forward and backward boundaries using order direction',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'A', email: 'a@example.com' },
          { id: 2, name: 'B', email: 'b@example.com' },
          { id: 3, name: 'C', email: 'c@example.com' },
          { id: 4, name: 'D', email: 'd@example.com' },
        ]);

        const afterAscendingCursor = await users
          .orderBy((user) => user.id.asc())
          .cursor({ id: 2 })
          .all();
        expect(afterAscendingCursor.map((row) => row.id)).toEqual([3, 4]);

        const afterDescendingCursor = await users
          .orderBy((user) => user.id.desc())
          .cursor({ id: 3 })
          .all();
        expect(afterDescendingCursor.map((row) => row.id)).toEqual([2, 1]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'limit() and offset() apply limit and offset to database results',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'A', email: 'a@example.com' },
          { id: 2, name: 'B', email: 'b@example.com' },
          { id: 3, name: 'C', email: 'c@example.com' },
          { id: 4, name: 'D', email: 'd@example.com' },
        ]);

        const rows = await users
          .orderBy((user) => user.id.asc())
          .offset(1)
          .limit(2)
          .all();

        expect(rows.map((row) => row.id)).toEqual([2, 3]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'distinct() returns unique values for selected fields',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'A', email: 'shared@example.com' },
          { id: 2, name: 'B', email: 'shared@example.com' },
          { id: 3, name: 'C', email: 'unique@example.com' },
        ]);

        const rows = await users
          .select('email')
          .distinct('email')
          .orderBy((user) => user.email.asc())
          .all();

        expect(rows).toEqual([{ email: 'shared@example.com' }, { email: 'unique@example.com' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'distinctOn() keeps one row per key using orderBy precedence',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'A', email: 'a@example.com' },
          { id: 2, name: 'B', email: 'a@example.com' },
          { id: 3, name: 'C', email: 'z@example.com' },
        ]);

        const rows = await users
          .select('id', 'email')
          .orderBy([(user) => user.email.asc(), (user) => user.id.desc()])
          .distinctOn('email')
          .all();

        expect(rows).toEqual([
          { id: 2, email: 'a@example.com' },
          { id: 3, email: 'z@example.com' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
