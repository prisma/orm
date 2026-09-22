import { fileURLToPath } from 'node:url';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { ContractSourceContext } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import postgres from '@internal/target-postgres/control';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { dirname, join } from 'pathe';
import { prisma7Contract } from '../src/provider';

export const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** The same composition `prisma contract emit` builds for a Postgres config. */
export function postgresSourceContext(resolvedInputs: readonly string[]): ContractSourceContext {
  const stack = createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [],
  });
  return {
    composedExtensions: stack.extensions.map((extension) => extension.id),
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    dataTypeLookup: stack.dataTypeLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs,
    capabilities: stack.capabilities,
  };
}

/** Loads `fixtures/<caseName>/schema.prisma` through the provider, as `contract emit` does. */
export function loadFixtureSchema(caseName: string) {
  const schemaPath = join(fixturesDir, caseName, 'schema.prisma');
  return prisma7Contract(schemaPath, { binding: prisma7PostgresBinding }).source.load(
    postgresSourceContext([schemaPath]),
  );
}

interface SerializedTable {
  readonly columns: Record<string, Record<string, unknown>>;
  readonly foreignKeys: readonly Record<string, unknown>[];
}

/** One table of the loaded fixture's `contract.json` storage, or a thrown error naming what failed. */
export async function loadFixtureTable(
  caseName: string,
  tableName: string,
  namespaceId = 'public',
): Promise<SerializedTable> {
  const result = await loadFixtureSchema(caseName);
  if (!result.ok) {
    throw new Error(
      `Fixture "${caseName}" did not load: ${JSON.stringify(result.failure.diagnostics)}`,
    );
  }
  const serialized = JSON.parse(
    JSON.stringify(
      new PostgresContractSerializer().serializeContract(result.value as Contract<SqlStorage>),
    ),
  ) as {
    storage: {
      namespaces: Record<string, { entries: { table: Record<string, SerializedTable> } }>;
    };
  };
  const table = serialized.storage.namespaces[namespaceId]?.entries.table[tableName];
  if (table === undefined) throw new Error(`Fixture "${caseName}" has no table "${tableName}"`);
  return table;
}
