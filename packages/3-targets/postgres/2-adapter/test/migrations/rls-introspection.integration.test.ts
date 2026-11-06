import { normalizeSqlBody } from '@internal/sql-schema-ir/naming';
import { computeContentHash } from '@internal/target-postgres/rls-canonicalize';
import {
  PostgresDatabaseSchemaNode,
  PostgresPolicySchemaNode,
} from '@internal/target-postgres/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDriver,
  createTestDatabase,
  familyInstance,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

describe('RLS introspection', { concurrent: false }, () => {
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

  it('returns rlsPolicies with verbatim policyname and correct namespaceId', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE posts (id int PRIMARY KEY, user_id int NOT NULL)');
    await driver!.query('ALTER TABLE posts ENABLE ROW LEVEL SECURITY');

    const expectedHash = computeContentHash({
      using: normalizeSqlBody('user_id = 1'),
      roles: ['public'],
      operation: 'select',
      permissive: true,
    });
    const wireName = `posts_select_own_${expectedHash}`;
    await driver!.query(
      `CREATE POLICY ${wireName} ON posts
         AS PERMISSIVE FOR SELECT TO PUBLIC
         USING (user_id = 1)`,
    );

    const schema = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(schema);

    const rlsPolicies = Object.values(schema.namespaces['public']!.tables).flatMap(
      (t) => t.policies,
    );

    expect(rlsPolicies).toBeDefined();
    expect(Array.isArray(rlsPolicies)).toBe(true);
    expect(rlsPolicies.length).toBeGreaterThanOrEqual(1);

    const policy = rlsPolicies.find((p) => p.tableName === 'posts');
    expect(policy).toBeDefined();
    expect(policy).toBeInstanceOf(PostgresPolicySchemaNode);

    // Introspect reads policyname verbatim from pg_policies — no hash recompute.
    expect(policy!.name).toBe(wireName);
    expect(policy!.prefix).toBe('posts_select_own');

    // namespaceId must reflect the real schema, not UNBOUND_NAMESPACE_ID.
    expect(policy!.namespaceId).toBe('public');
    expect(policy!.operation).toBe('select');
    expect(policy!.permissive).toBe(true);
  });

  it('stamps prefix undefined for a live policy whose name is not wire-shaped', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE posts (id int PRIMARY KEY, user_id int NOT NULL)');
    await driver!.query('ALTER TABLE posts ENABLE ROW LEVEL SECURITY');
    await driver!.query(
      `CREATE POLICY "Tenant members can read" ON posts
         AS PERMISSIVE FOR SELECT TO PUBLIC
         USING (user_id = 1)`,
    );

    const schema = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(schema);

    const policy = Object.values(schema.namespaces['public']!.tables)
      .flatMap((t) => t.policies)
      .find((p) => p.name === 'Tenant members can read');
    expect(policy).toBeDefined();
    expect(policy!.prefix).toBeUndefined();
    expect(Object.hasOwn(policy!, 'prefix')).toBe(false);
  });

  it('stamps rlsEnabled per table from pg_class.relrowsecurity', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE guarded (id int PRIMARY KEY)');
    await driver!.query('CREATE TABLE open_wide (id int PRIMARY KEY)');
    await driver!.query('ALTER TABLE guarded ENABLE ROW LEVEL SECURITY');

    const schema = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(schema);

    const tables = schema.namespaces['public']!.tables;
    expect(tables['guarded']?.rlsEnabled).toBe(true);
    expect(tables['open_wide']?.rlsEnabled).toBe(false);
  });

  it('stamps rlsEnabled on a partitioned parent table (relkind p)', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(
      'CREATE TABLE events (id int NOT NULL, region text NOT NULL) PARTITION BY LIST (region)',
    );
    await driver!.query("CREATE TABLE events_eu PARTITION OF events FOR VALUES IN ('eu')");
    await driver!.query('ALTER TABLE events ENABLE ROW LEVEL SECURITY');

    const schema = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(schema);

    expect(schema.namespaces['public']!.tables['events']?.rlsEnabled).toBe(true);
  });

  it('returns roles excluding system roles', {
    timeout: testTimeout,
  }, async () => {
    const schema = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(schema);

    const { roles } = schema;

    // roles may be empty if the only non-system role is 'postgres' (filtered out).
    expect(Array.isArray(roles)).toBe(true);

    for (const role of roles) {
      expect(role.name).not.toMatch(/^pg_/);
    }
  });
});
