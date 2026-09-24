import { describe, expect, it } from 'vitest';
import type {
  SqliteColumnSpec,
  SqliteTableSpec,
} from '../../src/core/migrations/operations/shared';
import {
  buildRecreatePostchecks,
  buildRecreateSummary,
} from '../../src/core/migrations/operations/tables';
import {
  actualColumn,
  columnDefault,
  expectedColumn,
  foreignKey,
  issue,
  primaryKey,
  unique,
} from './node-issue-helpers';

function colSpec(overrides: Partial<SqliteColumnSpec> = {}): SqliteColumnSpec {
  return {
    name: 'col',
    typeSql: 'TEXT',
    defaultSql: '',
    nullable: true,
    ...overrides,
  };
}

function tableSpec(overrides: Partial<SqliteTableSpec> = {}): SqliteTableSpec {
  return {
    columns: [colSpec()],
    uniques: [],
    foreignKeys: [],
    ...overrides,
  };
}

describe('buildRecreateSummary', () => {
  it('joins each issue path', () => {
    const summary = buildRecreateSummary('users', [
      issue({ path: ['database', 'users', 'column:a'] }),
      issue({ path: ['database', 'users', 'column:b'] }),
    ]);
    expect(summary).toBe(
      'Recreates table users to apply schema changes: database/users/column:a; database/users/column:b',
    );
  });
});

describe('buildRecreatePostchecks — column-level', () => {
  it('emits a nullability postcheck when nullability differs', () => {
    const spec = tableSpec({ columns: [colSpec({ name: 'email' })] });
    const issues = [
      issue({
        path: ['database', 'users', 'column:email'],
        expected: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: false }),
        actual: actualColumn({ name: 'email', nativeType: 'TEXT', nullable: true }),
      }),
    ];
    const checks = buildRecreatePostchecks('users', issues, spec);
    const check = checks.find((c) => c.description.includes('nullability'));
    expect(check).toBeDefined();
    expect(check!.sql).toContain('"notnull" = 1');
  });

  it('emits a type postcheck when the type changes', () => {
    const spec = tableSpec({ columns: [colSpec({ name: 'email', typeSql: 'TEXT' })] });
    const issues = [
      issue({
        path: ['database', 'users', 'column:email'],
        expected: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: true }),
        actual: actualColumn({ name: 'email', nativeType: 'INTEGER', nullable: true }),
      }),
    ];
    const checks = buildRecreatePostchecks('users', issues, spec);
    const check = checks.find((c) => c.description.includes('type'));
    expect(check).toBeDefined();
    expect(check!.sql).toContain("LOWER(type) = 'text'");
  });

  it('emits both when a single not-equal issue changes type AND nullability', () => {
    const spec = tableSpec({ columns: [colSpec({ name: 'email', typeSql: 'TEXT' })] });
    const issues = [
      issue({
        path: ['database', 'users', 'column:email'],
        expected: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: false }),
        actual: actualColumn({ name: 'email', nativeType: 'INTEGER', nullable: true }),
      }),
    ];
    const checks = buildRecreatePostchecks('users', issues, spec);
    expect(checks.filter((c) => c.description.includes('nullability'))).toHaveLength(1);
    expect(checks.filter((c) => c.description.includes('type'))).toHaveLength(1);
  });
});

