/**
 * Work the journeys need done with the workspace packages.
 *
 * The journeys run the CLI in-process from the workspace packages, so a
 * journey file that loaded a published `@prisma/orm-*` name would load a second
 * copy of the framework and every command after it would refuse to run. A
 * journey file names no package; these helpers do the work for it, and the
 * project files they write name the workspace packages too.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import postgresAdapterDescriptor from '@internal/adapter-postgres/control';
import { computeStorageHash } from '@internal/contract/hashing';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import postgresDriverDescriptor from '@internal/driver-postgres/control';
import sqlFamilyDescriptor from '@internal/family-sql/control';
import { createControlStack, storageHashHex } from '@internal/framework-components/control';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { readMigrationPackage, readMigrationsDir } from '@internal/migration-tools/io';
import postgres from '@internal/postgres/runtime';
import { contractFromJson } from '@internal/postgres/static';
import { printPsl } from '@internal/psl-printer';
import { SqlStorage } from '@internal/sql-contract/types';
import postgresTargetDescriptor from '@internal/target-postgres/control';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { join } from 'pathe';
import { fixtureAppDir } from './cli-test-helpers';

/** A file of the contract snapshot the project's migrations store for `storageHash`. */
export function contractSnapshotFile(testDir: string, storageHash: string, file: string): string {
  return join(contractSnapshotDir(join(testDir, 'migrations'), storageHash), file);
}

/** `manifest` with the migration hash recomputed over it and `ops`, as `migration plan` attests it. */
export function attestMigration<Manifest extends Parameters<typeof computeMigrationHash>[0]>(
  manifest: Manifest,
  ops: Parameters<typeof computeMigrationHash>[1],
): Manifest & { readonly migrationHash: string } {
  return { ...manifest, migrationHash: computeMigrationHash(manifest, ops) };
}

function appMigrationsDirs(testDir: string): { readonly root: string; readonly app: string } {
  const root = join(testDir, 'migrations');
  return { root, app: join(root, 'app') };
}

/** The project's `app` migration packages, read and verified the way the CLI reads them. */
export async function readAppMigrations(testDir: string) {
  const { root, app } = appMigrationsDirs(testDir);
  const { packages } = await readMigrationsDir(app, { migrationsDir: root });
  return packages;
}

/** One `app` migration package, read and verified the way the CLI reads it. */
export function readAppMigration(testDir: string, dirName: string) {
  const { root, app } = appMigrationsDirs(testDir);
  return readMigrationPackage(join(app, dirName), { migrationsDir: root });
}

/** The storage hash a Postgres contract's storage hashes to. */
export function postgresStorageHash(storage: {
  readonly target: string;
  readonly targetFamily: string;
  readonly storage: Record<string, unknown>;
}): string {
  return computeStorageHash({
    ...storage,
    ...new PostgresContractSerializer().hashCanonicalizationHooks,
  });
}

/**
 * The start of a hand-written Postgres `migration.ts` whose operations read and write rows: it
 * imports `Migration`, `MigrationCLI` and `col`, and binds `endContract` to the contract snapshot
 * for `endStorageHash` and `db` to a query builder over it.
 */
export function postgresDataMigrationHeader(endStorageHash: string): string {
  return `import postgresAdapter from '@internal/adapter-postgres/runtime';
import { sql } from '@internal/sql-builder/runtime';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import { Migration, MigrationCLI, col } from '@internal/target-postgres/migration';
import postgresTarget from '@internal/target-postgres/runtime';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import endContractJson from '../../snapshots/${storageHashHex(endStorageHash)}/contract.json' with { type: 'json' };

const endContract = new PostgresContractSerializer().deserializeContract(endContractJson);

const db = sql({
  context: createExecutionContext({
    contract: endContract,
    stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
  }),
});
`;
}

/** The module a Mongo `migration.ts` imports `Migration`, `MigrationCLI` and the operation factories from. */
export const mongoMigrationModule = '@internal/target-mongo/migration';

