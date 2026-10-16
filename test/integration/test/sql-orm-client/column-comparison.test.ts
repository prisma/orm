import { describe, expect, it } from 'vitest';
import { createUsersCollection, timeouts, withCollectionRuntime } from './integration-helpers';
import { seedUsers } from './runtime-helpers';

describe('integration/column-comparison', () => {
  it(
    'gt() and lt() accept a nullable column and skip rows where it is null',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 3, name: 'Cara', email: 'cara@example.com' },
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 3 },
          { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 1 },
        ]);

        const afterInviter = await users
          .where((user) => user.id.gt(user.invitedById))
          .select('id')
          .all();
        const beforeInviter = await users
          .where((user) => user.id.lt(user.invitedById))
          .select('id')
          .all();

        expect(afterInviter).toEqual([{ id: 4 }]);
        expect(beforeInviter).toEqual([{ id: 2 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
