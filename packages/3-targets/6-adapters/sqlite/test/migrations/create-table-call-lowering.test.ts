/**
 * Pins the SQL output of `CreateTableCall.toOp(lowerer)` for the supported
 * column/constraint shapes. Each test verifies `execute[0].sql` matches the
 * expected DDL string for a representative schema fragment.
 */

import type { DdlColumn, DdlTableConstraint } from '@internal/sql-relational-core/ast';
import {
  col,
  fn,
  foreignKey,
  lit,
  primaryKey,
  unique,
} from '@internal/sql-relational-core/contract-free';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { CreateTableCall } from '@internal/target-sqlite/op-factory-call';
import { describe, expect, it } from 'vitest';
import type { SqliteTableSpec } from '../../../../3-targets/sqlite/src/core/migrations/operations/shared';
// Pre-slice oracle: the createTable function and SqliteTableSpec type from the
// internal tables module (kept on disk for Phase 2 recreateTable use).
import { createTable as preSliceCreateTableOp } from '../../../../3-targets/sqlite/src/core/migrations/operations/tables';
import { SqliteControlAdapter } from '../../src/exports/control';

const lowerer = new SqliteControlAdapter(createSqliteBuiltinCodecLookup());

async function oracleSql(tableName: string, spec: SqliteTableSpec): Promise<string> {
  const op = await preSliceCreateTableOp(tableName, spec, lowerer);
  const sql = op.execute[0]?.sql;
  if (sql === undefined) throw new Error('createTable op produced no execute step');
  return sql;
}

async function newPathSql(
  tableName: string,
  columns: readonly DdlColumn[],
  constraints?: readonly DdlTableConstraint[],
): Promise<string> {
  const call = new CreateTableCall(tableName, columns, constraints);
  const op = await call.toOp(lowerer);
  const sql = op.execute[0]?.sql;
  if (sql === undefined) throw new Error('CreateTableCall.toOp produced no execute step');
  return sql;
}

