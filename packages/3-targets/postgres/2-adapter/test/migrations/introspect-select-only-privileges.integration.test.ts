import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import {
  type PostgresDatabaseSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { applicationDomainOf, createDevDatabase } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDriver,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  testTimeout,
} from './fixtures/runner-fixtures';

/**
 * Regression for db verify false negatives on SELECT-only tables
 * (TML-3035, finding: verify reported the Supabase pack's own
 * auth/storage constraints as not-found against a clean instance).
 *
 * `information_schema.table_constraints` hides constraints on tables where
 * the connecting role's only privilege is SELECT — its privilege filter is
 * `has_table_privilege(... 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
 * TRIGGER')` (no SELECT), while `information_schema.tables`/`columns` do
 * include SELECT. On a real Supabase database the connecting role can only
 * SELECT the platform's internal tables (auth.schema_migrations,
 * storage.migrations, ...), so introspection returned those tables with all
 * columns but zero constraints and verify flagged every declared PK /
 * unique / FK as missing. Introspection must read structure from
 * pg_catalog, which is not privilege-filtered.
 */

function buildWidgetContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('select-only'),
    storage: new SqlStorage({
      storageHash: coreHash('select-only'),
      namespaces: {
        appsch: postgresCreateNamespace({
          id: 'appsch',
          entries: {
            table: {
              widget: {
                columns: {
                  id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                  name: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
                  parent_id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: true },
                },
                primaryKey: { columns: ['id'] },
                uniques: [{ columns: ['name'] }],
                indexes: [{ name: 'widget_parent_id_idx', columns: ['parent_id'], unique: false }],
                foreignKeys: [
                  {
                    source: {
                      namespaceId: asNamespaceId('appsch'),
                      tableName: 'widget',
                      columns: ['parent_id'],
                    },
                    target: {
                      namespaceId: asNamespaceId('appsch'),
                      tableName: 'widget',
                      columns: ['id'],
                    },
                  },
                ],
              },
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

describe('introspection under SELECT-only privileges', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createDevDatabase();
    driver = await createDriver(database.connectionString);

    await driver.query('CREATE ROLE widget_owner NOLOGIN');
    await driver.query('CREATE ROLE select_only_reader NOLOGIN');
    await driver.query('CREATE SCHEMA appsch');
    await driver.query(`CREATE TABLE appsch.widget (
      id int4 NOT NULL,
      name text NOT NULL,
      parent_id int4,
      CONSTRAINT widget_pkey PRIMARY KEY (id),
      CONSTRAINT widget_name_key UNIQUE (name),
      CONSTRAINT widget_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES appsch.widget(id)
    )`);
    await driver.query('CREATE INDEX widget_parent_id_idx ON appsch.widget (parent_id)');
    await driver.query('ALTER TABLE appsch.widget OWNER TO widget_owner');
    await driver.query('GRANT USAGE ON SCHEMA appsch TO select_only_reader');
    await driver.query('GRANT SELECT ON appsch.widget TO select_only_reader');
    await driver.query('SET ROLE select_only_reader');
  }, testTimeout);

  afterAll(async () => {
    if (driver) {
      await driver.query('RESET ROLE');
      await driver.close();
    }
    if (database) await database.close();
  }, testTimeout);

  it(
    'a table the connecting role can only SELECT introspects with its PK, unique, FK, and index',
    async () => {
      const contract = buildWidgetContract();
      const introspected = (await familyInstance.introspect({
        driver,
        contract,
      })) as PostgresDatabaseSchemaNode;

      const table = introspected.namespaces['appsch']?.tables['widget'];
      expect(table).toBeDefined();
      expect(table?.primaryKey?.columns).toEqual(['id']);
      expect(table?.uniques.map((u) => u.columns)).toEqual([['name']]);
      expect(table?.foreignKeys).toHaveLength(1);
      expect(table?.foreignKeys[0]?.columns).toEqual(['parent_id']);
      expect(table?.foreignKeys[0]?.referencedTable).toBe('widget');
      expect(table?.foreignKeys[0]?.referencedColumns).toEqual(['id']);

      const indexNames = table?.indexes.map((i) => i.name);
      expect(indexNames).toContain('widget_parent_id_idx');
      expect(indexNames).not.toContain('widget_pkey');
      expect(indexNames).not.toContain('widget_name_key');
    },
    testTimeout,
  );

  it(
    'verify reports no missing constraints for a SELECT-only table',
    async () => {
      const contract = buildWidgetContract();
      const introspected = await familyInstance.introspect({ driver, contract });
      const verifyResult = familyInstance.verifySchema({
        contract,
        schema: introspected,
        strict: false,
        frameworkComponents,
      });

      if (!verifyResult.ok) {
        throw new Error(
          `verifySchema failed: ${JSON.stringify(verifyResult.schema.issues, null, 2)}`,
        );
      }
      expect(verifyResult.schema.issues).toEqual([]);
    },
    testTimeout,
  );
});
