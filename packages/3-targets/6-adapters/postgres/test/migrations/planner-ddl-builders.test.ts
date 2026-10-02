import { createDataTypeLookup } from '@internal/framework-components/codec';
import type { SqlTypeLookups } from '@internal/sql-contract/data-type';
import { toStorageTypeInstance } from '@internal/sql-contract/types';
import { col as ddlColumn, fn, lit } from '@internal/sql-relational-core/contract-free';
import {
  createPostgresBuiltinCodecLookup,
  postgresCodecDescriptorRegistry,
} from '@internal/target-postgres/codecs';
import {
  createPostgresBuiltinDataTypeLookup,
  postgresDataTypes,
} from '@internal/target-postgres/data-types';
import {
  buildColumnTypeSql,
  type DefaultColumn,
  renderDefaultLiteral,
} from '@internal/target-postgres/planner-ddl-builders';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../../src/core/control-adapter';

const types: SqlTypeLookups = {
  codecLookup: postgresCodecDescriptorRegistry,
  dataTypeLookup: createDataTypeLookup(postgresDataTypes),
};

type TypedColumn = Parameters<typeof buildColumnTypeSql>[0];

function col(overrides: Partial<TypedColumn> = {}): TypedColumn {
  return { codecId: 'pg/text@1', ...overrides };
}

function listColumn(baseTypeName: string): DefaultColumn {
  return { baseTypeName, dataType: 'pg/text', many: true };
}

// ---------------------------------------------------------------------------
// buildColumnTypeSql
// ---------------------------------------------------------------------------

describe('buildColumnTypeSql', () => {
  it('returns the data type name for plain columns', () => {
    expect(buildColumnTypeSql(col(), types)).toBe('text');
  });

  it('returns SERIAL for int4 with autoincrement', () => {
    const column = col({
      codecId: 'pg/int4@1',
      default: { kind: 'function', expression: 'autoincrement()' },
    });
    expect(buildColumnTypeSql(column, types)).toBe('SERIAL');
  });

  it('returns BIGSERIAL for int8 with autoincrement', () => {
    const column = col({
      codecId: 'pg/int8@1',
      default: { kind: 'function', expression: 'autoincrement()' },
    });
    expect(buildColumnTypeSql(column, types)).toBe('BIGSERIAL');
  });

  it('returns SMALLSERIAL for int2 with autoincrement', () => {
    const column = col({
      codecId: 'pg/int2@1',
      default: { kind: 'function', expression: 'autoincrement()' },
    });
    expect(buildColumnTypeSql(column, types)).toBe('SMALLSERIAL');
  });

  it('writes a typeRef column as a column of the referenced type', () => {
    const column = col({ typeRef: 'AalLevel' });
    const storageTypes = {
      AalLevel: toStorageTypeInstance({
        codecId: 'pg/enum@1',
        dataType: 'pg/enum',
        typeParams: { typeName: 'auth.aal_level' },
      }),
    };
    expect(buildColumnTypeSql(column, types, storageTypes)).toBe('"auth"."aal_level"');
  });

  it('renders an unqualified named-type column as a single quoted identifier', () => {
    const column = col({
      codecId: 'pg/enum@1',
      typeParams: { typeName: 'order_status' },
    });
    expect(buildColumnTypeSql(column, types)).toBe('"order_status"');
  });

  it('renders a schema-qualified named-type column segment-by-segment', () => {
    const column = col({
      codecId: 'pg/enum@1',
      typeParams: { typeName: 'auth.aal_level' },
    });
    expect(buildColumnTypeSql(column, types)).toBe('"auth"."aal_level"');
  });

  it('appends [] for a named-type array column', () => {
    const column = col({
      codecId: 'pg/enum@1',
      typeParams: { typeName: 'order_status' },
      many: true,
    });
    expect(buildColumnTypeSql(column, types)).toBe('"order_status"[]');
  });

  it('writes the parameters of a parameterized data type', () => {
    const column = col({
      codecId: 'pg/varchar@1',
      typeParams: { length: 3 },
    });
    expect(buildColumnTypeSql(column, types)).toBe('character varying(3)');
  });
});

// ---------------------------------------------------------------------------
// renderColumnDefault: the clause every DDL statement writes for a default
// ---------------------------------------------------------------------------

describe('the DEFAULT clause the Postgres adapter writes in every DDL statement', () => {
  const adapter = new PostgresControlAdapter(
    createPostgresBuiltinCodecLookup(),
    createPostgresBuiltinDataTypeLookup(),
  );

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
    const result = renderDefaultLiteral(
      { key: 'val' },
      { baseTypeName: 'jsonb', dataType: 'pg/jsonb' },
    );
    expect(result).toBe(`'{"key":"val"}'::jsonb`);
  });

  it('renders JSON object without cast for non-json column', () => {
    const result = renderDefaultLiteral({ key: 'val' });
    expect(result).toBe(`'{"key":"val"}'`);
  });

  it('renders an empty array literal for a list column', () => {
    const result = renderDefaultLiteral([], listColumn('text'));
    expect(result).toBe("'{}'");
  });

  it('renders a populated array literal for a list column, cast to the list type', () => {
    const result = renderDefaultLiteral(['a', 'b'], listColumn('text'));
    expect(result).toBe(`ARRAY['a', 'b']::text[]`);
  });

  it('renders a mixed-type array literal element-by-element', () => {
    const result = renderDefaultLiteral([1, true, null], listColumn('int4'));
    expect(result).toBe('ARRAY[1, true, NULL]::int4[]');
  });
});
