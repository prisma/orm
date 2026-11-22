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
import {
  applyContract,
  createWorkDir,
  emitContract,
  openPostgresClient,
  openSqliteClient,
  resetPostgres,
  type SqlContract,
  type TargetName,
} from '../helpers/databases';
import { type PostgresServer, startPostgresServer } from '../helpers/postgres-server';
import { pslForConfiguration, pslHeader } from '../helpers/printed-psl';
import { timeouts } from '../timeouts';

type Client = ReturnType<typeof openSqliteClient> | ReturnType<typeof openPostgresClient>;

export interface ConformanceRun {
  /** How many times the suites asked for a new database. */
  readonly migrations: () => number;
}

/**
 * Runs Better Auth's seven published adapter suites against the adapter on one database. Each change of Better Auth's configuration gets a database built from the PSL the adapter prints for it.
 */
export async function runConformanceSuites(target: TargetName): Promise<ConformanceRun> {
  const workDir = await createWorkDir();
  const server: PostgresServer | undefined =
    target === 'postgres' ? await startPostgresServer() : undefined;
  const emptyContract: SqlContract = (await emitContract(target, pslHeader, workDir)).contract;
  let client: Client | undefined;
  let migrations = 0;

  const runMigrations = async (betterAuthOptions: BetterAuthOptions) => {
    migrations += 1;
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
  return { migrations: () => migrations };
}
