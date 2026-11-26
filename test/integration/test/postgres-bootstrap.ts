import postgresAdapterDescriptor from '@internal/adapter-postgres/control';
import postgresDriverDescriptor, {
  type PostgresControlDriver,
} from '@internal/driver-postgres/control';
import sqlFamilyDescriptor from '@internal/family-sql/control';
import { createControlStack, PRISMA_TABLES_SPACE_ID } from '@internal/framework-components/control';
import { applyInstalledContractSpace } from '@internal/migration-tools/spaces';
import type { SqlExecuteRequest } from '@internal/sql-relational-core/ast';
import postgresTargetDescriptor from '@internal/target-postgres/control';
import type { Client } from 'pg';

const familyInstance = sqlFamilyDescriptor.create(
  createControlStack({
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: postgresAdapterDescriptor,
    driver: postgresDriverDescriptor,
    extensions: [],
  }),
);

export async function executeLoweredStatement(
  client: Client,
  statement: SqlExecuteRequest,
): Promise<void> {
  if (statement.params && statement.params.length > 0) {
    await client.query(statement.sql, [...statement.params]);
    return;
  }
  await client.query(statement.sql);
}

function clientDriver(client: Client): PostgresControlDriver {
  return {
    familyId: 'sql',
    targetId: 'postgres',
    query: async (sql: string, params?: readonly unknown[]) =>
      client.query(sql, params === undefined ? undefined : [...params]),
    close: async () => {},
  } as unknown as PostgresControlDriver;
}

/** Creates Prisma's own tables as the commands do: by applying the Postgres target's `_prisma` contract space. */
export async function bootstrapPostgresSignMarkerTables(client: Client): Promise<void> {
  const contractSpace = postgresTargetDescriptor.contractSpace;
  if (contractSpace === undefined) {
    throw new Error('the Postgres target descriptor carries no contract space');
  }
  const result = await applyInstalledContractSpace({
    spaceId: PRISMA_TABLES_SPACE_ID,
    contractSpace,
    driver: clientDriver(client),
    familyInstance,
    migrations: postgresTargetDescriptor.migrations,
    frameworkComponents: [postgresTargetDescriptor, postgresAdapterDescriptor],
  });
  if (!result.ok) {
    throw new Error(`${result.failure.code}: ${result.failure.message}`);
  }
}
