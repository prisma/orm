import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { ContractSourceContext } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { printPsl } from '@internal/psl-printer';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { PG_INT_CODEC_ID, PG_TEXT_CODEC_ID } from '@internal/target-postgres/codec-ids';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { blindCast } from '@internal/utils/casts';
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

/** Prints a contract as Prisma 8 PSL text, the way `contract convert` does. */
export function printContractAsPsl(contract: Contract<SqlStorage>): string {
  const ast = postgres.printPslContract?.(contract);
  if (ast === undefined) {
    throw new Error('the Postgres target descriptor has no printPslContract hook');
  }
  const context = postgresSourceContext([]);
  return printPsl(ast, {
    pslBlockDescriptors: context.authoringContributions.pslBlockDescriptors,
    codecLookup: context.codecLookup,
  });
}

/** Loads printed PSL text back through the Prisma 8 PSL source. */
export async function loadPrintedPsl(text: string): Promise<Contract<SqlStorage>> {
  const directory = mkdtempSync(join(tmpdir(), 'prisma7-convert-'));
  const printedPath = join(directory, 'contract.prisma');
  writeFileSync(printedPath, text);
  const result = await prismaContract(printedPath, {
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
    enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
  }).source.load(postgresSourceContext([printedPath]));
  if (!result.ok) {
    throw new Error(`the printed PSL did not load: ${JSON.stringify(result.failure.diagnostics)}`);
  }
  return blindCast<Contract<SqlStorage>, 'the Postgres PSL source yields a SQL contract'>(
    result.value,
  );
}

/** The storage table of a loaded contract, or a thrown error naming what is missing. */
export function storageTable(
  contract: Contract<SqlStorage>,
  tableName: string,
  namespaceId = 'public',
) {
  const table = contract.storage.namespaces[namespaceId]?.entries.table?.[tableName];
  if (table === undefined) {
    throw new Error(`the contract has no table "${namespaceId}"."${tableName}"`);
  }
  return table;
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
