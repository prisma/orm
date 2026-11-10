import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prisma7Contract } from '@internal/sql-contract-prisma7/provider';
import postgres from '@internal/target-postgres/control';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';

/** Loads a Prisma 7 schema through the Postgres composition `contract emit` builds, or throws its diagnostics. */
export async function loadPrisma7Schema(schemaPath: string): Promise<Contract<SqlStorage>> {
  const stack = createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [],
  });
  const loaded = await prisma7Contract(schemaPath, { binding: prisma7PostgresBinding }).source.load(
    {
      composedExtensions: [],
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
