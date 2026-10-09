import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { ContractSourceContext } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlStorage } from '@internal/sql-contract/types';
import postgres from '@internal/target-postgres/control';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { dirname, join } from 'pathe';
import { interpretPrisma7Documents } from '../src/interpreter';
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
    dataTypes: stack.dataTypes,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs,
    capabilities: stack.capabilities,
  };
}

/** The Postgres composition with one default function unregistered. */
export function postgresSourceContextWithout(
  functionName: string,
): (resolvedInputs: readonly string[]) => ContractSourceContext {
  return (resolvedInputs) => {
    const context = postgresSourceContext(resolvedInputs);
    const defaultFunctionRegistry = new Map(
      context.controlMutationDefaults.defaultFunctionRegistry,
    );
    defaultFunctionRegistry.delete(functionName);
    return {
      ...context,
      controlMutationDefaults: { ...context.controlMutationDefaults, defaultFunctionRegistry },
    };
  };
}

/** Loads `fixtures/<caseName>/schema.prisma` through the provider, as `contract emit` does. */
export function loadFixtureSchema(caseName: string, contextFor = postgresSourceContext) {
  const schemaPath = join(fixturesDir, caseName, 'schema.prisma');
  return prisma7Contract(schemaPath, { binding: prisma7PostgresBinding }).source.load(
    contextFor([schemaPath]),
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
  contextFor = postgresSourceContext,
): Promise<SerializedTable> {
  const result = await loadFixtureSchema(caseName, contextFor);
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

/** A fixture's `schema.prisma` text. */
export function fixtureSchemaText(caseName: string): string {
  return readFileSync(join(fixturesDir, caseName, 'schema.prisma'), 'utf8');
}

/** Interprets Prisma 7 schema text with the Postgres composition, or throws the diagnostics. */
export function interpretSchemaText(text: string): Contract<SqlStorage> {
  const context = postgresSourceContext(['schema.prisma']);
  const { document, sources } = parse(text, 'schema.prisma', { grammar: 'prisma-7' });
  const result = interpretPrisma7Documents({
    documents: [
      {
        document,
        sources,
        sourceFile: sources.sourceFileFor(document.syntax),
        sourceId: 'schema.prisma',
      },
    ],
    seedDiagnostics: [],
    binding: prisma7PostgresBinding,
    controlMutationDefaults: context.controlMutationDefaults,
    authoringContributions: context.authoringContributions,
    codecLookup: context.codecLookup,
    dataTypes: context.dataTypes,
    composedExtensions: context.composedExtensions,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return result.value as Contract<SqlStorage>;
}
