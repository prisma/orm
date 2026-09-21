import type { StorageColumn, StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import {
  buildColumnDefaultSql,
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

describe('buildColumnDefaultSql', () => {
  it('returns empty for no default', () => {
    expect(buildColumnDefaultSql(undefined)).toBe('');
  });

  it('renders literal string default', () => {
    expect(buildColumnDefaultSql({ kind: 'literal', value: 'hello' })).toBe("DEFAULT 'hello'");
  });

  it('renders literal number default', () => {
    expect(buildColumnDefaultSql({ kind: 'literal', value: 42 })).toBe('DEFAULT 42');
  });

  it('renders literal boolean as 0/1', () => {
    expect(buildColumnDefaultSql({ kind: 'literal', value: true })).toBe('DEFAULT 1');
    expect(buildColumnDefaultSql({ kind: 'literal', value: false })).toBe('DEFAULT 0');
  });

  it('renders NULL literal', () => {
    expect(buildColumnDefaultSql({ kind: 'literal', value: null })).toBe('DEFAULT NULL');
  });

  it("renders now() as datetime('now')", () => {
    expect(buildColumnDefaultSql({ kind: 'function', expression: 'now()' })).toBe(
      "DEFAULT (datetime('now'))",
    );
  });

  it('returns empty for autoincrement()', () => {
    expect(buildColumnDefaultSql({ kind: 'function', expression: 'autoincrement()' })).toBe('');
  });

  it('renders custom function default', () => {
    expect(buildColumnDefaultSql({ kind: 'function', expression: 'random()' })).toBe(
      'DEFAULT (random())',
    );
  });

  it('renders a tagged-literal body verbatim inside DEFAULT (...)', () => {
    expect(buildColumnDefaultSql({ kind: 'function', expression: 'CURRENT_TIMESTAMP' })).toBe(
      'DEFAULT (CURRENT_TIMESTAMP)',
    );
  });

  it('rejects a dollar-quoted body with CONTRACT.DEFAULT_INVALID, the same rule as Postgres', () => {
    expect(() => buildColumnDefaultSql({ kind: 'function', expression: '$$x$$' })).toThrow(
      expect.objectContaining({ code: 'CONTRACT.DEFAULT_INVALID' }),
    );
  });

  it('rejects unsafe default expressions', () => {
    expect(() =>
      buildColumnDefaultSql({ kind: 'function', expression: 'foo(); DROP TABLE' }),
    ).toThrow(/Unsafe/);
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
