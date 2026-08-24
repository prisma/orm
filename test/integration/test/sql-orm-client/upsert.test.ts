import { Collection } from '@internal/sql-orm-client';
import type { InsertAst } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { withReturningCapability } from './collection-fixtures';
import { deserializeTestContract, getTestContext, getTestContract } from './helpers';
import {
  createReturningTagsCollection,
  createReturningUsersCollection,
  createUsersCollectionWithoutReturning,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedUsers } from './runtime-helpers';

function isInsertAst(ast: unknown): ast is InsertAst {
  return typeof ast === 'object' && ast !== null && 'kind' in ast && ast.kind === 'insert';
}

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
    'upsert() rejects when returning capability is disabled',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollectionWithoutReturning(runtime);

        await expect(
          users.upsert({
            create: { id: 3, name: 'NoReturn', email: 'noreturn@example.com', invitedById: null },
            update: { name: 'NoReturn Updated' },
          }),
        ).rejects.toThrow(/requires contract capability "returning"/);
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
    'upsert() with empty update behaves as conditional create',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        runtime.resetExecutions();
        const inserted = await users.upsert({
          create: { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
          update: {},
        });

        expect(inserted).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          invitedById: null,
          address: null,
        });
        const insertPlanAst = runtime.executions[0]?.ast;
        expect(isInsertAst(insertPlanAst)).toBe(true);
        if (!isInsertAst(insertPlanAst)) {
          throw new Error('Expected first empty-update upsert execution to emit an insert AST');
        }
        expect(insertPlanAst.onConflict?.action?.kind).toBe('do-nothing');

        runtime.resetExecutions();
        const existing = await users.upsert({
          create: { id: 1, name: 'Ignored', email: 'ignored@example.com', invitedById: null },
          update: {},
        });

        expect(existing).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          invitedById: null,
          address: null,
        });
        const conflictPlanAst = runtime.executions[0]?.ast;
        expect(isInsertAst(conflictPlanAst)).toBe(true);
        if (!isInsertAst(conflictPlanAst)) {
          throw new Error('Expected second empty-update upsert execution to emit an insert AST');
        }
        expect(conflictPlanAst.onConflict?.action?.kind).toBe('do-nothing');

        expect(await users.first({ id: 1 })).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          invitedById: null,
          address: null,
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsertAll() inserts and updates in one statement, overwriting every non-conflict column',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);

        runtime.resetExecutions();
        const upserted = await users.select('id', 'name', 'email', 'invitedById').upsertAll([
          { id: 1, name: 'Alice Updated', email: 'alice+new@example.com', invitedById: null },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: null },
        ]);

        expect(upserted).toEqual([
          { id: 1, name: 'Alice Updated', email: 'alice+new@example.com', invitedById: null },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: null },
        ]);
        expect(runtime.executions).toHaveLength(1);

        const ast = runtime.executions[0]?.ast;
        expect(isInsertAst(ast)).toBe(true);
        if (!isInsertAst(ast)) {
          throw new Error('Expected upsertAll to emit an insert AST');
        }
        expect(ast.onConflict?.action?.kind).toBe('do-update-set');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsertAll() restricts the conflict update to the requested fields',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);

        const upserted = await users
          .select('id', 'name', 'email')
          .upsertAll(
            [{ id: 1, name: 'Alice Renamed', email: 'ignored@example.com', invitedById: null }],
            { update: ['name'] },
          );

        expect(upserted).toEqual([{ id: 1, name: 'Alice Renamed', email: 'alice@example.com' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsertAll() with an empty update list leaves conflicting rows untouched and omits them',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);

        runtime.resetExecutions();
        const upserted = await users.select('id', 'name', 'email').upsertAll(
          [
            { id: 1, name: 'Ignored', email: 'ignored@example.com', invitedById: null },
            { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: null },
          ],
          { update: [] },
        );

        expect(upserted).toEqual([{ id: 2, name: 'Bob', email: 'bob@example.com' }]);

        const ast = runtime.executions[0]?.ast;
        expect(isInsertAst(ast)).toBe(true);
        if (!isInsertAst(ast)) {
          throw new Error('Expected upsertAll to emit an insert AST');
        }
        expect(ast.onConflict?.action?.kind).toBe('do-nothing');

        expect(await users.select('id', 'name', 'email').first({ id: 1 })).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsertAll() resolves an explicit non-primary-key conflict target',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await runtime.query('create unique index users_email_key on users (email)');
        await seedUsers(runtime, [{ id: 2, name: 'Bob', email: 'bob@example.com' }]);

        const upserted = await users.select('id', 'name', 'email').upsertAll(
          [
            { id: 3, name: 'Bob Updated', email: 'bob@example.com', invitedById: null },
            { id: 4, name: 'Cara', email: 'cara@example.com', invitedById: null },
          ],
          { conflictOn: ['email'], update: ['name'] },
        );

        expect(upserted).toEqual([
          { id: 2, name: 'Bob Updated', email: 'bob@example.com' },
          { id: 4, name: 'Cara', email: 'cara@example.com' },
        ]);
        expect(await users.first({ id: 3 })).toBeNull();
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsertAll() holds the primary key back from the default update set',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await runtime.query('create unique index users_email_key on users (email)');
        await seedUsers(runtime, [{ id: 2, name: 'Bob', email: 'bob@example.com' }]);

        const upserted = await users
          .select('id', 'name', 'email')
          .upsertAll(
            [{ id: 99, name: 'Bob Updated', email: 'bob@example.com', invitedById: null }],
            {
              conflictOn: ['email'],
            },
          );

        // `name` is refreshed, but the row keeps its identity — an `id`
        // carried only to satisfy the insert branch must not reassign it.
        expect(upserted).toEqual([{ id: 2, name: 'Bob Updated', email: 'bob@example.com' }]);
        expect(await users.first({ id: 99 })).toBeNull();
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsertAll() returns an empty result without touching the database for empty input',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        runtime.resetExecutions();
        expect(await users.upsertAll([])).toEqual([]);
        expect(runtime.executions).toHaveLength(0);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsertAll() rejects when returning capability is disabled',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollectionWithoutReturning(runtime);

        expect(() =>
          users.upsertAll([
            { id: 5, name: 'NoReturn', email: 'noreturn@example.com', invitedById: null },
          ]),
        ).toThrow(/requires contract capability "returning"/);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