describe('CreateTableCall lowering output', () => {
  it('simple table: NOT NULL and nullable columns, no constraints', async () => {
    const tableName = 'tags';

    const spec: SqliteTableSpec = {
      columns: [
        { name: 'id', typeSql: 'INTEGER', nullable: false },
        { name: 'name', typeSql: 'TEXT', nullable: true },
      ],
    };
    const columns = [col('id', 'INTEGER', { notNull: true }), col('name', 'TEXT')];

    expect(await newPathSql(tableName, columns)).toBe(await oracleSql(tableName, spec));
  });

  it('composite primary key: two NOT NULL columns with table-level PK constraint', async () => {
    const tableName = 'memberships';

    const spec: SqliteTableSpec = {
      columns: [
        { name: 'user_id', typeSql: 'INTEGER', nullable: false },
        { name: 'group_id', typeSql: 'INTEGER', nullable: false },
      ],
      primaryKey: { columns: ['user_id', 'group_id'] },
    };
    const columns = [
      col('user_id', 'INTEGER', { notNull: true }),
      col('group_id', 'INTEGER', { notNull: true }),
    ];
    const constraints = [primaryKey(['user_id', 'group_id'])];

    expect(await newPathSql(tableName, columns, constraints)).toBe(
      await oracleSql(tableName, spec),
    );
  });

  it('table-level UNIQUE constraints (named and unnamed)', async () => {
    const tableName = 'profiles';

    const spec: SqliteTableSpec = {
      columns: [
        { name: 'id', typeSql: 'INTEGER', nullable: false },
        { name: 'username', typeSql: 'TEXT', nullable: false },
        { name: 'email', typeSql: 'TEXT', nullable: false },
      ],
      primaryKey: { columns: ['id'] },
      uniques: [{ columns: ['username'] }, { columns: ['email'], name: 'uq_profiles_email' }],
    };
    const columns = [
      col('id', 'INTEGER', { notNull: true }),
      col('username', 'TEXT', { notNull: true }),
      col('email', 'TEXT', { notNull: true }),
    ];
    const constraints = [
      primaryKey(['id']),
      unique(['username']),
      unique(['email'], { name: 'uq_profiles_email' }),
    ];

    expect(await newPathSql(tableName, columns, constraints)).toBe(
      await oracleSql(tableName, spec),
    );
  });

  it('foreign key with ON DELETE CASCADE referential action', async () => {
    const tableName = 'posts';

    const spec: SqliteTableSpec = {
      columns: [
        { name: 'id', typeSql: 'INTEGER', nullable: false },
        { name: 'author_id', typeSql: 'INTEGER', nullable: false },
        { name: 'title', typeSql: 'TEXT', nullable: false },
      ],
      primaryKey: { columns: ['id'] },
      foreignKeys: [
        {
          columns: ['author_id'],
          references: { table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      ],
    };
    const columns = [
      col('id', 'INTEGER', { notNull: true }),
      col('author_id', 'INTEGER', { notNull: true }),
      col('title', 'TEXT', { notNull: true }),
    ];
    const constraints = [
      primaryKey(['id']),
      foreignKey(['author_id'], 'users', ['id'], { onDelete: 'cascade' }),
    ];

    expect(await newPathSql(tableName, columns, constraints)).toBe(
      await oracleSql(tableName, spec),
    );
  });

  it('autoincrement primary key: INTEGER PRIMARY KEY AUTOINCREMENT inline', async () => {
    const tableName = 'events';

    const spec: SqliteTableSpec = {
      columns: [
        {
          name: 'id',
          typeSql: 'INTEGER',
          nullable: false,
          inlineAutoincrementPrimaryKey: true,
        },
        { name: 'payload', typeSql: 'TEXT', nullable: true },
      ],
    };
    const columns = [col('id', 'INTEGER PRIMARY KEY AUTOINCREMENT'), col('payload', 'TEXT')];

    expect(await newPathSql(tableName, columns)).toBe(await oracleSql(tableName, spec));
  });

  it('string literal default', async () => {
    const tableName = 'settings';

    const spec: SqliteTableSpec = {
      columns: [
        {
          name: 'theme',
          typeSql: 'TEXT',
          default: { kind: 'literal', value: 'light' },
          nullable: true,
        },
      ],
    };
    const columns = [col('theme', 'TEXT', { default: lit('light') })];

    expect(await newPathSql(tableName, columns)).toBe(await oracleSql(tableName, spec));
  });

  it('number literal default', async () => {
    const tableName = 'limits';

    const spec: SqliteTableSpec = {
      columns: [
        {
          name: 'max_items',
          typeSql: 'INTEGER',
          default: { kind: 'literal', value: 10 },
          nullable: true,
        },
      ],
    };
    const columns = [col('max_items', 'INTEGER', { default: lit(10) })];

    expect(await newPathSql(tableName, columns)).toBe(await oracleSql(tableName, spec));
  });

  it('boolean literal default emitted as 0/1', async () => {
    const tableName = 'flags';

    const spec: SqliteTableSpec = {
      columns: [
        {
          name: 'enabled',
          typeSql: 'INTEGER',
          default: { kind: 'literal', value: true },
          nullable: true,
        },
        {
          name: 'deleted',
          typeSql: 'INTEGER',
          default: { kind: 'literal', value: false },
          nullable: true,
        },
      ],
    };
    const columns = [
      col('enabled', 'INTEGER', { default: lit(true) }),
      col('deleted', 'INTEGER', { default: lit(false) }),
    ];

    expect(await newPathSql(tableName, columns)).toBe(await oracleSql(tableName, spec));
  });

  it('null literal default', async () => {
    const tableName = 'items';

    const spec: SqliteTableSpec = {
      columns: [
        {
          name: 'notes',
          typeSql: 'TEXT',
          default: { kind: 'literal', value: null },
          nullable: true,
        },
      ],
    };
    const columns = [col('notes', 'TEXT', { default: lit(null) })];

    expect(await newPathSql(tableName, columns)).toBe(await oracleSql(tableName, spec));
  });

  it('Date literal default emitted as a single-quoted ISO string', async () => {
    const tableName = 'logs';
    const date = new Date('2025-01-01T00:00:00.000Z');

    const spec: SqliteTableSpec = {
      columns: [
        {
          name: 'created_at',
          typeSql: 'TEXT',
          default: { kind: 'literal', value: date },
          nullable: true,
        },
      ],
    };
    const columns = [col('created_at', 'TEXT', { default: lit(date) })];

    expect(await newPathSql(tableName, columns)).toBe(await oracleSql(tableName, spec));
  });

  it('JSON object literal default', async () => {
    const tableName = 'configs';

    const spec: SqliteTableSpec = {
      columns: [
        {
          name: 'settings',
          typeSql: 'TEXT',
          default: { kind: 'literal', value: { retries: 3 } },
          nullable: true,
        },
      ],
    };
    const columns = [col('settings', 'TEXT', { default: lit({ retries: 3 }) })];

    expect(await newPathSql(tableName, columns)).toBe(await oracleSql(tableName, spec));
  });

  it('function default (non-autoincrement)', async () => {
    const tableName = 'sessions';

    const spec: SqliteTableSpec = {
      columns: [
        {
          name: 'created_at',
          typeSql: 'TEXT',
          default: { kind: 'function', expression: "datetime('now')" },
          nullable: true,
        },
      ],
    };
    const columns = [col('created_at', 'TEXT', { default: fn("datetime('now')") })];

    expect(await newPathSql(tableName, columns)).toBe(await oracleSql(tableName, spec));
  });
});
