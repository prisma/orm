/**
 * Postgres index introspection populates `SqlIndexIR.type` and
 * `SqlIndexIR.options` from `pg_am.amname` and `pg_class.reloptions`.
 *
 * Without these fields the migration planner would treat any contract
 * index whose `type` is set as different from any introspected index on
 * the same columns — forcing a spurious DROP+CREATE on every plan even
 * when the live index already matches the contract.
 */
import { PostgresDatabaseSchemaNode } from '@internal/target-postgres/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDriver,
  createTestDatabase,
  familyInstance,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

describe('Postgres index introspection — type and options', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) await database.close();
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  it('leaves type and options unset on a default btree index', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE doc (id int PRIMARY KEY, body text NOT NULL)');
    await driver!.query('CREATE INDEX doc_body_idx ON doc (body)');

    const result = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(result);
    const ns = result.namespaces['public']!;
    const indexes = ns.tables['doc']?.indexes ?? [];
    const idx = indexes.find((i) => i.name === 'doc_body_idx');
    expect(idx).toBeDefined();
    expect(idx?.type).toBeUndefined();
    expect(idx?.options).toBeUndefined();
  });

  it('populates type for non-default index methods (gin)', { timeout: testTimeout }, async () => {
    await driver!.query('CREATE TABLE doc (id int PRIMARY KEY, tags jsonb NOT NULL)');
    await driver!.query('CREATE INDEX doc_tags_gin_idx ON doc USING gin (tags)');

    const result = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(result);
    const ns = result.namespaces['public']!;
    const idx = ns.tables['doc']?.indexes.find((i) => i.name === 'doc_tags_gin_idx');
    expect(idx).toBeDefined();
    expect(idx?.type).toBe('gin');
    expect(idx?.options).toBeUndefined();
  });

  it('populates options from reloptions when WITH parameters are set', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE doc (id int PRIMARY KEY, body text NOT NULL)');
    await driver!.query('CREATE INDEX doc_body_idx ON doc (body) WITH (fillfactor = 70)');

    const result = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(result);
    const ns = result.namespaces['public']!;
    const idx = ns.tables['doc']?.indexes.find((i) => i.name === 'doc_body_idx');
    expect(idx).toBeDefined();
    // btree is the Postgres default → type is dropped to undefined
    expect(idx?.type).toBeUndefined();
    // reloptions are returned as raw text; the family verifier compares
    // contract values to introspected strings via String() coercion.
    expect(idx?.options).toEqual({ fillfactor: '70' });
  });

  it('populates both type and options together (gin with fastupdate)', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE doc (id int PRIMARY KEY, tags jsonb NOT NULL)');
    await driver!.query(
      'CREATE INDEX doc_tags_gin_idx ON doc USING gin (tags) WITH (fastupdate = false)',
    );

    const result = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(result);
    const ns = result.namespaces['public']!;
    const idx = ns.tables['doc']?.indexes.find((i) => i.name === 'doc_tags_gin_idx');
    expect(idx).toBeDefined();
    expect(idx?.type).toBe('gin');
    expect(idx?.options).toEqual({ fastupdate: 'false' });
  });

  it('stamps partial: true on a partial unique index and partial: false on total indexes', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(
      'CREATE TABLE doc (id int PRIMARY KEY, owner_id int NOT NULL, archived boolean NOT NULL)',
    );
    await driver!.query('CREATE UNIQUE INDEX doc_owner_total_idx ON doc (owner_id)');
    await driver!.query(
      'CREATE UNIQUE INDEX doc_owner_active_idx ON doc (owner_id, archived) WHERE NOT archived',
    );

    const result = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(result);
    const ns = result.namespaces['public']!;
    const indexes = ns.tables['doc']?.indexes ?? [];
    const totalIdx = indexes.find((i) => i.name === 'doc_owner_total_idx');
    const partialIdx = indexes.find((i) => i.name === 'doc_owner_active_idx');
    expect(totalIdx?.partial).toBe(false);
    expect(partialIdx?.partial).toBe(true);
    // Partiality stays out of JSON so serialized schema snapshots and differ
    // semantics are unchanged.
    expect(JSON.parse(JSON.stringify(partialIdx))).not.toHaveProperty('partial');
    expect(JSON.parse(JSON.stringify(totalIdx))).not.toHaveProperty('partial');
  });

  // Regression: composite index columns must be reported in the order they
  // appear in the index definition, not in the order they appear in the
  // table. Verification compares `columns` to the contract index columns
  // using order-sensitive equality, so a shuffled order produces a spurious
  // `index_mismatch` and breaks `prisma db init` on a fresh database
  // whenever the index column order differs from the table column order.
  it('reports composite index columns in index order, not table order', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(
      `CREATE TABLE sync_run (
         id int PRIMARY KEY,
         started_at timestamptz NOT NULL,
         source text NOT NULL,
         entity text NOT NULL
       )`,
    );
    await driver!.query(
      'CREATE INDEX sync_run_lookup_idx ON sync_run (source, entity, started_at)',
    );

    const result = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(result);
    const ns = result.namespaces['public']!;
    const idx = ns.tables['sync_run']?.indexes.find((i) => i.name === 'sync_run_lookup_idx');
    expect(idx).toBeDefined();
    expect(idx?.columns).toEqual(['source', 'entity', 'started_at']);
  });

  it('captures an expression index at full fidelity (whole element list, reprinted)', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE doc (id int PRIMARY KEY, email text NOT NULL)');
    await driver!.query('CREATE INDEX doc_email_lower_idx ON doc (lower(email))');
    await driver!.query('CREATE INDEX doc_mixed_idx ON doc (id, lower(email))');

    const result = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(result);
    const indexes = result.namespaces['public']!.tables['doc']?.indexes ?? [];

    const pureExpression = indexes.find((i) => i.name === 'doc_email_lower_idx');
    expect(pureExpression?.expression).toBe('lower(email)');
    expect(pureExpression?.columns).toBeUndefined();
    expect(pureExpression?.where).toBeUndefined();
    expect(pureExpression?.partial).toBe(false);

    // A single expression element makes the whole index an expression node:
    // real columns ride inside the one opaque element-list string.
    const mixed = indexes.find((i) => i.name === 'doc_mixed_idx');
    expect(mixed?.expression).toBe('id, lower(email)');
    expect(mixed?.columns).toBeUndefined();
  });

  it('captures a partial index predicate as the Postgres reprint', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(
      'CREATE TABLE doc (id int PRIMARY KEY, email text NOT NULL, deleted_at timestamptz)',
    );
    await driver!.query(
      'CREATE UNIQUE INDEX doc_email_active_idx ON doc (email) WHERE deleted_at IS NULL',
    );

    const result = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(result);
    const idx = result.namespaces['public']!.tables['doc']?.indexes.find(
      (i) => i.name === 'doc_email_active_idx',
    );
    expect(idx?.columns).toEqual(['email']);
    expect(idx?.where).toBe('(deleted_at IS NULL)');
    expect(idx?.partial).toBe(true);
    expect(idx?.unique).toBe(true);
  });

  it('stamps prefix from a wire-shaped name and leaves it absent otherwise', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE doc (id int PRIMARY KEY, email text NOT NULL)');
    await driver!.query('CREATE INDEX doc_email_idx_deadbeef ON doc (email)');
    await driver!.query('CREATE INDEX doc_email_plain ON doc (email)');

    const result = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(result);
    const indexes = result.namespaces['public']!.tables['doc']?.indexes ?? [];
    expect(indexes.find((i) => i.name === 'doc_email_idx_deadbeef')?.prefix).toBe('doc_email_idx');
    expect(indexes.find((i) => i.name === 'doc_email_plain')?.prefix).toBeUndefined();
  });

  it('preserves same-tuple twins as distinct siblings', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE pair (id int PRIMARY KEY, email text NOT NULL)');
    await driver!.query('CREATE UNIQUE INDEX pair_email_unique_idx ON pair (email)');
    await driver!.query('CREATE INDEX pair_email_plain_idx ON pair (email)');

    const result = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(result);
    const indexes = result.namespaces['public']!.tables['pair']?.indexes ?? [];
    expect(indexes).toHaveLength(2);
    expect(indexes.map((i) => ({ name: i.name, unique: i.unique }))).toEqual(
      expect.arrayContaining([
        { name: 'pair_email_unique_idx', unique: true },
        { name: 'pair_email_plain_idx', unique: false },
      ]),
    );
  });
});
