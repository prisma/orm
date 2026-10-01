import type { CodecControlHooks } from '@internal/family-sql/control';
import type { StorageColumn } from '@internal/sql-contract/types';
import { col as ddlColumn, fn, lit } from '@internal/sql-relational-core/contract-free';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import {
  buildColumnTypeSql,
  renderDefaultLiteral,
} from '@internal/target-postgres/planner-ddl-builders';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../../src/core/control-adapter';

const noHooks = new Map<string, CodecControlHooks>();

function col(overrides: Partial<StorageColumn> & { nativeType: string }): StorageColumn {
  return { many: false, codecId: 'pg/text@1', nullable: true, ...overrides };
}

// ---------------------------------------------------------------------------
// buildColumnTypeSql
// ---------------------------------------------------------------------------

describe('buildColumnTypeSql', () => {
  it('returns native type for plain columns', () => {
    expect(buildColumnTypeSql(col({ nativeType: 'text' }), noHooks)).toBe('text');
  });

  it('returns SERIAL for int4 with autoincrement', () => {
    const column = col({
      nativeType: 'int4',
      default: { kind: 'function', expression: 'autoincrement()' },
    });
    expect(buildColumnTypeSql(column, noHooks)).toBe('SERIAL');
  });

  it('returns BIGSERIAL for int8 with autoincrement', () => {
    const column = col({
      nativeType: 'int8',
      default: { kind: 'function', expression: 'autoincrement()' },
    });
    expect(buildColumnTypeSql(column, noHooks)).toBe('BIGSERIAL');
  });

  it('returns SMALLSERIAL for int2 with autoincrement', () => {
    const column = col({
      nativeType: 'int2',
      default: { kind: 'function', expression: 'autoincrement()' },
    });
    expect(buildColumnTypeSql(column, noHooks)).toBe('SMALLSERIAL');
  });

  it('quotes type name for typeRef columns', () => {
    const column = col({ nativeType: 'my_enum', typeRef: 'my_enum' });
    expect(buildColumnTypeSql(column, noHooks)).toBe('"my_enum"');
  });

  it('quotes each segment of a schema-qualified typeRef native type', () => {
    const column = col({ nativeType: 'auth.aal_level', typeRef: 'AalLevel' });
    expect(buildColumnTypeSql(column, noHooks)).toBe('"auth"."aal_level"');
  });

  // A native-enum column carries `typeParams.typeName` (the referenced named
  // database type); it renders through the general named-type path, keyed off
  // that signal — never a codec-id branch.
  it('renders an unqualified named-type column as a single quoted identifier', () => {
    const column = col({
      nativeType: 'order_status',
      codecId: 'pg/enum@1',
      typeParams: { typeName: 'order_status' },
    });
    expect(buildColumnTypeSql(column, noHooks)).toBe('"order_status"');
  });

  it('renders a schema-qualified named-type column segment-by-segment', () => {
    const column = col({
      nativeType: 'auth.aal_level',
      codecId: 'pg/enum@1',
      typeParams: { typeName: 'auth.aal_level' },
    });
    expect(buildColumnTypeSql(column, noHooks)).toBe('"auth"."aal_level"');
  });

  it('appends [] for a named-type array column', () => {
    const column = col({
      nativeType: 'order_status',
      codecId: 'pg/enum@1',
      typeParams: { typeName: 'order_status' },
      many: { elementNullable: false },
    });
    expect(buildColumnTypeSql(column, noHooks)).toBe('"order_status"[]');
  });

  it('keys the named-type path off typeParams.typeName, not the codec id', () => {
    const column = col({
      nativeType: 'my_domain.my_type',
      codecId: 'some/other-codec@1',
      typeParams: { typeName: 'my_domain.my_type' },
    });
    expect(buildColumnTypeSql(column, noHooks)).toBe('"my_domain"."my_type"');
  });

  it('rejects unsafe native type names', () => {
    expect(() => buildColumnTypeSql(col({ nativeType: 'text; DROP TABLE' }), noHooks)).toThrow(
      'Unsafe native type',
    );
  });

  it('uses expandNativeType hook for parameterized types', () => {
    const hooks = new Map<string, CodecControlHooks>([
      [
        'pg/vector@1',
        {
          expandNativeType: ({ nativeType, typeParams }) =>
            `${nativeType}(${typeParams?.['length']})`,
        },
      ],
    ]);
    const column = col({
      nativeType: 'vector',
      codecId: 'pg/vector@1',
      typeParams: { length: 3 },
    });
    expect(buildColumnTypeSql(column, hooks)).toBe('vector(3)');
  });
});

