import type { ControlStack } from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createMysqlControlAdapter } from '../src/core/migrations/control-adapter';
import type { MysqlCatalogRows } from '../src/core/migrations/introspection';
import { createAdapter, recordingDriver } from './helpers';

const stack = {
  target: { targetId: 'mariadb' },
  extensions: [],
  declaredDataTypes: [],
} as unknown as ControlStack<'sql', 'mariadb'>;

const catalog: MysqlCatalogRows = {
  tables: ['T'],
  columns: [
    {
      table_name: 'T',
      column_name: 'id',
      ordinal_position: '1',
      column_default: null,
      is_nullable: 'NO',
      column_type: 'int',
      extra: '',
    },
  ],
  indexes: [],
  constraints: [],
  foreignKeys: [],
};

describe('the control adapter of a target that extends MySQL', () => {
  it('carries the target id of its stack and introspects through the catalog reader it is given', async () => {
    const readers: SqlControlDriverInstance<string>[] = [];
    const adapter = createMysqlControlAdapter(stack, {
      readCatalog: async (driver) => {
        readers.push(driver);
        return catalog;
      },
    });
    const driver = { ...recordingDriver(), targetId: 'mariadb' as const };
    const schema = (await adapter.introspect(driver)) as SqlSchemaIR;
    expect({
      targetId: adapter.targetId,
      readWith: readers.map(({ targetId }) => targetId),
      tables: Object.keys(schema.tables),
      statements: driver.statements,
    }).toEqual({ targetId: 'mariadb', readWith: ['mariadb'], tables: ['T'], statements: [] });
  });
});

describe('the marker upsert', () => {
  const columns =
    'core_hash = ?, profile_hash = ?, contract_json = NULL, canonical_version = NULL, updated_at = CURRENT_TIMESTAMP(3), app_tag = NULL, invariants = ?';
  const insert =
    'INSERT INTO `_prisma_marker` (space, core_hash, profile_hash, contract_json, canonical_version, updated_at, app_tag, meta, invariants) VALUES (?, ?, ?, NULL, NULL, CURRENT_TIMESTAMP(3), NULL, ?, ?)';

  function recordUpsert() {
    const calls: { sql: string; params: readonly unknown[] }[] = [];
    const driver = recordingDriver((sql, params) => {
      calls.push({ sql, params });
      return [];
    });
    return { calls, driver };
  }

  it('binds its values a second time for the update, naming no row alias, and keeps the stored meta, so MySQL and MariaDB both run it', async () => {
    const { calls, driver } = recordUpsert();
    await createAdapter().initMarker(driver, 'app', {
      storageHash: 'sha256:a',
      profileHash: 'sha256:p',
      invariants: ['inv'],
    });
    expect(calls).toEqual([
      {
        sql: `${insert} ON DUPLICATE KEY UPDATE ${columns}`,
        params: ['app', 'sha256:a', 'sha256:p', '{}', '["inv"]', 'sha256:a', 'sha256:p', '["inv"]'],
      },
    ]);
  });

  it('sets only the policies in the stored meta when the destination records them', async () => {
    const { calls, driver } = recordUpsert();
    await createAdapter().initMarker(driver, 'app', {
      storageHash: 'sha256:a',
      profileHash: 'sha256:p',
      databasePolicies: {
        change: ['migrate'],
        dataProtection: {
          dataLoss: 'data-loss-forbidden',
          accessWidening: 'access-widening-with-consent',
        },
      },
    });
    const policies =
      '{"change":["migrate"],"dataProtection":{"dataLoss":"data-loss-forbidden","accessWidening":"access-widening-with-consent"}}';
    expect(calls).toEqual([
      {
        sql: `${insert} ON DUPLICATE KEY UPDATE ${columns}, meta = JSON_SET(meta, '$.policies', JSON_EXTRACT(?, '$'))`,
        params: [
          'app',
          'sha256:a',
          'sha256:p',
          `{"policies":${policies}}`,
          '[]',
          'sha256:a',
          'sha256:p',
          '[]',
          policies,
        ],
      },
    ]);
  });
});
