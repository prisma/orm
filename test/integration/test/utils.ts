import postgresAdapter from '@internal/adapter-postgres/runtime';
import type { Contract } from '@internal/contract/types';
import type {
  PostgresBinding,
  PostgresDriverCreateOptions,
} from '@internal/driver-postgres/runtime';
import postgresDriver from '@internal/driver-postgres/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { PostgresRuntimeImpl } from '@internal/postgres/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type {
  Log,
  Runtime,
  SqlMiddleware,
  SqlRuntimeExtensionDescriptor,
  VerifyMarkerOption,
} from '@internal/sql-runtime';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import { setupTestDatabase as setupTestDatabaseBase } from '@internal/sql-runtime/test/utils';
import postgresTarget from '@internal/target-postgres/runtime';
import type { Client } from 'pg';
import { bootstrapPostgresSignMarkerTables } from './postgres-bootstrap';

export interface CreateTestRuntimeOptions {
  readonly verifyMarker?: VerifyMarkerOption;
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<'postgres'>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly mode?: 'strict' | 'permissive';
  readonly log?: Log;
}

interface IntegrationDriverOptions {
  readonly binding: PostgresBinding;
  readonly cursor?: PostgresDriverCreateOptions['cursor'];
}

/**
 * Creates a runtime with standard test configuration using runtime descriptors.
 * This helper DRYs up the common pattern of runtime creation in tests.
 */
export async function createTestRuntime(
  contract: Contract<SqlStorage>,
  driverOptions: IntegrationDriverOptions,
  options?: CreateTestRuntimeOptions,
): Promise<Runtime> {
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver:
      driverOptions.cursor === undefined
        ? postgresDriver
        : {
            ...postgresDriver,
            create() {
              return postgresDriver.create({ cursor: driverOptions.cursor });
            },
          },
    extensions: options?.extensions ?? [],
  });

  const stackInstance = instantiateExecutionStack(stack);

  const context = createExecutionContext({
    contract,
    stack,
  });

  const driver = stackInstance.driver;
  if (!driver) {
    throw new Error('Driver missing from execution stack instance');
  }
  const binding = driverOptions.binding;
  try {
    await driver.connect(binding);
  } catch (error) {
    if (binding.kind === 'pgPool') {
      await binding.pool.end();
    }
    throw error;
  }

  return new PostgresRuntimeImpl({
    closeRefusal: undefined,
    context,
    adapter: stackInstance.adapter,
    driver,
    ...(options?.verifyMarker !== undefined ? { verifyMarker: options.verifyMarker } : {}),
    ...(options?.middleware ? { middleware: options.middleware } : {}),
    ...(options?.mode ? { mode: options.mode } : {}),
    ...(options?.log ? { log: options.log } : {}),
  });
}

/**
 * Creates a runtime with the given contract and database client using runtime descriptors.
 * This helper DRYs up the common pattern of runtime creation in e2e tests.
 */
export async function createTestRuntimeFromClient(
  contract: Contract<SqlStorage>,
  client: Client,
  options?: CreateTestRuntimeOptions,
): Promise<Runtime> {
  return createTestRuntime(
    contract,
    {
      binding: { kind: 'pgClient', client },
      cursor: { disabled: true },
    },
    options,
  );
}

/**
 * Sets up database schema and data, then writes the contract marker.
 * This helper DRYs up the common pattern of database setup in e2e tests.
 */
export async function setupE2EDatabase(
  client: Client,
  contract: Contract<SqlStorage>,
  setupFn: (client: Client) => Promise<void>,
): Promise<void> {
  await setupTestDatabase(client, contract, setupFn);
}

export async function setupTestDatabase(
  client: Client,
  contract: Contract<SqlStorage>,
  setupFn: (client: Client) => Promise<void>,
): Promise<void> {
  await setupTestDatabaseBase(client, contract, setupFn, bootstrapPostgresSignMarkerTables);
}

export { bootstrapPostgresSignMarkerTables } from './postgres-bootstrap';
