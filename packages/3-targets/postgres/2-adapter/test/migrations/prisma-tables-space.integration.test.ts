import type { Contract } from '@internal/contract/types';
import { PRISMA_SPACE_ID } from '@internal/framework-components/control';
import { applyInstalledContractSpace } from '@internal/migration-tools/spaces';
import type { SqlStorage } from '@internal/sql-contract/types';
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
    await driver.query('create role prisma_rc_owner');
    await driver.query('create role prisma_migrator');
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
      spaceId: PRISMA_SPACE_ID,
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

    expect(result.ok && result.value.outcome).toBe('applied');
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

    expect(result.ok && result.value.outcome).toBe('applied');
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
      message: expect.stringContaining(
        '"prisma_contract"."marker", which the release candidates of Prisma 8 created, has column "invariants"',
      ),
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

    expect(result.ok && result.value).toEqual({ outcome: 'atHead', operationsExecuted: 0 });
    expect(await ledger()).toEqual(ledgerBefore);
  });

  async function failureMessage(): Promise<string> {
    const result = await apply();
    if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.value)}`);
    expect(result.failure.code).toBe('MIGRATION.PRECHECK_FAILED');
    return result.failure.message;
  }

  it("creates tables the space's contract describes exactly", {
    timeout: testTimeout,
  }, async () => {
    await apply();

    const contract = familyInstance.deserializeContract(
      contractSpace.contractJson,
    ) as Contract<SqlStorage>;
    const schema = await familyInstance.introspect({ driver, contract });
    const verified = familyInstance.verifySchema({
      contract,
      schema,
      strict: true,
      frameworkComponents,
    });
    expect(verified.ok ? [] : verified.schema.issues).toEqual([]);
  });

  it('adds the missing tables to a database a release candidate only signed', {
    timeout: testTimeout,
  }, async () => {
    const [createSchema, createMarker] = releaseCandidatePrismaTables;
    const [insertMarker] = releaseCandidateRows;
    for (const statement of [createSchema, createMarker, insertMarker]) {
      await driver.query(statement!);
    }

    const result = await apply();

    expect(result.ok && result.value.outcome).toBe('applied');
    expect({ tables: await tablesIn('_prisma'), markers: await markers() }).toEqual({
      tables: ['contract', 'ledger', 'marker'],
      markers: [
        { space: '_prisma', core_hash: headHash, invariants: '{}' },
        { space: 'app', core_hash: 'app-hash', invariants: '{app:invariant}' },
      ],
    });
  });

  it('keeps the stored contracts of a release candidate', { timeout: testTimeout }, async () => {
    await createReleaseCandidateTables();
    await driver.query(
      `insert into prisma_contract.contract (core_hash, contract_json) values ('app-hash', '{"kept": true}'::jsonb)`,
    );

    await apply();

    const stored = await driver.query<{ core_hash: string; contract_json: unknown }>(
      'select core_hash, contract_json from _prisma.contract',
    );
    expect(stored.rows).toEqual([{ core_hash: 'app-hash', contract_json: { kept: true } }]);
  });

  it('stops on a column of another type', { timeout: testTimeout }, async () => {
    await createReleaseCandidateTables();
    await driver.query(
      'alter table prisma_contract.ledger alter column migration_name type varchar(200)',
    );

    expect(await failureMessage()).toContain(
      '"prisma_contract"."ledger", which the release candidates of Prisma 8 created, has column "migration_name" text NOT NULL',
    );
    expect(await schemas()).toEqual(['prisma_contract']);
  });

  it('stops on a column of another nullability', { timeout: testTimeout }, async () => {
    for (const statement of releaseCandidatePrismaTables) await driver.query(statement);
    await driver.query('alter table prisma_contract.marker alter column app_tag set not null');

    expect(await failureMessage()).toContain('has column "app_tag" text nullable');
    expect(await schemas()).toEqual(['prisma_contract']);
  });

  it('names the table in _prisma, and no release, when a table there has another form', {
    timeout: testTimeout,
  }, async () => {
    await driver.query('create schema _prisma');
    await driver.query('create table _prisma.ledger (id int)');

    const message = await failureMessage();

    expect(message).toContain('"_prisma"."ledger" has column "id" bigint NOT NULL');
    expect(message).not.toContain('release candidates');
  });

  it("stops, saying what it needs, when the role does not own the release candidate's schema", {
    timeout: testTimeout,
  }, async () => {
    await createReleaseCandidateTables();
    await driver.query('alter schema prisma_contract owner to prisma_rc_owner');
    await driver.query('grant usage on schema prisma_contract to prisma_migrator');

    await driver.query('set role prisma_migrator');
    let message: string;
    try {
      message = await failureMessage();
    } finally {
      await driver.query('reset role');
    }

    expect(message).toContain('may rename schema "prisma_contract"');
    expect(await schemas()).toEqual(['prisma_contract']);
  });

  it('applies nothing when a later release brought the space further', {
    timeout: testTimeout,
  }, async () => {
    await apply();
    await driver.query(
      "update _prisma.marker set core_hash = 'later-release' where space = '_prisma'",
    );
    await driver.query(
      `insert into _prisma.ledger (space, migration_name, migration_hash, origin_core_hash, destination_core_hash, operations)
       values ('_prisma', '20270101T0000_later', 'later-hash', $1, 'later-release', '[]'::jsonb)`,
      [headHash],
    );
    const ledgerBefore = await ledger();

    const result = await apply();

    expect(result.ok && result.value).toEqual({ outcome: 'ahead', operationsExecuted: 0 });
    expect(await ledger()).toEqual(ledgerBefore);
  });
});
