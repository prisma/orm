import postgresAdapter from '@internal/adapter-postgres/runtime';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/without-conflict-target/generated/contract';
import contractJson from './fixtures/without-conflict-target/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

/**
 * A contract whose required capabilities leave out `sql.insertOnConflictTarget`. The runtime keeps the contract's capabilities as listed, so conflict clauses that name columns are unavailable and a conflict clause that names none still works.
 */
const contract = new PostgresContractSerializer().deserializeContract<Contract>(contractJson);
const context = createExecutionContext<Contract>({
  contract,
  stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
});

function createUsers(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context }, 'User', { namespaceId: 'public' });
}

function missingConflictTarget(action: string) {
  return expect.objectContaining({
    code: 'ORM.CAPABILITY_MISSING',
    meta: { capability: 'insertOnConflictTarget', action },
  });
}

describe('integration/contract that does not require insertOnConflictTarget', () => {
  it(
    'refuses conflict clauses on named columns and skips conflicts on any key',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsers(runtime);
        await runtime.query('create unique index users_email_unique on users (email)');
        await runtime.query(
          "insert into users (id, name, email) values (1, 'Alice', 'alice@example.com')",
        );

        await expect(async () =>
          users.select('id', 'name').upsert({
            create: { id: 2, name: 'Alice', email: 'alice@example.com', invitedById: null },
            update: { name: 'Alice Updated' },
            conflictOn: { email: 'alice@example.com' },
          }),
        ).rejects.toThrow(missingConflictTarget('upsert()'));

        await expect(async () =>
          users
            .select('id')
            .createAll([{ id: 3, name: 'Clone', email: 'alice@example.com', invitedById: null }], {
              onConflict: 'skip',
              conflictOn: ['email'],
            })
            .toArray(),
        ).rejects.toThrow(missingConflictTarget('createAll()'));

        expect({
          atRuntime: Object.hasOwn(context.contract.capabilities.sql, 'insertOnConflictTarget'),
          skipped: await users
            .select('id')
            .createAll(
              [
                { id: 3, name: 'Clone', email: 'alice@example.com', invitedById: null },
                { id: 4, name: 'Bob', email: 'bob@example.com', invitedById: null },
              ],
              { onConflict: 'skip' },
            )
            .toArray(),
          rows: await runtime.query<{ id: number; name: string }>(
            'select id, name from users order by id',
          ),
        }).toEqual({
          atRuntime: false,
          skipped: [{ id: 4 }],
          rows: [
            { id: 1, name: 'Alice' },
            { id: 4, name: 'Bob' },
          ],
        });
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );
});
