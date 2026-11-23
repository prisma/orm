import { describe, expect, it } from 'vitest';
import {
  createReturningUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedUsers } from './runtime-helpers';

describe('integration/nested-foreign-key-with-callback', () => {
  it(
    'update() refuses data that sets the foreign key of a relation it also has a callback on, before any statement runs',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
          { id: 3, name: 'Carol', email: 'carol@example.com' },
        ]);
        const bob = users.where({ id: 2 });
        const refused = expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          meta: {
            relation: 'invitedBy',
            problem: 'foreign-key-with-relation-mutation',
            fields: ['invitedById'],
          },
        });

        runtime.resetExecutions();
        await expect(
          bob.update({ invitedById: 3, invitedBy: (inviter) => inviter.connect({ id: 1 }) }),
        ).rejects.toThrow(refused);
        await expect(
          bob.update({ invitedById: 3, invitedBy: (inviter) => inviter.delete() }),
        ).rejects.toThrow(refused);

        expect(runtime.executions).toEqual([]);
        expect(
          await runtime.query('select id, name, invited_by_id from users order by id'),
        ).toEqual([
          { id: 1, name: 'Alice', invited_by_id: null },
          { id: 2, name: 'Bob', invited_by_id: 1 },
          { id: 3, name: 'Carol', invited_by_id: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
