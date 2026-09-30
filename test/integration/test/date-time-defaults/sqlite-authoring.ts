import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import sqliteAdapter from '@internal/adapter-sqlite/control';
import type { Contract } from '@internal/contract/types';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import sqlite, { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import sqlitePackRef from '@internal/target-sqlite/pack';
import { join } from 'pathe';

export const sqliteStack = createControlStack({
  family: sql,
  target: sqlite,
  adapter: sqliteAdapter,
  driver: sqliteDriver,
});

export const sqliteFrameworkComponents = [sqlite, sqliteAdapter] as const;

/** Reads a PSL schema through the SQLite contract source, as `contract emit` does. */
export async function authorSqliteContractFromPsl(pslSchema: string) {
  const schemaPath = join(mkdtempSync(join(tmpdir(), 'psl-date-time-defaults-')), 'schema.prisma');
  writeFileSync(schemaPath, `// use prisma-8\n\n${pslSchema}`, 'utf-8');
  return prismaContract(schemaPath, {
    target: sqlitePackRef,
    createNamespace: sqliteCreateNamespace,
  }).source.load({
    composedExtensions: [],
    composedExtensionContracts: new Map(),
    authoringContributions: sqliteStack.authoringContributions,
    codecLookup: sqliteStack.codecLookup,
    dataTypeLookup: sqliteStack.dataTypeLookup,
    controlMutationDefaults: sqliteStack.controlMutationDefaults,
    resolvedInputs: [schemaPath],
    capabilities: sqliteStack.capabilities,
  });
}

/** The contract a schema emits, or a thrown error naming the diagnostics. */
export async function sqliteContractFromPsl(pslSchema: string): Promise<Contract<SqlStorage>> {
  const result = await authorSqliteContractFromPsl(pslSchema);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return result.value as Contract<SqlStorage>;
}