describe('buildRecreatePostchecks — column-default', () => {
  it('emits a default-present postcheck for not-found (missing default)', () => {
    const spec = tableSpec({ columns: [colSpec({ name: 'email', defaultSql: 'DEFAULT 5' })] });
    const issues = [
      issue({
        path: ['database', 'users', 'column:email', 'default'],
        expected: columnDefault({ resolved: { kind: 'literal', value: 5 } }),
      }),
    ];
    const checks = buildRecreatePostchecks('users', issues, spec);
    const check = checks.find((c) => c.description.includes('default'));
    expect(check).toBeDefined();
    expect(check!.sql).toContain("dflt_value = '5'");
  });

  it('emits a no-default postcheck for not-expected (extra live default)', () => {
    const spec = tableSpec({ columns: [colSpec({ name: 'email' })] });
    const issues = [
      issue({
        path: ['database', 'users', 'column:email', 'default'],
        actual: columnDefault({ raw: "'stale'" }),
      }),
    ];
    const checks = buildRecreatePostchecks('users', issues, spec);
    const check = checks.find((c) => c.description.includes('has no default'));
    expect(check).toBeDefined();
    expect(check!.sql).toContain('dflt_value IS NULL');
  });

  it('emits a default-present postcheck for not-equal (default drift)', () => {
    const spec = tableSpec({
      columns: [colSpec({ name: 'email', defaultSql: 'DEFAULT 7' })],
    });
    const issues = [
      issue({
        path: ['database', 'users', 'column:email', 'default'],
        expected: columnDefault({ resolved: { kind: 'literal', value: 7 } }),
        actual: columnDefault({ raw: '3' }),
      }),
    ];
    const checks = buildRecreatePostchecks('users', issues, spec);
    const check = checks.find((c) => c.description.includes('default'));
    expect(check).toBeDefined();
    expect(check!.sql).toContain("dflt_value = '7'");
  });
});

