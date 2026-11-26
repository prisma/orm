import { PRISMA_TABLES_SPACE_ID } from '@internal/framework-components/control';
import { applyInstalledContractSpace } from '@internal/migration-tools/spaces';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  releaseCandidatePrismaTables,
  releaseCandidateRows,
} from './fixtures/release-candidate-prisma-tables';
import {
  createDriver,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  testTimeout,
} from './fixtures/runner-fixtures';

const contractSpace = postgresTargetDescriptor.contractSpace!;
const headHash = contractSpace.headRef.hash;
const [firstMigration] = contractSpace.migrations;

describe("applying the Postgres target's _prisma contract space", { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createTestDatabase();
    driver = await createDriver(database.connectionString);
  }, testTimeout);

  afterAll(async () => {
    await driver.close();
    await database.close();
  }, testTimeout);

  beforeEach(async () => {
    await driver.query('drop schema if exists prisma_contract cascade');
    await driver.query('drop schema if exists _prisma cascade');
  }, testTimeout);

  function apply() {
    return applyInstalledContractSpace({
      spaceId: PRISMA_TABLES_SPACE_ID,
      contractSpace,
      driver,
      familyInstance,
      migrations: postgresTargetDescriptor.migrations,
      frameworkComponents,
    });
  }

  async function schemas(): Promise<readonly string[]> {
    const result = await driver.query<{ name: string }>(
      `select nspname as name from pg_namespace where nspname in ('_prisma', 'prisma_contract') order by 1`,
    );
    return result.rows.map((row) => row.name);
  }

  async function tablesIn(schema: string): Promise<readonly string[]> {
    const result = await driver.query<{ name: string }>(
      'select table_name as name from information_schema.tables where table_schema = $1 order by 1',
      [schema],
    );
    return result.rows.map((row) => row.name);
  }

  async function markers() {
    const result = await driver.query<{ space: string; core_hash: string; invariants: string }>(
      'select space, core_hash, invariants::text as invariants from _prisma.marker order by space',
    );
    return result.rows;
  }

  async function ledger() {
    const result = await driver.query<{ space: string; migration_name: string }>(
      'select space, migration_name from _prisma.ledger order by id',
    );
    return result.rows;
  }

  async function createReleaseCandidateTables(): Promise<void> {
    for (const statement of [...releaseCandidatePrismaTables, ...releaseCandidateRows]) {
      await driver.query(statement);
    }
  }

  it('creates schema _prisma with its tables and its own rows on a fresh database', {
    timeout: testTimeout,
  }, async () => {
    const result = await apply();

    expect(result.ok && result.value.applied).toBe(true);
    expect({
      schemas: await schemas(),
      tables: await tablesIn('_prisma'),
      markers: await markers(),
      ledger: await ledger(),
    }).toEqual({
      schemas: ['_prisma'],
      tables: ['contract', 'ledger', 'marker'],
      markers: [{ space: '_prisma', core_hash: headHash, invariants: '{}' }],
      ledger: [{ space: '_prisma', migration_name: firstMigration?.dirName }],
    });
  });

  it('renames the schema of a release candidate and keeps its rows', {
    timeout: testTimeout,
  }, async () => {
    await createReleaseCandidateTables();

    const result = await apply();

    expect(result.ok && result.value.applied).toBe(true);
    expect({
      schemas: await schemas(),
      tables: await tablesIn('_prisma'),
      markers: await markers(),
      ledger: await ledger(),
    }).toEqual({
      schemas: ['_prisma'],
      tables: ['contract', 'ledger', 'marker'],
      markers: [
        { space: '_prisma', core_hash: headHash, invariants: '{}' },
        { space: 'app', core_hash: 'app-hash', invariants: '{app:invariant}' },
      ],
      ledger: [
        { space: 'app', migration_name: '20261001T0000_init' },
        { space: '_prisma', migration_name: firstMigration?.dirName },
      ],
    });
  });

  it('stops, names the table and changes nothing when a table lacks an expected column', {
    timeout: testTimeout,
  }, async () => {
    await createReleaseCandidateTables();
    await driver.query('alter table prisma_contract.marker drop column invariants');

    const result = await apply();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect({
      code: result.failure.code,
      message: result.failure.message,
      databaseUnchanged: result.failure.meta.databaseUnchanged,
    }).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      message: expect.stringContaining('"_prisma"."marker" has column "invariants"'),
      databaseUnchanged: true,
    });
    const rows = await driver.query<{ space: string }>(
      'select space from prisma_contract.marker order by space',
    );
    expect({ schemas: await schemas(), markers: rows.rows }).toEqual({
      schemas: ['prisma_contract'],
      markers: [{ space: 'app' }],
    });
  });

  it('stops when both the old and the new schema exist', {
    timeout: testTimeout,
  }, async () => {
    await createReleaseCandidateTables();
    await driver.query('create schema _prisma');

    const result = await apply();

    expect(result.ok ? result.value : result.failure.code).toBe('MIGRATION.PRECHECK_FAILED');
    expect(await schemas()).toEqual(['_prisma', 'prisma_contract']);
  });

  it('touches nothing on a second call', { timeout: testTimeout }, async () => {
    await apply();
    const ledgerBefore = await ledger();

    const result = await apply();

    expect(result.ok && result.value).toEqual({ applied: false, operationsExecuted: 0 });
    expect(await ledger()).toEqual(ledgerBefore);
  });
});
