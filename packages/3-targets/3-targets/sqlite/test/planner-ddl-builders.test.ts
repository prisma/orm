import type { StorageColumn, StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import {
  buildColumnTypeSql,
  buildCreateIndexSql,
  buildDropIndexSql,
  isInlineAutoincrementPrimaryKey,
  renderDefaultLiteral,
} from '../src/core/migrations/planner-ddl-builders';

function makeColumn(overrides: Partial<StorageColumn> = {}): StorageColumn {
  return {
    nativeType: 'text',
    nullable: true,
    codecId: 'sqlite/text@1',
    ...overrides,
  };
}

function makeTable(overrides: Partial<StorageTable> = {}): StorageTable {
  return {
    columns: {},
    foreignKeys: [],
    uniques: [],
    indexes: [],
    ...overrides,
  };
}

describe('buildColumnTypeSql', () => {
  it('uppercases native type', () => {
    expect(buildColumnTypeSql(makeColumn({ nativeType: 'text' }))).toBe('TEXT');
    expect(buildColumnTypeSql(makeColumn({ nativeType: 'integer' }))).toBe('INTEGER');
    expect(buildColumnTypeSql(makeColumn({ nativeType: 'real' }))).toBe('REAL');
    expect(buildColumnTypeSql(makeColumn({ nativeType: 'blob' }))).toBe('BLOB');
  });

  it('resolves typeRef against storageTypes', () => {
    const column = makeColumn({ nativeType: 'unused', typeRef: 'my_type' });
    const sql = buildColumnTypeSql(column, {
      my_type: {
        kind: 'codec-instance',
        codecId: 'sqlite/text@1',
        nativeType: 'text',
        typeParams: {},
      },
    });
    expect(sql).toBe('TEXT');
  });

  it('rejects unsafe native types', () => {
    expect(() => buildColumnTypeSql(makeColumn({ nativeType: 'TEXT; DROP' }))).toThrow(/Unsafe/);
  });
});

describe('renderDefaultLiteral', () => {
  it('renders Date as ISO8601 string', () => {
    const d = new Date('2024-01-15T10:30:00.000Z');
    expect(renderDefaultLiteral(d)).toBe("'2024-01-15T10:30:00.000Z'");
  });

  it('renders JSON objects', () => {
    expect(renderDefaultLiteral({ key: 'val' })).toBe('\'{"key":"val"}\'');
  });
});

describe('buildCreateIndexSql', () => {
  it('generates CREATE INDEX', () => {
    expect(buildCreateIndexSql('users', 'idx_users_email', ['email'])).toBe(
      'CREATE INDEX "idx_users_email" ON "users" ("email")',
    );
  });

  it('generates CREATE UNIQUE INDEX', () => {
    expect(buildCreateIndexSql('users', 'idx_users_email', ['email'], true)).toBe(
      'CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email")',
    );
  });

  it('handles multi-column index', () => {
    expect(buildCreateIndexSql('t', 'idx_t_a_b', ['a', 'b'])).toBe(
      'CREATE INDEX "idx_t_a_b" ON "t" ("a", "b")',
    );
  });
});

describe('buildDropIndexSql', () => {
  it('generates DROP INDEX IF EXISTS', () => {
    expect(buildDropIndexSql('idx_users_email')).toBe('DROP INDEX IF EXISTS "idx_users_email"');
  });
});

describe('isInlineAutoincrementPrimaryKey', () => {
  it('is true for sole-column PK with autoincrement() default', () => {
    const table = makeTable({
      columns: {
        id: makeColumn({
          nativeType: 'integer',
          nullable: false,
          default: { kind: 'function', expression: 'autoincrement()' },
        }),
      },
      primaryKey: { columns: ['id'] },
    });
    expect(isInlineAutoincrementPrimaryKey(table, 'id')).toBe(true);
  });

  it('is false when the column is not in the primary key', () => {
    const table = makeTable({
      columns: {
        id: makeColumn({ nativeType: 'integer', nullable: false }),
        seq: makeColumn({
          nativeType: 'integer',
          nullable: false,
          default: { kind: 'function', expression: 'autoincrement()' },
        }),
      },
      primaryKey: { columns: ['id'] },
    });
    expect(isInlineAutoincrementPrimaryKey(table, 'seq')).toBe(false);
  });

  it('is false for composite primary keys', () => {
    const table = makeTable({
      columns: {
        a: makeColumn({
          nativeType: 'integer',
          nullable: false,
          default: { kind: 'function', expression: 'autoincrement()' },
        }),
        b: makeColumn({ nativeType: 'integer', nullable: false }),
      },
      primaryKey: { columns: ['a', 'b'] },
    });
    expect(isInlineAutoincrementPrimaryKey(table, 'a')).toBe(false);
  });

  it('is false when default is not autoincrement()', () => {
    const table = makeTable({
      columns: {
        id: makeColumn({ nativeType: 'integer', nullable: false }),
      },
      primaryKey: { columns: ['id'] },
    });
    expect(isInlineAutoincrementPrimaryKey(table, 'id')).toBe(false);
  });
});