describe('buildRecreatePostchecks — constraints', () => {
  it('emits a primary-key shape postcheck when a primary-key issue fires', () => {
    const spec = tableSpec({
      columns: [colSpec({ name: 'a' }), colSpec({ name: 'b' }), colSpec({ name: 'c' })],
      primaryKey: { columns: ['a', 'b'] },
    });
    const issues = [
      issue({
        path: ['database', 'users', 'primary-key'],
        expected: primaryKey(['a', 'b']),
        actual: primaryKey(['a']),
      }),
    ];
    const checks = buildRecreatePostchecks('users', issues, spec);
    const pkCheck = checks.find((c) => c.description.includes('primary key'));
    expect(pkCheck).toBeDefined();
    expect(pkCheck!.sql).toContain("pragma_table_info('users')");
    expect(pkCheck!.sql).toContain('pk > 0');
    expect(pkCheck!.sql).toContain("'a', 'b'");
    expect(pkCheck!.sql).toContain('= 2');
  });

  it('detects an inline autoincrement primary key as the expected PK', () => {
    const spec = tableSpec({
      columns: [colSpec({ name: 'id', inlineAutoincrementPrimaryKey: true })],
    });
    const issues = [
      issue({
        path: ['database', 't', 'primary-key'],
        expected: primaryKey(['id']),
      }),
    ];
    const checks = buildRecreatePostchecks('t', issues, spec);
    const pkCheck = checks.find((c) => c.description.includes('primary key'));
    expect(pkCheck).toBeDefined();
    expect(pkCheck!.sql).toContain("'id'");
  });

  it('emits a "no primary key" postcheck when the PK is not-expected and the spec has none', () => {
    const spec = tableSpec({ columns: [colSpec({ name: 'x' })] });
    const issues = [
      issue({
        path: ['database', 't', 'primary-key'],
        actual: primaryKey(['x']),
      }),
    ];
    const checks = buildRecreatePostchecks('t', issues, spec);
    const pkCheck = checks.find((c) => c.description.includes('no primary key'));
    expect(pkCheck).toBeDefined();
    expect(pkCheck!.sql).toContain('pk > 0) = 0');
  });

  it('emits one unique postcheck per declared unique when a unique issue fires', () => {
    const spec = tableSpec({
      columns: [colSpec({ name: 'email' }), colSpec({ name: 'tenant' })],
      uniques: [{ columns: ['email'] }, { columns: ['tenant', 'email'], name: 'tenant_email' }],
    });
    const issues = [
      issue({
        path: ['database', 'users', 'unique:email'],
        expected: unique(['email']),
      }),
    ];
    const checks = buildRecreatePostchecks('users', issues, spec);
    const uniqueChecks = checks.filter((c) => c.description.startsWith('verify unique constraint'));
    expect(uniqueChecks).toHaveLength(2);
    expect(uniqueChecks[0]!.sql).toContain("pragma_index_list('users')");
    expect(uniqueChecks[0]!.sql).toContain('l."unique" = 1');
    expect(uniqueChecks[0]!.sql).toContain("name IN ('email')");
    expect(uniqueChecks[1]!.description).toContain('"tenant_email"');
    expect(uniqueChecks[1]!.sql).toContain("name IN ('tenant', 'email')");
  });

  it('emits one foreign-key postcheck per declared FK when a foreign-key issue fires', () => {
    const spec = tableSpec({
      columns: [colSpec({ name: 'user_id' }), colSpec({ name: 'tenant_id' })],
      foreignKeys: [
        { columns: ['user_id'], references: { table: 'users', columns: ['id'] } },
        {
          columns: ['tenant_id', 'user_id'],
          references: { table: 'memberships', columns: ['tenant_id', 'user_id'] },
        },
      ],
    });
    const issues = [
      issue({
        path: ['database', 'posts', 'foreign-key:user_id->.users(id)'],
        expected: foreignKey({
          columns: ['user_id'],
          referencedTable: 'users',
          referencedColumns: ['id'],
        }),
      }),
    ];
    const checks = buildRecreatePostchecks('posts', issues, spec);
    const fkChecks = checks.filter((c) => c.description.startsWith('verify foreign key'));
    expect(fkChecks).toHaveLength(2);

    expect(fkChecks[0]!.sql).toContain("pragma_foreign_key_list('posts')");
    expect(fkChecks[0]!.sql).toContain('f."table" = \'users\'');
    expect(fkChecks[0]!.sql).toContain("('user_id', 'id')");
    expect(fkChecks[0]!.sql).toContain('HAVING COUNT(*) = 1');

    expect(fkChecks[1]!.sql).toContain("('tenant_id', 'tenant_id'), ('user_id', 'user_id')");
    expect(fkChecks[1]!.sql).toContain('HAVING COUNT(*) = 2');
  });

  it('checks that no unexpected unique remains, so removing the last unique is not already satisfied', () => {
    const spec = tableSpec({ columns: [colSpec({ name: 'email' })], uniques: [] });
    const issues = [
      issue({ path: ['database', 'users', 'unique:email'], actual: unique(['email']) }),
    ];

    expect(buildRecreatePostchecks('users', issues, spec)).toEqual([
      {
        description: 'verify "users" has no unique constraint besides the expected ones',
        sql: `SELECT NOT EXISTS (SELECT 1 FROM pragma_index_list('users') l WHERE l.origin = 'u' AND NOT (0))`,
      },
    ]);
  });

  it('checks the foreign key count, so removing the last foreign key is not already satisfied', () => {
    const spec = tableSpec({ columns: [colSpec({ name: 'user_id' })], foreignKeys: [] });
    const issues = [
      issue({
        path: ['database', 'posts', 'foreign-key:user_id->.users(id)'],
        actual: foreignKey({
          columns: ['user_id'],
          referencedTable: 'users',
          referencedColumns: ['id'],
        }),
      }),
    ];

    expect(buildRecreatePostchecks('posts', issues, spec)).toEqual([
      {
        description: 'verify "posts" has exactly 0 foreign keys',
        sql: `SELECT (SELECT COUNT(DISTINCT id) FROM pragma_foreign_key_list('posts')) = 0`,
      },
    ]);
  });

  it('does not emit constraint postchecks when only column-level issues are present', () => {
    const spec = tableSpec({
      columns: [colSpec({ name: 'a' })],
      primaryKey: { columns: ['a'] },
      uniques: [{ columns: ['a'] }],
      foreignKeys: [{ columns: ['a'], references: { table: 'x', columns: ['id'] } }],
    });
    const issues = [
      issue({
        path: ['database', 't', 'column:a'],
        expected: expectedColumn({ name: 'a', nativeType: 'TEXT', nullable: true }),
        actual: actualColumn({ name: 'a', nativeType: 'INTEGER', nullable: true }),
      }),
    ];
    const checks = buildRecreatePostchecks('t', issues, spec);
    expect(checks.some((c) => c.description.includes('primary key'))).toBe(false);
    expect(checks.some((c) => c.description.includes('unique constraint'))).toBe(false);
    expect(checks.some((c) => c.description.includes('foreign key'))).toBe(false);
  });
});
