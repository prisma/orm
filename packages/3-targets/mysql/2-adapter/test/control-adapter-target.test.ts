import type { ControlStack } from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createMysqlControlAdapter } from '../src/core/migrations/control-adapter';
import type { MysqlCatalogRows } from '../src/core/migrations/introspection';
import { createAdapter, recordingDriver } from './helpers';

const stack = {
  target: {},
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
  it('carries the target id it is given and introspects through the catalog reader it is given', async () => {
    const readers: SqlControlDriverInstance<string>[] = [];
    const adapter = createMysqlControlAdapter(stack, {
      targetId: 'mariadb',
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
  it('binds its values a second time for the update, naming no row alias, so MySQL and MariaDB both run it', async () => {
    const calls: { sql: string; params: readonly unknown[] }[] = [];
    const driver = recordingDriver((sql, params) => {
      calls.push({ sql, params });
      return [];
    });
    await createAdapter().initMarker(driver, 'app', {
      storageHash: 'sha256:a',
      profileHash: 'sha256:p',
      invariants: ['inv'],
    });
    expect(calls).toEqual([
      {
        sql: "INSERT INTO `_prisma_marker` (space, core_hash, profile_hash, contract_json, canonical_version, updated_at, app_tag, meta, invariants) VALUES (?, ?, ?, NULL, NULL, CURRENT_TIMESTAMP(3), NULL, '{}', ?) ON DUPLICATE KEY UPDATE core_hash = ?, profile_hash = ?, contract_json = NULL, canonical_version = NULL, updated_at = CURRENT_TIMESTAMP(3), app_tag = NULL, meta = '{}', invariants = ?",
        params: ['app', 'sha256:a', 'sha256:p', '["inv"]', 'sha256:a', 'sha256:p', '["inv"]'],
      },
    ]);
  });
});