/**
 * The imports of a hand-written Mongo `migration.ts`: `createIndex`, `dataTransform`, `Migration`
 * and `MigrationCLI`, and the raw commands `RawUpdateManyCommand` and `RawAggregateCommand`.
 */
export function mongoDataMigrationImports(): string {
  return `import { createIndex, dataTransform, Migration, MigrationCLI } from '${mongoMigrationModule}';
import { RawUpdateManyCommand, RawAggregateCommand } from '@internal/mongo-query-ast/execution';
`;
}

/** Writes a Mongo project config whose contract is `contract.prisma`, emitted into `output/`. */
export function writeMongoPslConfig(testDir: string, connectionString: string): string {
  const config = readFileSync(
    join(fixtureAppDir, 'fixtures/mongo-cli-journeys/prisma.config.psl.with-db.ts'),
    'utf-8',
  ).replace(/\{\{DB_URL\}\}/g, () => connectionString);
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(configPath, config, 'utf-8');
  return configPath;
}

/** The rows of `table`'s `columns`, selected through a Postgres client built from the emitted contract. */
export async function selectRows(options: {
  readonly contractJson: unknown;
  readonly connectionString: string;
  readonly table: string;
  readonly columns: readonly string[];
}): Promise<readonly unknown[]> {
  const client = postgres({
    contract: contractFromJson<Contract<SqlStorage>>(options.contractJson),
    url: options.connectionString,
  });
  const runtime = await client.connect();
  try {
    const sqlNamespace = (
      client.sql as unknown as {
        readonly public: Record<string, { select(...columns: string[]): { build(): never } }>;
      }
    ).public;
    const sqlTable = sqlNamespace[options.table];
    if (sqlTable === undefined) {
      throw new Error(
        `the client exposes no ${options.table}; it has ${Object.keys(sqlNamespace)}`,
      );
    }
    const rows: unknown[] = [];
    for await (const row of runtime.query(sqlTable.select(...options.columns).build())) {
      rows.push(row);
    }
    return rows;
  } finally {
    await runtime.close();
  }
}

/** Creates a row of `model` in the `public` namespace through a Postgres client built from the emitted contract. */
export async function createRowThroughOrm(options: {
  readonly contractJson: unknown;
  readonly connectionString: string;
  readonly model: string;
  readonly row: Record<string, unknown>;
}): Promise<unknown> {
  const client = postgres({
    contract: contractFromJson<Contract<SqlStorage>>(options.contractJson),
    url: options.connectionString,
  });
  const runtime = await client.connect();
  try {
    const models = (
      client.orm as unknown as {
        readonly public: Record<string, { create(row: Record<string, unknown>): Promise<unknown> }>;
      }
    ).public;
    const collection = models[options.model];
    if (collection === undefined) {
      throw new Error(`the ORM exposes no ${options.model}; it has ${Object.keys(models)}`);
    }
    return await collection.create(options.row);
  } finally {
    await runtime.close();
  }
}

/**
 * The PSL `contract infer` would write for the Postgres schema `namespace`.
 *
 * `contract infer` introspects only the default schema, so this introspects with a contract that
 * declares only `namespace` and infers from that — the same introspect-then-infer path.
 */
export async function inferPostgresNamespacePsl(
  connectionString: string,
  namespace: string,
): Promise<string> {
  const contract: Contract<SqlStorage> = {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash(`${namespace}-introspection`),
      namespaces: {
        [namespace]: postgresCreateNamespace({ id: namespace, entries: { table: {} } }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
  const controlStack = createControlStack({
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: postgresAdapterDescriptor,
    driver: postgresDriverDescriptor,
    extensions: [],
  });
  const familyInstance = sqlFamilyDescriptor.create(controlStack);
  const driver = await postgresDriverDescriptor.create(connectionString);
  try {
    const schemaIR = await familyInstance.introspect({ driver, contract });
    const ast = await familyInstance.inferPslContract(schemaIR);
    return printPsl(ast, {
      pslBlockDescriptors: controlStack.authoringContributions.pslBlockDescriptors,
    });
  } finally {
    await driver.close();
  }
}
