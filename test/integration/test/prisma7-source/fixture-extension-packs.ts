import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import paradedb from '@internal/extension-paradedb/control';
import pgvector from '@internal/extension-pgvector/control';
import postgis from '@internal/extension-postgis/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prisma7Contract } from '@internal/sql-contract-prisma7/provider';
import postgres from '@internal/target-postgres/control';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { dirname, join } from 'pathe';

export const prisma7FixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/2-sql-family/2-authoring/contract-prisma7/test/fixtures',
);

const extensionPacks = new Map([pgvector, postgis, paradedb].map((pack) => [pack.id, pack]));

/** The path of a Prisma 7 reader fixture's `composed-extensions.json`. */
export function composedExtensionsPath(fixture: string): string {
  return join(prisma7FixturesDir, fixture, 'composed-extensions.json');
}

/** The extension packs a Prisma 7 reader fixture's `composed-extensions.json` lists, for the stack to compose. */
export function fixtureExtensionPacks(fixture: string) {
  const path = composedExtensionsPath(fixture);
  const packIds: readonly string[] = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
  return packIds.map((packId) => {
    const pack = extensionPacks.get(packId);
    if (pack === undefined)
      throw new Error(`Fixture "${fixture}" composes unknown pack "${packId}"`);
    return pack;
  });
}

function schemaPathOf(fixture: string): string {
  const directory = join(prisma7FixturesDir, fixture, 'schema');
  return existsSync(directory) ? directory : join(prisma7FixturesDir, fixture, 'schema.prisma');
}

/** Reads a Prisma 7 reader fixture through the Postgres composition `contract emit` builds with the fixture's extension packs, or throws its diagnostics. */
export async function interpretPrisma7Fixture(fixture: string): Promise<Contract<SqlStorage>> {
  const schemaPath = schemaPathOf(fixture);
  const stack = createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: fixtureExtensionPacks(fixture),
  });
  const loaded = await prisma7Contract(schemaPath, { binding: prisma7PostgresBinding }).source.load(
    {
      composedExtensions: stack.extensions.map((extension) => extension.id),
      defaultNamespaceId: stack.target.defaultNamespaceId,
      composedExtensionContracts: stack.extensionContracts,
      authoringContributions: stack.authoringContributions,
      codecLookup: stack.codecLookup,
      dataTypes: stack.dataTypes,
      controlMutationDefaults: stack.controlMutationDefaults,
      generatorFunctions: stack.generatorFunctions,
      resolvedInputs: [schemaPath],
      capabilities: stack.capabilities,
    },
  );
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.failure.diagnostics));
  return loaded.value as Contract<SqlStorage>;
}
