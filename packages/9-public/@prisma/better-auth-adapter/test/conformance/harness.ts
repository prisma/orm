import type { BetterAuthOptions } from '@better-auth/core';
import {
  authFlowTestSuite,
  caseInsensitiveTestSuite,
  joinsTestSuite,
  normalTestSuite,
  numberIdTestSuite,
  testAdapter,
  transactionsTestSuite,
  uuidTestSuite,
} from '@better-auth/test-utils/adapter';
import { afterAll } from 'vitest';
import { prismaAdapter } from '../../src/adapter';
import { createContractFixture } from '../helpers/contract-fixture';
import {
  applyContract,
  emitContract,
  openPostgresClient,
  openSqliteClient,
  resetPostgres,
  type TargetName,
} from '../helpers/databases';
import { type PostgresServer, startPostgresServer } from '../helpers/postgres-server';
import { pslForConfiguration } from '../helpers/printed-psl';
import { timeouts } from '../timeouts';

type Client = ReturnType<typeof openSqliteClient> | ReturnType<typeof openPostgresClient>;

/**
 * Runs Better Auth's seven published adapter suites against the adapter on one database. Each change of Better Auth's configuration gets a database built from the PSL the adapter prints for it.
 */
export async function runConformanceSuites(target: TargetName): Promise<void> {
  const contracts = await createContractFixture();
  const workDir = contracts.workDir;
  const server: PostgresServer | undefined =
    target === 'postgres' ? await startPostgresServer() : undefined;
  const emptyContract = contracts.emptyContract(target);
  let client: Client | undefined;

  const runMigrations = async (betterAuthOptions: BetterAuthOptions) => {
    const emitted = await emitContract(
      target,
      pslForConfiguration(emptyContract, betterAuthOptions),
      workDir,
    );
    await client?.close();
    client = undefined;
    if (server === undefined) {
      const path = `${workDir.nextPath('database')}.sqlite`;
      await applyContract(target, emitted.json, path, workDir);
      client = openSqliteClient(emitted.json, path);
    } else {
      await resetPostgres(server.url);
      await applyContract(target, emitted.json, server.url, workDir);
      client = openPostgresClient(emitted.json, server.url);
    }
  };

  afterAll(async () => {
    await client?.close();
    await server?.close();
    await workDir.remove();
  }, timeouts.devServerClose + timeouts.hook);

  await runMigrations({});

  const { execute } = await testAdapter({
    adapter: () => {
      if (client === undefined) throw new Error('No database yet');
      return prismaAdapter(client, {
        transaction: true,
        debugLogs: { isRunningAdapterTests: true },
      });
    },
    runMigrations,
    tests: [
      normalTestSuite(),
      transactionsTestSuite(),
      authFlowTestSuite(),
      numberIdTestSuite(),
      joinsTestSuite(),
      uuidTestSuite(),
      caseInsensitiveTestSuite(),
    ],
  });
  execute();
}
