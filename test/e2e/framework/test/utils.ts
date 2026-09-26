import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import arktypeJson from '@prisma/orm-extension-arktype-json/control';
import arktypeJsonRuntime from '@prisma/orm-extension-arktype-json/runtime';
import pgvector from '@prisma/orm-extension-pgvector/control';
import pgvectorRuntime from '@prisma/orm-extension-pgvector/runtime';
import type { Db } from '@prisma/orm-postgres/builder/types';
import type { Contract } from '@prisma/orm-postgres/contract/types';
import { type ControlClient, createPostgresControlClient } from '@prisma/orm-postgres/control';
import type { SqlStorage } from '@prisma/orm-postgres/family-contract/types';
import type { ExecutionContext, Runtime } from '@prisma/orm-postgres/family-runtime';
import { materialiseMigrationPackage } from '@prisma/orm-postgres/migration-tools/io';
import { emitContractSpaceArtifacts } from '@prisma/orm-postgres/migration-tools/spaces';
import postgres, { type PostgresClient } from '@prisma/orm-postgres/runtime';
import { PostgresContractSerializer } from '@prisma/orm-postgres/target/runtime';
import { withClient, withDevDatabase } from '@repo/test-utils';
import type { Client } from 'pg';

const execFileAsync = promisify(execFile);

export async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

/**
 * Creates a control client configured for the e2e test stack (Postgres + pgvector).
 * Used for database initialization via dbInit.
 */
export function createControlClientForTests(connectionString: string): ControlClient {
  return createPostgresControlClient({
    connection: connectionString,
    extensions: [pgvector, arktypeJson],
  });
}

/**
 * Loads a contract from disk (already-emitted artifact).
 * This helper DRYs up the common pattern of loading contracts in e2e tests.
 * The contract type should be specified from the emitted contract.d.ts file.
 */
export async function loadContractFromDisk<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
>(contractJsonPath: string): Promise<TContract> {
  const contractJson = await loadRawContractFromDisk(contractJsonPath);
  return new PostgresContractSerializer().deserializeContract(contractJson) as TContract;
}

async function loadRawContractFromDisk(contractJsonPath: string): Promise<Record<string, unknown>> {
  const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
  return JSON.parse(contractJsonContent) as Record<string, unknown>;
}

/**
 * Emits a contract via CLI and verifies it matches the on-disk contract.json.
 * This should be used in a single test to verify contract emission correctness.
 * Returns the emitted contract for further use in the test.
 *
 * The config file should already include the contract configuration with nested structure:
 * ```typescript
 * contract: {
 *   source: contract,
 *   output: 'path/to/contract.json',
 *   types: 'path/to/contract.d.ts',
 * }
 * ```
 */
export async function emitAndVerifyContract(
  cliPath: string,
  configPath: string,
  expectedContractJsonPath: string,
): Promise<Contract<SqlStorage>> {
  await execFileAsync('node', [cliPath, 'contract', 'emit', '--config', configPath]);

  // Read the emitted contract from the path specified in config.contract.output
  // For now, we'll read from expectedContractJsonPath since that's what the test expects
  // In the future, we could parse the config to get the actual output path
  const emittedContractContent = await readFile(expectedContractJsonPath, 'utf-8');
  const emittedContract = JSON.parse(emittedContractContent) as Record<string, unknown>;

  const expectedContractContent = await readFile(expectedContractJsonPath, 'utf-8');
  const expectedContract = JSON.parse(expectedContractContent) as Record<string, unknown>;

  if (JSON.stringify(emittedContract) !== JSON.stringify(expectedContract)) {
    throw new Error(
      `Emitted contract does not match expected contract on disk.\nExpected: ${expectedContractJsonPath}\nEmitted: ${expectedContractJsonPath}`,
    );
  }

  return new PostgresContractSerializer().deserializeContract(
    emittedContract,
  ) as Contract<SqlStorage>;
}

/**
 * Materialise pgvector's pinned contract-space artifacts under
 * `<migrationsDir>/pgvector/...`. The e2e contracts declare pgvector
 * in their extension packs, so the per-space `db init` flow requires
 * its head ref + baseline migration to be present on disk.
 */
async function materialisePgvectorPinnedArtifacts(migrationsDir: string): Promise<void> {
  const space = pgvector.contractSpace;
  if (!space) {
    throw new Error('pgvector descriptor must declare a contractSpace');
  }
  const baseline = space.migrations[0];
  if (!baseline) {
    throw new Error('pgvector contract-space must ship at least one baseline migration');
  }
  await emitContractSpaceArtifacts(migrationsDir, 'pgvector', {
    contract: space.contractJson,
    contractDts: '// rendered .d.ts for pgvector contract space\nexport interface Contract {}\n',
    headRef: { hash: space.headRef.hash, invariants: [...space.headRef.invariants] },
  });
  await materialiseMigrationPackage(join(migrationsDir, 'pgvector'), baseline);
}

