import postgresAdapter from '@internal/adapter-postgres/runtime';
import pgvectorRuntime from '@internal/extension-pgvector/runtime';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { getTestContract, withCapabilities } from './helpers';
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

/**
 * A contract emitted before the adapters reported `sql.insertOnConflictTarget` lacks the key. The execution context adds the adapter's capabilities to the contract, so through the standard stack such a contract upserts and skips conflicts on named columns as before.
 */
function usersOnContractWithoutConflictTarget(runtime: PgIntegrationRuntime) {
  const emitted = getTestContract();
  const { insertOnConflictTarget: _target, ...sql } = emitted.capabilities.sql;
  const context = createExecutionContext({
    contract: withCapabilities(emitted, { ...emitted.capabilities, sql }),
    stack: createSqlExecutionStack({
      target: postgresTarget,
      adapter: postgresAdapter,
      extensions: [pgvectorRuntime],
    }),
  });
  return {
    contractCapability: 'insertOnConflictTarget' in sql,
    runtimeCapability: context.contract.capabilities['sql']?.['insertOnConflictTarget'],
    users: new Collection({ runtime, context }, 'User', { namespaceId: 'public' }),
  };
}

describe('integration/contract emitted before insertOnConflictTarget', () => {
  it(
    'upserts and skips conflicts on named columns, because the runtime adds the adapter capability',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const { contractCapability, runtimeCapability, users } =
          usersOnContractWithoutConflictTarget(runtime);
        await runtime.query('create unique index users_email_unique on users (email)');

        expect({
          contractCapability,
          runtimeCapability,
          upserted: await users.select('id', 'name').upsert({
            create: { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
            update: { name: 'Alice Updated' },
            conflictOn: { email: 'alice@example.com' },
          }),
          updated: await users.select('id', 'name').upsert({
            create: { id: 2, name: 'Alice', email: 'alice@example.com', invitedById: null },
            update: { name: 'Alice Updated' },
            conflictOn: { email: 'alice@example.com' },
          }),
          skipped: await users
            .select('id')
            .createAll(
              [
                { id: 3, name: 'Clone', email: 'alice@example.com', invitedById: null },
                { id: 4, name: 'Bob', email: 'bob@example.com', invitedById: null },
              ],
              { onConflict: 'skip', conflictOn: ['email'] },
            )
            .toArray(),
        }).toEqual({
          contractCapability: false,
          runtimeCapability: true,
          upserted: { id: 1, name: 'Alice' },
          updated: { id: 1, name: 'Alice Updated' },
          skipped: [{ id: 4 }],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
