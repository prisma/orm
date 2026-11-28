import type { Contract } from '@internal/contract/types';
import {
  APP_SPACE_ID,
  databasePoliciesOf,
  PRISMA_SPACE_ID,
} from '@internal/framework-components/control';
import { applyInstalledContractSpace } from '@internal/migration-tools/spaces';
import type { SqlStorage } from '@internal/sql-contract/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  releaseCandidatePrismaTables,
  releaseCandidateRows,
} from './fixtures/release-candidate-prisma-tables';
import {
  controlAdapter,
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

const migrateOnly = {
  change: ['migrate'],
  dataProtection: {
    dataLoss: 'data-loss-forbidden',
    accessWidening: 'access-widening-with-consent',
  },
};

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

  async function signatures() {
    const result = await driver.query<{ space: string; core_hash: string; invariants: string }>(
      'select space, core_hash, invariants::text as invariants from _prisma.signatures order by space',
    );
    return result.rows;
  }

  async function recordedPolicies(): Promise<readonly unknown[]> {
    const result = await driver.query<{ policies: unknown }>('select policies from _prisma.config');
    return result.rows.map((row) => row.policies);
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
      signatures: await signatures(),
      ledger: await ledger(),
    }).toEqual({
      schemas: ['_prisma'],
      tables: ['config', 'contract', 'ledger', 'signatures'],
      signatures: [{ space: '_prisma', core_hash: headHash, invariants: '{}' }],
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
      signatures: await signatures(),
      ledger: await ledger(),
    }).toEqual({
      schemas: ['_prisma'],
      tables: ['config', 'contract', 'ledger', 'signatures'],
      signatures: [
        { space: '_prisma', core_hash: headHash, invariants: '{}' },
        { space: 'app', core_hash: 'app-hash', invariants: '{app:invariant}' },
      ],
      ledger: [
        { space: 'app', migration_name: '20261001T0000_init' },
        { space: '_prisma', migration_name: firstMigration?.dirName },
      ],
    });
  });

  it("moves a release candidate's rows into signatures and its application's policies into config, and drops the marker", {
    timeout: testTimeout,
  }, async () => {
    await createReleaseCandidateTables();
    await driver.query(
      `update prisma_contract.marker set meta = $1::jsonb, updated_at = '2026-10-01T00:00:00Z' where space = 'app'`,
      [JSON.stringify({ policies: migrateOnly, kept: 'elsewhere' })],
    );
    await driver.query(
      `insert into prisma_contract.marker (space, core_hash, profile_hash, invariants, meta, updated_at)
       values ('pgvector', 'ext-hash', 'ext-profile', '{ext:invariant}', '{"policies": {"change": ["reconcile"]}}', '2026-10-02T00:00:00Z')`,
    );

    const result = await apply();

    const signed = await driver.query<{ space: string; profile_hash: string; signed_at: string }>(
      `select space, profile_hash, to_char(signed_at at time zone 'UTC', 'YYYY-MM-DD') as signed_at
       from _prisma.signatures where space <> '_prisma' order by space`,
    );
    expect(result.ok && result.value.outcome).toBe('applied');
    expect({
      tables: await tablesIn('_prisma'),
      signatures: await signatures(),
      signed: signed.rows,
      policies: await recordedPolicies(),
    }).toEqual({
      tables: ['config', 'contract', 'ledger', 'signatures'],
      signatures: [
        { space: '_prisma', core_hash: headHash, invariants: '{}' },
        { space: 'app', core_hash: 'app-hash', invariants: '{app:invariant}' },
        { space: 'pgvector', core_hash: 'ext-hash', invariants: '{ext:invariant}' },
      ],
      signed: [
        { space: 'app', profile_hash: 'app-profile', signed_at: '2026-10-01' },
        { space: 'pgvector', profile_hash: 'ext-profile', signed_at: '2026-10-02' },
      ],
      policies: [migrateOnly],
    });
  });

  it("records no policies when the release candidate's application row records none", {
    timeout: testTimeout,
  }, async () => {
    await createReleaseCandidateTables();

    await apply();

    expect({ tables: await tablesIn('_prisma'), policies: await recordedPolicies() }).toEqual({
      tables: ['config', 'contract', 'ledger', 'signatures'],
      policies: [],
    });
  });

  it('moves policies a release candidate stored as JSON null as they are, so they are still reported as unreadable', {
    timeout: testTimeout,
  }, async () => {
    await createReleaseCandidateTables();
    await driver.query(
      `update prisma_contract.marker set meta = '{"policies": null}' where space = 'app'`,
    );

    await apply();

    const marker = await controlAdapter.readMarker(driver, APP_SPACE_ID);
    expect({
      policies: await recordedPolicies(),
      meta: marker?.meta,
      readable: databasePoliciesOf(marker).ok,
    }).toEqual({ policies: [null], meta: { policies: null }, readable: false });
  });

  it("changes nothing on a second call after moving a release candidate's rows", {
    timeout: testTimeout,
  }, async () => {
    await createReleaseCandidateTables();
    await driver.query(`update prisma_contract.marker set meta = $1::jsonb where space = 'app'`, [
      JSON.stringify({ policies: migrateOnly }),
    ]);
    await apply();
    const before = {
      signatures: await signatures(),
      ledger: await ledger(),
      policies: await recordedPolicies(),
    };

    const result = await apply();

    expect(result.ok && result.value).toEqual({ outcome: 'atHead', operationsExecuted: 0 });
    expect({
      signatures: await signatures(),
      ledger: await ledger(),
      policies: await recordedPolicies(),
    }).toEqual(before);
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
        'Table "prisma_contract"."marker", which the release candidates of Prisma 8 created, must have column "invariants" of type text[], NOT NULL.',
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

  it('stops when the old schema exists and the new one holds a table', {
    timeout: testTimeout,
  }, async () => {
    await createReleaseCandidateTables();
    await driver.query('create schema _prisma');
    await driver.query('create table _prisma.kept (id int)');

    expect(await failureMessage()).toContain(
      'Schema "_prisma" must be empty while schema "prisma_contract" exists.',
    );
    expect({ schemas: await schemas(), tables: await tablesIn('_prisma') }).toEqual({
      schemas: ['_prisma', 'prisma_contract'],
      tables: ['kept'],
    });
  });

  it('drops an empty _prisma beside the schema of a release candidate, then renames', {
    timeout: testTimeout,
  }, async () => {
    await createReleaseCandidateTables();
    await driver.query('create schema _prisma');

    const result = await apply();

    expect(result.ok && result.value.outcome).toBe('applied');
    expect({ schemas: await schemas(), signatures: await signatures() }).toEqual({
      schemas: ['_prisma'],
      signatures: [
        { space: '_prisma', core_hash: headHash, invariants: '{}' },
        { space: 'app', core_hash: 'app-hash', invariants: '{app:invariant}' },
      ],
    });
  });

  it('stops at the check that _prisma is empty, and changes nothing, when _prisma holds only a function', {
    timeout: testTimeout,
  }, async () => {
    await createReleaseCandidateTables();
    await driver.query('create schema _prisma');
    await driver.query("create function _prisma.kept() returns int language sql as 'select 1'");

    expect(await failureMessage()).toContain(
      'Schema "_prisma" must be empty while schema "prisma_contract" exists.',
    );
    const functions = await driver.query<{ name: string }>(
      "select proname as name from pg_proc where pronamespace = '_prisma'::regnamespace",
    );
    expect({ schemas: await schemas(), functions: functions.rows }).toEqual({
      schemas: ['_prisma', 'prisma_contract'],
      functions: [{ name: 'kept' }],
    });
  });

  async function giveReleaseCandidateTablesTo(role: string): Promise<void> {
    await driver.query(`alter schema prisma_contract owner to ${role}`);
    for (const table of ['marker', 'ledger', 'contract']) {
      await driver.query(`alter table prisma_contract.${table} owner to ${role}`);
    }
  }

  async function failureMessageAs(role: string): Promise<string> {
    await driver.query(`set role ${role}`);
    try {
      return await failureMessage();
    } finally {
      await driver.query('reset role');
    }
  }

  it('stops, saying what it needs, when an empty _prisma beside the schema of a release candidate is owned by another role', {
    timeout: testTimeout,
  }, async () => {
    await createReleaseCandidateTables();
    await giveReleaseCandidateTablesTo('prisma_migrator');
    await driver.query('create schema _prisma authorization prisma_rc_owner');

    const message = await failureMessageAs('prisma_migrator');

    expect(message).toContain(
      'The role that runs this command must have the privileges of the role that owns schema "_prisma"',
    );
    expect(message).toContain('ALTER SCHEMA "_prisma" OWNER TO <migrating role>');
    expect(await schemas()).toEqual(['_prisma', 'prisma_contract']);
  });

  /** The development server records every DDL statement in its own schema, so a role that is not a superuser needs access to it to change the schema at all. */
  async function allowDevelopmentServerLog(verb: 'grant' | 'revoke', preposition: 'to' | 'from') {
    await driver.query(`${verb} usage on schema _prisma_dev_wal ${preposition} prisma_migrator`);
    await driver.query(
      `${verb} all on all tables in schema _prisma_dev_wal ${preposition} prisma_migrator`,
    );
    await driver.query(
      `${verb} all on all sequences in schema _prisma_dev_wal ${preposition} prisma_migrator`,
    );
  }

  it('drops an empty _prisma the role owns beside the schema of a release candidate, then renames, when the role owns the old schema and its tables', {
    timeout: testTimeout,
  }, async () => {
    await createReleaseCandidateTables();
    await giveReleaseCandidateTablesTo('prisma_migrator');
    await driver.query('create schema _prisma authorization prisma_migrator');
    const { rows } = await driver.query<{ name: string }>('select current_database() as name');
    const database = `"${rows[0]?.name}"`;
    await driver.query(`grant create on database ${database} to prisma_migrator`);
    await allowDevelopmentServerLog('grant', 'to');

    await driver.query('set role prisma_migrator');
    let result: Awaited<ReturnType<typeof apply>>;
    try {
      result = await apply();
    } finally {
      await driver.query('reset role');
      await driver.query(`revoke create on database ${database} from prisma_migrator`);
      await allowDevelopmentServerLog('revoke', 'from');
    }

    expect(result.ok ? result.value.outcome : result.failure).toBe('applied');
    expect({ schemas: await schemas(), tables: await tablesIn('_prisma') }).toEqual({
      schemas: ['_prisma'],
      tables: ['config', 'contract', 'ledger', 'signatures'],
    });
  });

  it("stops, saying what it needs, when the role owns the release candidate's schema but not a table in it", {
    timeout: testTimeout,
  }, async () => {
    await createReleaseCandidateTables();
    await giveReleaseCandidateTablesTo('prisma_migrator');
    await driver.query('alter table prisma_contract.ledger owner to prisma_rc_owner');

    const message = await failureMessageAs('prisma_migrator');

    expect(message).toContain(
      'The role that runs this command must have the privileges of the role that owns table "prisma_contract"."ledger"',
    );
    expect(message).toContain('ALTER TABLE "prisma_contract"."ledger" OWNER TO <migrating role>');
    expect(await schemas()).toEqual(['prisma_contract']);
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
    expect({ tables: await tablesIn('_prisma'), signatures: await signatures() }).toEqual({
      tables: ['config', 'contract', 'ledger', 'signatures'],
      signatures: [
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
      'Table "prisma_contract"."ledger", which the release candidates of Prisma 8 created, must have column "migration_name" of type text, NOT NULL.',
    );
    expect(await schemas()).toEqual(['prisma_contract']);
  });

  it('stops on a column of another nullability', { timeout: testTimeout }, async () => {
    for (const statement of releaseCandidatePrismaTables) await driver.query(statement);
    await driver.query('alter table prisma_contract.marker alter column app_tag set not null');

    expect(await failureMessage()).toContain('must have column "app_tag" of type text, nullable.');
    expect(await schemas()).toEqual(['prisma_contract']);
  });

  it('names the table in _prisma, and no release, when a table there has another form', {
    timeout: testTimeout,
  }, async () => {
    await driver.query('create schema _prisma');
    await driver.query('create table _prisma.ledger (id int)');

    const message = await failureMessage();

    expect(message).toContain(
      'Table "_prisma"."ledger" must have column "id" of type bigint, NOT NULL.',
    );
    expect(message).not.toContain('release candidates');
  });

  it('stops at the column checks, naming the table, when _prisma holds a marker table Prisma did not create', {
    timeout: testTimeout,
  }, async () => {
    await driver.query('create schema _prisma');
    await driver.query('create table _prisma.marker (space text primary key, note text)');

    const message = await failureMessage();

    expect(message).toContain(
      'Table "_prisma"."marker" must have column "core_hash" of type text, NOT NULL.',
    );
    expect(await tablesIn('_prisma')).toEqual(['marker']);
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

    expect(message).toContain(
      'The role that runs this command must have the privileges of the role that owns schema "prisma_contract"',
    );
    expect(message).toContain('ALTER SCHEMA "prisma_contract" OWNER TO <migrating role>');
    expect(message).toContain('ALTER TABLE "prisma_contract"."contract" OWNER TO <migrating role>');
    expect(message).not.toContain('CREATE privilege');
    expect(await schemas()).toEqual(['prisma_contract']);
  });

  it("stops, saying what it needs, when the role owns the release candidate's schema but may not create in the database", {
    timeout: testTimeout,
  }, async () => {
    await createReleaseCandidateTables();
    await giveReleaseCandidateTablesTo('prisma_migrator');
    const { rows } = await driver.query<{ name: string }>('select current_database() as name');
    const database = `"${rows[0]?.name}"`;
    await driver.query(`revoke create on database ${database} from public`);

    await driver.query('set role prisma_migrator');
    let message: string;
    try {
      message = await failureMessage();
    } finally {
      await driver.query('reset role');
      await driver.query(`grant create on database ${database} to public`);
    }

    expect(message).toContain(
      'The role that runs this command must have the CREATE privilege on the database',
    );
    expect(message).toContain('GRANT CREATE ON DATABASE <database> TO <migrating role>');
    expect(message).not.toContain('privileges of the role that owns');
    expect(await schemas()).toEqual(['prisma_contract']);
  });

  it('applies nothing when a later release brought the space further', {
    timeout: testTimeout,
  }, async () => {
    await apply();
    await driver.query(
      "update _prisma.signatures set core_hash = 'later-release' where space = '_prisma'",
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
