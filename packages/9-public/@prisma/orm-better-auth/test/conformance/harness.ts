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
import { createAdapterDatabases, type TestClient } from '../helpers/adapter-databases';
import type { TargetName } from '../helpers/databases';
import { pslForConfiguration } from '../helpers/printed-psl';
import { timeouts } from '../timeouts';

/**
 * Runs Better Auth's seven published adapter suites against the adapter on one database. Each change of Better Auth's configuration gets a database built from the PSL the adapter prints for it.
 */
export async function runConformanceSuites(target: TargetName): Promise<void> {
  const databases = await createAdapterDatabases();
  const emptyContract = databases.emptyContract(target);
  let client: TestClient | undefined;

  const runMigrations = async (betterAuthOptions: BetterAuthOptions) => {
    client = await databases.open(target, pslForConfiguration(emptyContract, betterAuthOptions));
  };

  afterAll(() => databases.dispose(), timeouts.devServerClose + timeouts.hook);

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
