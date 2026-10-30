/**
 * Test utilities using the programmatic control client and runtime.
 *
 * This demonstrates how to use `createPostgresControlClient` for test database
 * setup and the runtime for data operations, instead of manual SQL and
 * stampMarker.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pgvector from '@prisma/orm-extension-pgvector/control';
import { type ControlClient, createPostgresControlClient } from '@prisma/orm-postgres/control';
import { materialiseMigrationPackage } from '@prisma/orm-postgres/migration-tools/io';
import { emitContractSpaceArtifacts } from '@prisma/orm-postgres/migration-tools/spaces';

export interface TestControlClientOptions {
  readonly connection: string;
}

/**
 * Creates a control client configured for the demo app's stack.
 *
 * The client auto-connects when operations are called because we provide
 * a default connection in options.
 */
export function createPrismaNextControlClient(options: TestControlClientOptions): ControlClient {
  return createPostgresControlClient({
    extensions: [pgvector],
    connection: options.connection,
  });
}

/**
 * Initializes a test database with schema and marker from a contract.
 *
 * This replaces the manual table creation and stampMarker calls.
 * dbInit in 'apply' mode creates all tables/indexes and writes the marker.
 *
 * @example
 * ```typescript
 * await withDevDatabase(async ({ connectionString }) => {
 *   await initTestDatabase({ connection: connectionString, contract });
 *   // Database is now ready with schema and marker
 * });
 * ```
 */
/**
 * Materialise pgvector's pinned contract-space artifacts under
 * `<migrationsDir>/pgvector/...`. The demo's contract uses pgvector,
 * so the per-space `db init` flow requires its head ref and
 * migrations to be present on disk.
 */
async function materialisePgvectorPinnedArtifacts(migrationsDir: string): Promise<void> {
  const space = pgvector.contractSpace;
  if (!space) {
    throw new Error('pgvector descriptor must declare a contractSpace');
  }
  await emitContractSpaceArtifacts(migrationsDir, 'pgvector', {
    contract: space.contractJson,
    contractDts: '// rendered .d.ts for pgvector contract space\nexport interface Contract {}\n',
    headRef: { hash: space.headRef.hash, invariants: [...space.headRef.invariants] },
  });
  for (const migration of space.migrations) {
    await materialiseMigrationPackage(join(migrationsDir, 'pgvector'), migration);
  }
}

export async function initTestDatabase(options: {
  readonly connection: string;
  readonly contract: unknown;
  /**
   * On-disk migrations directory. When omitted, a temporary directory is
   * created (and cleaned up) and pgvector's pinned contract-space
   * artifacts are materialised inside it.
   */
  readonly migrationsDir?: string;
}): Promise<void> {
  const client = createPrismaNextControlClient({ connection: options.connection });

  const ownsMigrationsDir = options.migrationsDir === undefined;
  const migrationsDir =
    options.migrationsDir ?? mkdtempSync(join(tmpdir(), 'prisma-8-demo-migrations-'));
  try {
    if (ownsMigrationsDir) {
      mkdirSync(migrationsDir, { recursive: true });
      await materialisePgvectorPinnedArtifacts(migrationsDir);
    }
    const initResult = await client.dbInit({
      invocation: { cwd: process.cwd(), configPath: undefined, dbGiven: false },
      contract: options.contract,
      mode: 'apply',
      migrationsDir,
    });
    if (!initResult.ok) {
      throw new Error(
        `dbInit failed: ${initResult.failure.message}\n\n${JSON.stringify(initResult.failure, null, 2)}`,
      );
    }
  } finally {
    await client.close();
    if (ownsMigrationsDir) {
      rmSync(migrationsDir, { recursive: true, force: true });
    }
  }
}
