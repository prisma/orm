import { describe, expect, it } from 'vitest';
import {
  createReturningUsersCollection,
  createReturningUsersCollectionWithout,
  createUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

async function seedAlice(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query(
    "insert into users (id, name, email) values (1, 'Alice', 'alice@example.com')",
  );
}

const threeRowsOneColliding = [
  { id: 1, name: 'Alice again', email: 'alice2@example.com', invitedById: null },
  { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: null },
  { id: 3, name: 'Carol', email: 'carol@example.com', invitedById: null },
];

describe('integration/create on conflict skip', () => {
  it(
    'createAll() untargeted yields only the rows the database inserted',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedAlice(runtime);

        runtime.resetExecutions();
        const inserted = await users
          .select('id', 'name')
          .createAll(threeRowsOneColliding, { onConflict: 'skip' })
          .toArray();

        expect(inserted).toEqual([
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Carol' },
        ]);
        expect(runtime.executions).toHaveLength(1);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'createAndCount() untargeted returns the number of rows the database inserted',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);
        await seedAlice(runtime);

        runtime.resetExecutions();
        const count = await users.createAndCount(threeRowsOneColliding, { onConflict: 'skip' });

        expect(count).toBe(2);
        expect(runtime.executions).toHaveLength(1);

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(rows).toEqual([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Carol' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'createAll() targeted at a named unique constraint skips only its collisions',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await runtime.query('create unique index users_email_unique on users (email)');
        await seedAlice(runtime);

        runtime.resetExecutions();
        const inserted = await users
          .select('id', 'email')
          .createAll(
            [
              { id: 10, name: 'Alice clone', email: 'alice@example.com', invitedById: null },
              { id: 11, name: 'Bob', email: 'bob@example.com', invitedById: null },
            ],
            { onConflict: 'skip', conflictOn: ['email'] },
          )
          .toArray();

        expect(inserted).toEqual([{ id: 11, email: 'bob@example.com' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a collision on a constraint other than the named one is still an error',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await runtime.query('create unique index users_email_unique on users (email)');
        await seedAlice(runtime);

        await expect(
          users
            .createAll(
              [{ id: 1, name: 'Primary key clash', email: 'other@example.com', invitedById: null }],
              { onConflict: 'skip', conflictOn: ['email'] },
            )
            .toArray(),
        ).rejects.toThrow(/users_pkey/);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'two rows colliding with each other inside one batch keep only the first',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const returningUsers = createReturningUsersCollection(runtime);
        const countingUsers = createUsersCollection(runtime);

        const inserted = await returningUsers
          .select('id', 'name')
          .createAll(
            [
              { id: 30, name: 'First', email: 'first@example.com', invitedById: null },
              { id: 30, name: 'Duplicate of first', email: 'dup@example.com', invitedById: null },
              { id: 31, name: 'Second', email: 'second@example.com', invitedById: null },
            ],
            { onConflict: 'skip' },
          )
          .toArray();

        expect(inserted).toEqual([
          { id: 30, name: 'First' },
          { id: 31, name: 'Second' },
        ]);

        const count = await countingUsers.createAndCount(
          [
            { id: 40, name: 'Third', email: 'third@example.com', invitedById: null },
            { id: 40, name: 'Duplicate of third', email: 'dup2@example.com', invitedById: null },
          ],
          { onConflict: 'skip' },
        );
        expect(count).toBe(1);

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(rows).toEqual([
          { id: 30, name: 'First' },
          { id: 31, name: 'Second' },
          { id: 40, name: 'Third' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a batch where every row collides inserts nothing and raises nothing',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const returningUsers = createReturningUsersCollection(runtime);
        const countingUsers = createUsersCollection(runtime);
        await seedAlice(runtime);

        const inserted = await returningUsers
          .createAll([{ id: 1, name: 'Clone', email: 'clone@example.com', invitedById: null }], {
            onConflict: 'skip',
          })
          .toArray();
        expect(inserted).toEqual([]);

        const count = await countingUsers.createAndCount(
          [{ id: 1, name: 'Clone', email: 'clone@example.com', invitedById: null }],
          { onConflict: 'skip' },
        );
        expect(count).toBe(0);

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(rows).toEqual([{ id: 1, name: 'Alice' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'an empty conflictOn behaves like an untargeted call',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedAlice(runtime);

        const inserted = await users
          .select('id')
          .createAll(
            [
              { id: 1, name: 'Clone', email: 'clone@example.com', invitedById: null },
              { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: null },
            ],
            { onConflict: 'skip', conflictOn: [] },
          )
          .toArray();

        expect(inserted).toEqual([{ id: 2 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a contract that does not report insertOnConflictSkip refuses the option before executing',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollectionWithout(runtime, ['insertOnConflictSkip']);

        runtime.resetExecutions();
        expect(() =>
          users.createAll(threeRowsOneColliding, { onConflict: 'skip', conflictOn: ['email'] }),
        ).toThrow(/insertOnConflictSkip/);
        expect(runtime.executions).toHaveLength(0);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a contract without insertOnConflictWithoutTarget refuses only the untargeted call',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollectionWithout(runtime, [
          'insertOnConflictWithoutTarget',
        ]);
        await runtime.query('create unique index users_email_unique on users (email)');
        await seedAlice(runtime);

        runtime.resetExecutions();
        expect(() => users.createAll(threeRowsOneColliding, { onConflict: 'skip' })).toThrow(
          /insertOnConflictWithoutTarget/,
        );
        expect(runtime.executions).toHaveLength(0);

        const inserted = await users
          .select('id')
          .createAll([{ id: 20, name: 'Dan', email: 'alice@example.com', invitedById: null }], {
            onConflict: 'skip',
            conflictOn: ['email'],
          })
          .toArray();
        expect(inserted).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a conflictOn field that is not a scalar field of the model is refused',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        expect(() =>
          users.createAll(threeRowsOneColliding, {
            onConflict: 'skip',
            conflictOn: ['posts' as never],
          }),
        ).toThrow(/posts/);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'an onConflict value other than skip is refused',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        expect(() =>
          users.createAll(threeRowsOneColliding, { onConflict: 'merge' as never }),
        ).toThrow(/onConflict/);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