// ---------------------------------------------------------------------------
// renderColumnDefault: the clause every DDL statement writes for a default
// ---------------------------------------------------------------------------

describe('the DEFAULT clause the Postgres adapter writes in every DDL statement', () => {
  const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());

  it.each([
    ['no default', ddlColumn('c', 'text'), ''],
    ['a string', ddlColumn('c', 'text', { default: lit('hello') }), "DEFAULT 'hello'"],
    ['a number', ddlColumn('c', 'int4', { default: lit(42) }), 'DEFAULT 42'],
    ['a boolean', ddlColumn('c', 'bool', { default: lit(true) }), 'DEFAULT true'],
    [
      'autoincrement(), which SERIAL writes',
      ddlColumn('c', 'SERIAL', { default: fn('autoincrement()') }),
      '',
    ],
    ['a function', ddlColumn('c', 'timestamptz', { default: fn('now()') }), 'DEFAULT (now())'],
    [
      'a sequence',
      ddlColumn('c', 'int4', { default: fn(`nextval('"user_id_seq"'::regclass)`) }),
      `DEFAULT (nextval('"user_id_seq"'::regclass))`,
    ],
    [
      'an empty list',
      ddlColumn('c', 'text[]', {
        default: lit([]),
        codecRef: { codecId: 'pg/text@1', many: true },
      }),
      "DEFAULT '{}'",
    ],
    [
      'a list',
      ddlColumn('c', 'text[]', {
        default: lit(['a', 'b']),
        codecRef: { codecId: 'pg/text@1', many: true },
      }),
      `DEFAULT ARRAY['a', 'b']::text[]`,
    ],
    [
      'an int8 list, as text cast to the list type',
      ddlColumn('c', 'int8[]', {
        default: lit(['1', '9007199254740993']),
        codecRef: { codecId: 'pg/int8@1', many: true },
      }),
      `DEFAULT ARRAY['1', '9007199254740993']::int8[]`,
    ],
  ])('writes %s', async (_name, column, clause) => {
    expect(await adapter.renderColumnDefault(column, 't')).toBe(clause);
  });

  it('refuses an unsafe function expression with CONTRACT.DEFAULT_INVALID', async () => {
    await expect(
      adapter.renderColumnDefault(
        ddlColumn('c', 'timestamptz', { default: fn('now(); DROP TABLE users') }),
        't',
      ),
    ).rejects.toMatchObject({
      code: 'CONTRACT.DEFAULT_INVALID',
      meta: { expression: 'now(); DROP TABLE users' },
    });
  });
});

// ---------------------------------------------------------------------------
// renderDefaultLiteral
// ---------------------------------------------------------------------------

describe('renderDefaultLiteral', () => {
  it('renders string', () => {
    expect(renderDefaultLiteral('hello')).toBe("'hello'");
  });

  it('renders number', () => {
    expect(renderDefaultLiteral(42)).toBe('42');
  });

  it('renders boolean', () => {
    expect(renderDefaultLiteral(false)).toBe('false');
  });

  it('renders null', () => {
    expect(renderDefaultLiteral(null)).toBe('NULL');
  });

  it('renders JSON object for jsonb column', () => {
    const result = renderDefaultLiteral({ key: 'val' }, col({ nativeType: 'jsonb' }));
    expect(result).toBe(`'{"key":"val"}'::jsonb`);
  });

  it('renders JSON object without cast for non-json column', () => {
    const result = renderDefaultLiteral({ key: 'val' });
    expect(result).toBe(`'{"key":"val"}'`);
  });

  it('renders an empty array literal for a list column', () => {
    const result = renderDefaultLiteral(
      [],
      col({ nativeType: 'text', many: { elementNullable: false } }),
    );
    expect(result).toBe("'{}'");
  });

  it('renders a populated array literal for a list column, cast to the list type', () => {
    const result = renderDefaultLiteral(
      ['a', 'b'],
      col({ nativeType: 'text', many: { elementNullable: false } }),
    );
    expect(result).toBe(`ARRAY['a', 'b']::text[]`);
  });

  it('renders a mixed-type array literal element-by-element', () => {
    const result = renderDefaultLiteral(
      [1, true, null],
      col({ nativeType: 'int4', many: { elementNullable: false } }),
    );
    expect(result).toBe('ARRAY[1, true, NULL]::int4[]');
  });
});
