import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { ContractSourceContext } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import {
  type ControlExtensionDescriptor,
  createControlStack,
} from '@internal/framework-components/control';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlStorage } from '@internal/sql-contract/types';
import postgres from '@internal/target-postgres/control';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { dirname, join } from 'pathe';
import { interpretPrisma7Documents } from '../src/interpreter';
import { prisma7Contract } from '../src/provider';
import type { Prisma7TargetBinding } from '../src/target-binding';

export const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** The same composition `prisma contract emit` builds for a Postgres config with these extensions. */
export function postgresSourceContext(
  resolvedInputs: readonly string[],
  extensions: readonly ControlExtensionDescriptor<'sql', 'postgres'>[] = [],
): ContractSourceContext {
  const stack = createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions,
  });
  return {
    composedExtensions: stack.extensions.map((extension) => extension.id),
    defaultNamespaceId: stack.target.defaultNamespaceId,
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    dataTypes: stack.dataTypes,
    controlMutationDefaults: stack.controlMutationDefaults,
    generatorFunctions: stack.generatorFunctions,
    resolvedInputs,
    capabilities: stack.capabilities,
  };
}

/** The extension pack ids a fixture's `composed-extensions.json` lists; none when the fixture has no such file. */
export function composedExtensionsOf(caseDirectory: string): readonly string[] {
  const path = join(caseDirectory, 'composed-extensions.json');
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as string[]) : [];
}

const extensionPacksDir = join(fixturesDir, '../../../../../3-extensions');

/** The contract the extension pack `packId` publishes, read from the pack's `src/contract.json`. */
export function packContract(packId: string): Contract {
  const path = join(extensionPacksDir, packId, 'src/contract.json');
  return new PostgresContractSerializer().deserializeContract(
    JSON.parse(readFileSync(path, 'utf8')),
  );
}

/** `context` with the extension packs whose ids are `packIds` composed as well, each with the contract it publishes. */
export function withComposedExtensions(
  context: ContractSourceContext,
  packIds: readonly string[],
): ContractSourceContext {
  return {
    ...context,
    composedExtensions: [...context.composedExtensions, ...packIds],
    composedExtensionContracts: new Map([
      ...context.composedExtensionContracts,
      ...packIds.map((packId): [string, Contract] => [packId, packContract(packId)]),
    ]),
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
  return serializedTable(result.value as Contract<SqlStorage>, tableName, namespaceId);
}

/** One table of `contract`'s serialized storage, or a thrown error naming the missing table. */
export function serializedTable(
  contract: Contract<SqlStorage>,
  tableName: string,
  namespaceId = 'public',
): SerializedTable {
  const serialized = JSON.parse(
    JSON.stringify(new PostgresContractSerializer().serializeContract(contract)),
  ) as {
    storage: {
      namespaces: Record<string, { entries: { table: Record<string, SerializedTable> } }>;
    };
  };
  const table = serialized.storage.namespaces[namespaceId]?.entries.table[tableName];
  if (table === undefined) throw new Error(`The contract has no table "${tableName}"`);
  return table;
}

/** The namespaces of `contract`'s serialized storage, by id. */
export function serializedNamespaces(
  contract: Contract<SqlStorage>,
): Record<string, { readonly entries: Record<string, unknown> }> {
  return JSON.parse(JSON.stringify(new PostgresContractSerializer().serializeContract(contract)))
    .storage.namespaces;
}

/** A fixture's `schema.prisma` text. */
export function fixtureSchemaText(caseName: string): string {
  return readFileSync(join(fixturesDir, caseName, 'schema.prisma'), 'utf8');
}

/** Interprets Prisma 7 schema text with the Postgres composition and `extensions`, with `composedPacks` composed as well. */
export function interpretSchemaTextResult(
  text: string,
  binding: Prisma7TargetBinding = prisma7PostgresBinding,
  composedPacks: ReadonlyMap<string, Contract> = new Map(),
  defaultNamespaceId = postgresSourceContext(['schema.prisma']).defaultNamespaceId,
  extensions: readonly ControlExtensionDescriptor<'sql', 'postgres'>[] = [],
) {
  const context = postgresSourceContext(['schema.prisma'], extensions);
  const { document, sources } = parse(text, 'schema.prisma', { grammar: 'prisma-7' });
  return interpretPrisma7Documents({
    documents: [
      {
        document,
        sources,
        sourceFile: sources.sourceFileFor(document.syntax),
        sourceId: 'schema.prisma',
      },
    ],
    seedDiagnostics: [],
    defaultNamespaceId,
    binding,
    controlMutationDefaults: context.controlMutationDefaults,
    generatorFunctions: context.generatorFunctions,
    authoringContributions: context.authoringContributions,
    codecLookup: context.codecLookup,
    dataTypes: context.dataTypes,
    composedExtensions: [...context.composedExtensions, ...composedPacks.keys()],
    composedExtensionContracts: new Map([...context.composedExtensionContracts, ...composedPacks]),
  });
}

/** Interprets Prisma 7 schema text with the Postgres composition, or throws the diagnostics. */
export function interpretSchemaText(text: string): Contract<SqlStorage> {
  const result = interpretSchemaTextResult(text);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return result.value as Contract<SqlStorage>;
}