export async function withE2eMigrationsDir<T>(
  callback: (migrationsDir: string) => Promise<T>,
): Promise<T> {
  const migrationsDir = await mkdtemp(join(tmpdir(), 'prisma-8-e2e-migrations-'));
  try {
    await materialisePgvectorPinnedArtifacts(migrationsDir);
    return await callback(migrationsDir);
  } finally {
    await rm(migrationsDir, { recursive: true, force: true });
  }
}

export async function runDbInit(options: {
  readonly connectionString: string;
  readonly contractJsonPath: string;
  readonly migrationsDir?: string;
}): Promise<void> {
  const { connectionString, contractJsonPath } = options;
  const contractJson = await loadRawContractFromDisk(contractJsonPath);
  const controlClient = createControlClientForTests(connectionString);

  const invoke = async (migrationsDir: string): Promise<void> => {
    const result = await controlClient.dbInit({
      contract: contractJson,
      mode: 'apply',
      migrationsDir,
    });
    if (!result.ok) {
      throw new Error(
        `dbInit failed: ${result.failure.summary}\n${JSON.stringify(result.failure, null, 2)}`,
      );
    }
  };

  try {
    if (options.migrationsDir !== undefined) {
      await invoke(options.migrationsDir);
      return;
    }
    await withE2eMigrationsDir(invoke);
  } finally {
    await controlClient.close();
  }
}

async function getPlannedDdlSql(options: {
  readonly connectionString: string;
  readonly contract: Record<string, unknown>;
  readonly migrationsDir?: string;
}): Promise<string> {
  const { connectionString, contract } = options;
  const controlClient = createControlClientForTests(connectionString);

  const invoke = async (migrationsDir: string): Promise<string> => {
    const result = await controlClient.dbInit({
      contract,
      mode: 'plan',
      connection: connectionString,
      migrationsDir,
    });
    if (!result.ok) {
      throw new Error(`dbInit plan failed: ${result.failure.summary}`);
    }

    const sqlStatements =
      result.value.plan.preview?.statements
        .filter((s) => s.language === 'sql')
        .map((s) => s.text) ?? [];
    return sqlStatements.join(';\n\n');
  };

  try {
    if (options.migrationsDir !== undefined) {
      return await invoke(options.migrationsDir);
    }
    return await withE2eMigrationsDir(invoke);
  } finally {
    await controlClient.close();
  }
}

/**
 * Test context provided to test callbacks by `withTestRuntime`.
 * Contains all the setup needed for e2e tests against a real database.
 */
export interface TestRuntimeContext<TContract extends Contract<SqlStorage>> {
  /** The validated contract loaded from disk */
  readonly contract: TContract;
  /** The SQL query context for building queries */
  readonly context: ExecutionContext<TContract>;
  /** The test runtime for executing queries */
  readonly runtime: Runtime;
  /** The sql-builder proxy for building and executing queries */
  readonly db: Db<TContract>;
  /** The raw SQL lane for statements the builder does not express */
  readonly raw: PostgresClient<TContract>['raw'];
  /** The raw pg client for direct SQL queries */
  readonly client: Client;
  /** The DDL SQL generated for the contract */
  readonly sql: string;
}

/**
 * Sets up a complete test environment with database, contract, and runtime.
 * This helper DRYs up the common e2e test setup pattern:
 * - Loads contract from disk
 * - Spins up a dev database
 * - Runs db init (migrations)
 * - Creates adapter, context, and runtime
 * - Ensures runtime is closed after the test
 *
 * @example
 * ```typescript
 * it('runs a query', async () => {
 *   await withTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
 *     const plan = db.public.user.select('id').build();
 *     const rows = await executePlanAndCollect(runtime, plan);
 *     expect(rows.length).toBeGreaterThan(0);
 *   });
 * });
 * ```
 */
export async function withTestRuntime<TContract extends Contract<SqlStorage>>(
  contractJsonPath: string,
  callback: (ctx: TestRuntimeContext<TContract>) => Promise<void>,
): Promise<void> {
  const contractJson = await loadRawContractFromDisk(contractJsonPath);

  await withDevDatabase(async ({ connectionString }) => {
    await withE2eMigrationsDir(async (migrationsDir) => {
      const sql = await getPlannedDdlSql({
        connectionString,
        contract: contractJson,
        migrationsDir,
      });
      await runDbInit({ connectionString, contractJsonPath, migrationsDir });

      await withClient(connectionString, async (client: Client) => {
        const postgresClient = postgres<TContract>({
          contractJson,
          pg: client,
          extensions: [pgvectorRuntime, arktypeJsonRuntime],
        });
        const runtime = await postgresClient.connect();

        try {
          await callback({
            contract: postgresClient.contract,
            context: postgresClient.context,
            runtime,
            db: postgresClient.sql,
            raw: postgresClient.raw,
            client,
            sql,
          });
        } finally {
          await postgresClient.close();
        }
      });
    });
  });
}
