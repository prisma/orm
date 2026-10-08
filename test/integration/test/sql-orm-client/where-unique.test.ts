import { Collection } from '@internal/sql-orm-client';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import type { Char } from '@internal/target-postgres/codec-types';
import { describe, expect, it } from 'vitest';
import { withReturningCapability } from './collection-fixtures';
import { getTestContext, getTestContract, type TestContract } from './helpers';
import {
  createReturningPostsCollection,
  createReturningUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import {
  type PgIntegrationRuntime,
  seedPosts,
  seedRoles,
  seedUserRoles,
  seedUsers,
} from './runtime-helpers';

const ROLE_ADMIN = 'role-admin' as Char<36>;
const ROLE_EDITOR = 'role-editor' as Char<36>;

function createReturningUserRolesCollection(runtime: PgIntegrationRuntime) {
  const contract = withReturningCapability(getTestContract());
  const context = { ...getTestContext(), contract } as ExecutionContext<TestContract>;
  return new Collection({ runtime, context }, 'UserRole', { namespaceId: 'public' });
}

async function seedTwoUsers(runtime: PgIntegrationRuntime): Promise<void> {
  await seedUsers(runtime, [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' },
  ]);
}

async function seedUserRoleRows(runtime: PgIntegrationRuntime): Promise<void> {
  await seedTwoUsers(runtime);
  await seedRoles(runtime, [
    { id: ROLE_ADMIN, name: 'Admin' },
    { id: ROLE_EDITOR, name: 'Editor' },
  ]);
  await seedUserRoles(runtime, [
    { userId: 1, roleId: ROLE_ADMIN, level: 10 },
    { userId: 1, roleId: ROLE_EDITOR, level: 20 },
    { userId: 2, roleId: ROLE_ADMIN, level: 30 },
  ]);
}

function readUsers(runtime: PgIntegrationRuntime) {
  return runtime.query<{ id: number; name: string }>('select id, name from users order by id');
}

function readUserRoles(runtime: PgIntegrationRuntime) {
  return runtime.query<{ user_id: number; role_id: string; level: number }>(
    'select user_id, role_id, level from user_roles order by user_id, role_id',
  );
}

describe('integration/whereUnique', () => {
  it(
    'first() returns the row a primary key or a unique constraint names',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime).select('id', 'name', 'email');
        await seedTwoUsers(runtime);

        const byId = await users.whereUnique({ id: 2 }).first();
        const byEmail = await users.whereUnique({ email: 'alice@example.com' }).first();

        expect(byId).toEqual({ id: 2, name: 'Bob', email: 'bob@example.com' });
        expect(byEmail).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
        expect(byId).toEqual(await users.where({ id: 2 }).first());
        expect(byEmail).toEqual(await users.where({ email: 'alice@example.com' }).first());
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() changes and returns only the row the key names',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime).select('id', 'name', 'email');
        await seedTwoUsers(runtime);

        const updated = await users.whereUnique({ id: 2 }).update({ name: 'Robert' });

        expect(updated).toEqual({ id: 2, name: 'Robert', email: 'bob@example.com' });
        expect(await readUsers(runtime)).toEqual([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Robert' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'delete() removes and returns only the row the key names',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime).select('id', 'name', 'email');
        await seedTwoUsers(runtime);

        const deleted = await users.whereUnique({ email: 'bob@example.com' }).delete();

        expect(deleted).toEqual({ id: 2, name: 'Bob', email: 'bob@example.com' });
        expect(await readUsers(runtime)).toEqual([{ id: 1, name: 'Alice' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'first() returns the row a compound key names',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const userRoles = createReturningUserRolesCollection(runtime).select(
          'userId',
          'roleId',
          'level',
        );
        await seedUserRoleRows(runtime);

        const found = await userRoles.whereUnique({ userId: 1, roleId: ROLE_EDITOR }).first();

        expect(found).toEqual({ userId: 1, roleId: ROLE_EDITOR, level: 20 });
        expect(found).toEqual(await userRoles.where({ userId: 1, roleId: ROLE_EDITOR }).first());
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() changes and returns only the row a compound key names',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const userRoles = createReturningUserRolesCollection(runtime).select(
          'userId',
          'roleId',
          'level',
        );
        await seedUserRoleRows(runtime);

        const updated = await userRoles
          .whereUnique({ userId: 1, roleId: ROLE_ADMIN })
          .update({ level: 99 });

        expect(updated).toEqual({ userId: 1, roleId: ROLE_ADMIN, level: 99 });
        expect(await readUserRoles(runtime)).toEqual([
          { user_id: 1, role_id: ROLE_ADMIN, level: 99 },
          { user_id: 1, role_id: ROLE_EDITOR, level: 20 },
          { user_id: 2, role_id: ROLE_ADMIN, level: 30 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'delete() removes and returns only the row a compound key names',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const userRoles = createReturningUserRolesCollection(runtime).select(
          'userId',
          'roleId',
          'level',
        );
        await seedUserRoleRows(runtime);

        const deleted = await userRoles.whereUnique({ userId: 2, roleId: ROLE_ADMIN }).delete();

        expect(deleted).toEqual({ userId: 2, roleId: ROLE_ADMIN, level: 30 });
        expect(await readUserRoles(runtime)).toEqual([
          { user_id: 1, role_id: ROLE_ADMIN, level: 10 },
          { user_id: 1, role_id: ROLE_EDITOR, level: 20 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a following where() that excludes the row gives null and writes nothing',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime).select('id', 'name', 'email');
        await seedTwoUsers(runtime);
        const excluded = users.whereUnique({ id: 1 }).where({ name: 'Bob' });

        expect(await excluded.first()).toBeNull();
        expect(await excluded.update({ name: 'Changed' })).toBeNull();
        expect(await excluded.delete()).toBeNull();
        expect(await readUsers(runtime)).toEqual([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a following where() that keeps the row returns it',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime).select('id', 'name', 'email');
        await seedTwoUsers(runtime);

        const found = await users.whereUnique({ id: 1 }).where({ name: 'Alice' }).first();

        expect(found).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'first() with include() returns the row with its relation',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createReturningPostsCollection(runtime);
        await seedTwoUsers(runtime);
        await seedPosts(runtime, [
          { id: 10, title: 'First', userId: 1, views: 5 },
          { id: 11, title: 'Second', userId: 2, views: 7 },
        ]);

        const found = await posts
          .whereUnique({ id: 11 })
          .select('id', 'title')
          .include('author', (author) => author.select('id', 'name'))
          .first();

        expect(found).toEqual({ id: 11, title: 'Second', author: { id: 2, name: 'Bob' } });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'first() with include() of a to-many relation returns the row with its related rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedTwoUsers(runtime);
        await seedPosts(runtime, [
          { id: 10, title: 'First', userId: 1, views: 5 },
          { id: 11, title: 'Second', userId: 1, views: 7 },
          { id: 12, title: 'Third', userId: 2, views: 9 },
        ]);

        const found = await users
          .whereUnique({ email: 'alice@example.com' })
          .select('id', 'name')
          .include('posts', (posts) => posts.select('id', 'title').orderBy((p) => p.id.asc()))
          .first();

        expect(found).toEqual({
          id: 1,
          name: 'Alice',
          posts: [
            { id: 10, title: 'First' },
            { id: 11, title: 'Second' },
          ],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a key that matches no row gives null and writes nothing',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime).select('id', 'name', 'email');
        const userRoles = createReturningUserRolesCollection(runtime).select(
          'userId',
          'roleId',
          'level',
        );
        await seedUserRoleRows(runtime);
        const missingUser = users.whereUnique({ id: 999 });
        const missingUserRole = userRoles.whereUnique({ userId: 2, roleId: ROLE_EDITOR });

        expect(await missingUser.first()).toBeNull();
        expect(await missingUser.update({ name: 'Changed' })).toBeNull();
        expect(await missingUser.delete()).toBeNull();
        expect(await missingUserRole.first()).toBeNull();
        expect(await missingUserRole.update({ level: 1 })).toBeNull();
        expect(await missingUserRole.delete()).toBeNull();
        expect(await readUsers(runtime)).toEqual([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ]);
        expect(await readUserRoles(runtime)).toEqual([
          { user_id: 1, role_id: ROLE_ADMIN, level: 10 },
          { user_id: 1, role_id: ROLE_EDITOR, level: 20 },
          { user_id: 2, role_id: ROLE_ADMIN, level: 30 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
