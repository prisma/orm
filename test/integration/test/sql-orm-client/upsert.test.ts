import { Collection } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { withReturningCapability } from './collection-fixtures';
import { deserializeTestContract, getTestContext, getTestContract } from './helpers';
import {
  createReturningTagsCollection,
  createReturningUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedUsers } from './runtime-helpers';

describe('integration/upsert', () => {
  it(
    'upsert() uses primary key conflict fallback and returns updated row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);

        const upserted = await users.upsert({
          create: { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
          update: { name: 'Alice Updated' },
        });

        expect(upserted).toEqual({
          id: 1,
          name: 'Alice Updated',
          email: 'alice@example.com',
          invitedById: null,
          address: null,
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsert() supports explicit non-primary-key conflict criteria',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await runtime.query('create unique index users_email_key on users (email)');
        await seedUsers(runtime, [{ id: 2, name: 'Bob', email: 'bob@example.com' }]);

        const upserted = await users.upsert({
          create: { id: 3, name: 'Bob Create', email: 'bob@example.com', invitedById: null },
          update: { name: 'Bob Updated' },
          conflictOn: { email: 'bob@example.com' },
        });

        expect(upserted).toEqual({
          id: 2,
          name: 'Bob Updated',
          email: 'bob@example.com',
          invitedById: null,
          address: null,
        });
        expect(await users.first({ email: 'bob@example.com' })).toEqual({
          id: 2,
          name: 'Bob Updated',
          email: 'bob@example.com',
          invitedById: null,
          address: null,
        });
        expect(await users.first({ id: 3 })).toBeNull();
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsert() rejects when no conflict columns can be resolved',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const raw = JSON.parse(
          JSON.stringify(withReturningCapability(getTestContract())),
        ) as Record<string, unknown>;
        const usersTable = (
          raw['storage'] as {
            namespaces: { public: { entries: { table: { users: Record<string, unknown> } } } };
          }
        ).namespaces.public.entries.table.users;
        delete usersTable['primaryKey'];
        const contract = deserializeTestContract(raw);
        const context = { ...getTestContext(), contract };
        const users = new Collection({ runtime, context }, 'User', { namespaceId: 'public' });

        await expect(
          users.upsert({
            create: { id: 4, name: 'NoPK', email: 'nopk@example.com', invitedById: null },
            update: { name: 'NoPK Updated' },
          }),
        ).rejects.toThrow(/requires conflict columns/);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsert() generates execution defaults for the create branch',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const tags = createReturningTagsCollection(runtime);

        const created = await tags.upsert({
          create: { name: 'typescript' },
          update: { name: 'typescript' },
          conflictOn: { name: 'typescript' },
        });

        expect(created.id).toEqual(expect.any(String));
        expect(created.id.length).toBeGreaterThan(0);
        expect(created.name).toBe('typescript');

        const updated = await tags.upsert({
          create: { name: 'typescript' },
          update: { name: 'typescript-updated' },
          conflictOn: { name: 'typescript' },
        });

        expect(updated.id).toBe(created.id);
        expect(updated.name).toBe('typescript-updated');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsert() with an empty update creates a missing row and returns an existing row unchanged',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime).select('id', 'name', 'email');
        const alice = { id: 1, name: 'Alice', email: 'alice@example.com' };

        const inserted = await users.upsert({
          create: { ...alice, invitedById: null },
          update: {},
        });

        expect(inserted).toEqual(alice);

        const existing = await users.upsert({
          create: { id: 1, name: 'Ignored', email: 'ignored@example.com', invitedById: null },
          update: {},
        });

        expect(existing).toEqual(alice);
        expect(await users.all()).toEqual([alice]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
