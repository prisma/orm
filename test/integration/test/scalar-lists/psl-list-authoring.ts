import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import mongoAdapter from '@internal/adapter-mongo/control';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { ContractSourceContext } from '@internal/cli/config-types';
import { enrichContract } from '@internal/cli/control-api';
import type { Contract, JsonValue } from '@internal/contract/types';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import type { MongoContract } from '@internal/mongo-contract';
import { mongoContract } from '@internal/mongo-contract-psl/provider';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { join } from 'pathe';

const sqlStack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
});

const mongoStack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
});

const sqlSourceContext: ContractSourceContext = {
  composedExtensions: [],
  composedExtensionContracts: new Map(),
  authoringContributions: sqlStack.authoringContributions,
  codecLookup: sqlStack.codecLookup,
  dataTypeLookup: sqlStack.dataTypeLookup,
  controlMutationDefaults: sqlStack.controlMutationDefaults,
  resolvedInputs: [],
  capabilities: sqlStack.capabilities,
};

const mongoSourceContext: ContractSourceContext = {
  composedExtensions: [],
  composedExtensionContracts: new Map(),
  authoringContributions: mongoStack.authoringContributions,
  codecLookup: mongoStack.codecLookup,
  dataTypeLookup: mongoStack.dataTypeLookup,
  controlMutationDefaults: mongoStack.controlMutationDefaults,
  resolvedInputs: [],
  capabilities: mongoStack.capabilities,
};

export const postgresFrameworkComponents = [postgres, postgresAdapter] as const;
export const mongoFrameworkComponents = [mongoTargetDescriptor, mongoAdapter] as const;

function writeSchemaToTempFile(schema: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'psl-list-'));
  const path = join(dir, 'schema.prisma');
  writeFileSync(path, `// use prisma-8\n\n${schema}`, 'utf-8');
  return path;
}

export interface SqlAuthoringResult {
  readonly ok: boolean;
  readonly diagnostics: ReadonlyArray<{ readonly code: string; readonly message: string }>;
  readonly contract?: Contract<SqlStorage>;
}

/** Authors PSL through the production provider + enrichment path the CLI uses. */
export async function authorSqlContractFromPsl(schema: string): Promise<SqlAuthoringResult> {
  const schemaPath = writeSchemaToTempFile(schema);
  const provider = prismaContract(schemaPath, {
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
  });

  const providerResult = await provider.source.load({
    ...sqlSourceContext,
    resolvedInputs: [schemaPath],
  });

  if (!providerResult.ok) {
    return { ok: false, diagnostics: providerResult.failure.diagnostics };
  }

  const familyInstance = sql.create(sqlStack);
  const contract = familyInstance.deserializeContract(
    enrichContract(providerResult.value, postgresFrameworkComponents),
  ) as Contract<SqlStorage>;

  return { ok: true, diagnostics: [], contract };
}

/** Returns the first column matching `columnName` across all storage tables. */
export function findStorageColumn(
  contract: Contract<SqlStorage>,
  columnName: string,
): Record<string, unknown> | undefined {
  for (const namespace of Object.values(contract.storage.namespaces)) {
    const tables = namespace.entries.table ?? {};
    for (const table of Object.values(tables)) {
      const column = table.columns[columnName];
      if (column) {
        return column as unknown as Record<string, unknown>;
      }
    }
  }
  return undefined;
}

export interface MongoAuthoringResult {
  readonly ok: boolean;
  readonly diagnostics: ReadonlyArray<{ readonly code: string; readonly message: string }>;
  readonly contract?: MongoContract;
}

/**
 * Authors a PSL document to a deserialized Mongo contract through the
 * production provider + enrichment path, mirroring `authorSqlContractFromPsl`
 * so SQL/Mongo parity can be asserted on identical input.
 */
export async function authorMongoContractFromPsl(schema: string): Promise<MongoAuthoringResult> {
  const schemaPath = writeSchemaToTempFile(schema);
  const provider = mongoContract(schemaPath);

  const providerResult = await provider.source.load({
    ...mongoSourceContext,
    resolvedInputs: [schemaPath],
  });

  if (!providerResult.ok) {
    return { ok: false, diagnostics: providerResult.failure.diagnostics };
  }

  const familyInstance = mongoFamilyDescriptor.create(mongoStack);
  const contract = familyInstance.deserializeContract(
    enrichContract(providerResult.value, mongoFrameworkComponents),
  ) as MongoContract;

  return { ok: true, diagnostics: [], contract };
}

/**
 * Returns the storage table name (the DDL identifier) for the table that owns
 * `columnName`. PSL lowercases model names into table keys, so tests must drive
 * the table name from the contract rather than the PSL model name.
 */
export function tableNameForColumn(contract: Contract<SqlStorage>, columnName: string): string {
  for (const namespace of Object.values(contract.storage.namespaces)) {
    const tables = namespace.entries.table ?? {};
    for (const [tableName, table] of Object.entries(tables)) {
      if (table.columns[columnName]) {
        return tableName;
      }
    }
  }
  throw new Error(`no table owns column "${columnName}"`);
}

export interface ListCodecRef {
  readonly codecId: string;
  readonly many: true;
  readonly typeParams?: JsonValue;
}

/**
 * Derives the `{ codecId, typeParams, many }` codec reference for a list column
 * straight from the authored contract, so AST params/projections match what the
 * PSL path actually emitted. Parameterized codecs (e.g. `pg/numeric@1`) carry
 * their typeParams either inline on the column or via a `typeRef` into
 * `storage.types`; both are resolved here.
 */
export function listCodecRefFor(contract: Contract<SqlStorage>, columnName: string): ListCodecRef {
  const column = findStorageColumn(contract, columnName);
  if (!column) {
    throw new Error(`column "${columnName}" not found in authored contract`);
  }
  const codecId = column['codecId'];
  if (typeof codecId !== 'string') {
    throw new Error(`column "${columnName}" has no codecId`);
  }

  let typeParams = column['typeParams'] as JsonValue | undefined;
  const typeRef = column['typeRef'];
  if (typeParams === undefined && typeof typeRef === 'string') {
    const storageTypes = (contract.storage as unknown as { types?: Record<string, unknown> }).types;
    const typeEntry = storageTypes?.[typeRef] as { typeParams?: JsonValue } | undefined;
    typeParams = typeEntry?.typeParams;
  }

  return {
    codecId,
    many: true,
    ...(typeParams !== undefined ? { typeParams } : {}),
  };
}

export { mongoStack, sqlStack };
