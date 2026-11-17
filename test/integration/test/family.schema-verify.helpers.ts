/**
 * Shared helpers for family.schema-verify tests.
 */
import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql, { type SqlControlFamilyInstance } from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import postgres from '@internal/target-postgres/control';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { beforeAll } from 'vitest';

// Re-export common imports for test files
export { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
export {
  autoincrement,
  defineContract,
  field,
  model,
  now,
  rel,
} from '@internal/postgres/contract-builder';
export type { CodecTypes } from '@internal/target-postgres/codec-types';
export { pgvector } from './family.schema-verify.extensions';
export type { Contract, SqlStorage };
export {
  PostgresContractSerializer,
  postgres,
  postgresAdapter,
  postgresDriver,
  sql,
  timeouts,
  withClient,
};

/**
 * Sets up a shared dev database for schema verification tests.
 * Call this in a beforeAll hook at the top of your describe block.
 *
 * @returns Object with connectionString getter
 */
export function useDevDatabase(): { getConnectionString: () => string } {
  let connectionString: string | undefined;

  beforeAll(async () => {
    const database = await createDevDatabase();
    connectionString = database.connectionString;
    return async () => {
      await database.close();
    };
  }, timeouts.spinUpPpgDev);

  return {
    getConnectionString: () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }
      return connectionString;
    },
  };
}

/**
 * Creates a SQL control-plane family instance for testing.
 */
export function createFamilyInstance(
  extensions: readonly ControlExtensionDescriptor<'sql', 'postgres'>[] = [],
): SqlControlFamilyInstance {
  return sql.create(
    createControlStack({
      family: sql,
      target: postgres,
      adapter: postgresAdapter,
      driver: postgresDriver,
      extensions: extensions,
    }),
  );
}

/**
 * Creates a driver and runs a test callback, ensuring cleanup.
 */
export async function withDriver<T>(
  connectionString: string,
  callback: (driver: Awaited<ReturnType<typeof postgresDriver.create>>) => Promise<T>,
): Promise<T> {
  const driver = await postgresDriver.create(connectionString);
  try {
    return await callback(driver);
  } finally {
    await driver.close();
  }
}

/**
 * Introspects the live schema and verifies it against the contract.
 */
export async function runSchemaVerify(
  connectionString: string,
  contract: unknown,
  options: {
    strict?: boolean;
    extensions?: readonly ControlExtensionDescriptor<'sql', 'postgres'>[];
  } = {},
) {
  return withDriver(connectionString, async (driver) => {
    const familyInstance = createFamilyInstance(options.extensions);
    const validatedContract = new PostgresContractSerializer().deserializeContract(
      contract,
    ) as Contract<SqlStorage>;
    const frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'postgres'>> = [
      postgres,
      postgresAdapter,
      ...(options.extensions ?? []),
    ];
    const schema = await familyInstance.introspect({ driver, contract: validatedContract });
    return familyInstance.verifySchema({
      contract: validatedContract,
      schema,
      strict: options.strict ?? false,
      frameworkComponents,
    });
  });
}
