import { describe, expect, it } from 'vitest';
import { parsePostgresDefault } from '../src/core/default-normalizer';

describe('parsePostgresDefault null and boolean literals', () => {
  it('parses a bare NULL', () => {
    expect(parsePostgresDefault('NULL')).toEqual({ kind: 'literal', value: null });
  });

  it('parses a NULL with a type cast', () => {
    expect(parsePostgresDefault('NULL::text')).toEqual({ kind: 'literal', value: null });
  });

  it('parses true', () => {
    expect(parsePostgresDefault('true')).toEqual({ kind: 'literal', value: true });
  });

  it('parses false', () => {
    expect(parsePostgresDefault('false')).toEqual({ kind: 'literal', value: false });
  });
});

describe('parsePostgresDefault numeric literals', () => {
  it('parses a positive integer', () => {
    expect(parsePostgresDefault('42')).toEqual({ kind: 'literal', value: 42 });
  });

  it('parses a negative decimal', () => {
    expect(parsePostgresDefault('-3.14')).toEqual({ kind: 'literal', value: -3.14 });
  });

  it('returns undefined for a numeral too large to represent as a finite number', () => {
    const hugeDigits = `1${'0'.repeat(400)}`;
    expect(parsePostgresDefault(hugeDigits)).toBeUndefined();
  });

  it('reads a bigint-typed integer as decimal text', () => {
    expect(parsePostgresDefault('123', 'bigint')).toEqual({ kind: 'literal', value: '123' });
  });

  it('reads a bigint-typed integer past the safe range as decimal text', () => {
    expect(parsePostgresDefault('9007199254740993', 'int8')).toEqual({
      kind: 'literal',
      value: '9007199254740993',
    });
  });
});

describe('parsePostgresDefault string literals', () => {
  it('parses a plain string literal', () => {
    expect(parsePostgresDefault("'hello'")).toEqual({ kind: 'literal', value: 'hello' });
  });

  it('unescapes a doubled single quote', () => {
    expect(parsePostgresDefault("'it''s'")).toEqual({ kind: 'literal', value: "it's" });
  });

  it('strips a word-based type cast suffix', () => {
    expect(parsePostgresDefault("'hello'::character varying")).toEqual({
      kind: 'literal',
      value: 'hello',
    });
  });

  it('strips a quoted custom-type cast suffix', () => {
    expect(parsePostgresDefault('\'hello\'::"CustomEnum"')).toEqual({
      kind: 'literal',
      value: 'hello',
    });
  });

  it('strips a sized type cast suffix', () => {
    expect(parsePostgresDefault("'hello'::character varying(10)")).toEqual({
      kind: 'literal',
      value: 'hello',
    });
  });

  it('parses valid json content for a json column into its structured value', () => {
    expect(parsePostgresDefault('\'{"a":1}\'', 'json')).toEqual({
      kind: 'literal',
      value: { a: 1 },
    });
  });

  it('parses valid json content for a jsonb column into its structured value', () => {
    expect(parsePostgresDefault("'[1,2,3]'", 'jsonb')).toEqual({
      kind: 'literal',
      value: [1, 2, 3],
    });
  });

  it.each([
    { raw: "'12345678901234567890'::jsonb", nativeType: 'jsonb' },
    { raw: `'{"a": 1e400}'::json`, nativeType: 'json' },
  ])(
    'keeps the raw expression when a JavaScript number would change a json number in $raw',
    ({ raw, nativeType }) => {
      expect(parsePostgresDefault(raw, nativeType)).toEqual({ kind: 'function', expression: raw });
    },
  );

  it('reads a json number with trailing zeros as the same number', () => {
    expect(parsePostgresDefault("'[1.0]'::jsonb", 'jsonb')).toEqual({
      kind: 'literal',
      value: [1],
    });
  });

  it('keeps malformed json content as a raw string when it fails to parse', () => {
    expect(parsePostgresDefault("'not valid json'", 'json')).toEqual({
      kind: 'literal',
      value: 'not valid json',
    });
  });

  it('reads a quoted bigint-typed numeral as decimal text', () => {
    expect(parsePostgresDefault("'123'", 'bigint')).toEqual({ kind: 'literal', value: '123' });
  });

  it('reads a quoted bigint-typed numeral past the safe range as decimal text', () => {
    expect(parsePostgresDefault("'9007199254740993'", 'bigint')).toEqual({
      kind: 'literal',
      value: '9007199254740993',
    });
  });

  it('keeps a bigint-typed non-numeric string as-is', () => {
    expect(parsePostgresDefault("'abc'", 'bigint')).toEqual({ kind: 'literal', value: 'abc' });
  });

  it('does not coerce a numeric-looking string default without a bigint type', () => {
    expect(parsePostgresDefault("'123'")).toEqual({ kind: 'literal', value: '123' });
  });
});

describe('parsePostgresDefault enum literal casts', () => {
  it('reads a literal cast to a schema-qualified quoted enum type', () => {
    expect(parsePostgresDefault('\'CREATE\'::audit."AuditAction"', 'audit.AuditAction')).toEqual({
      kind: 'literal',
      value: 'CREATE',
    });
  });

  it('reads a literal cast to a schema-qualified unquoted enum type', () => {
    expect(parsePostgresDefault("'user'::auth.user_role", 'auth.user_role')).toEqual({
      kind: 'literal',
      value: 'user',
    });
  });

  it('still reads the unqualified quoted and bare spellings', () => {
    expect(parsePostgresDefault('\'CREATE\'::"AuditAction"', 'AuditAction')).toEqual({
      kind: 'literal',
      value: 'CREATE',
    });
    expect(parsePostgresDefault("'user'::user_role", 'user_role')).toEqual({
      kind: 'literal',
      value: 'user',
    });
  });
});

describe('parsePostgresDefault number literals Postgres prints with a cast', () => {
  it.each([
    { raw: "'-1'::integer", nativeType: 'int4', value: -1 },
    { raw: "'-2'::integer", nativeType: 'int2', value: -2 },
    { raw: "'-1.5'::numeric", nativeType: 'float8', value: -1.5 },
    { raw: "'-1.5'::numeric", nativeType: 'float4', value: -1.5 },
    { raw: '(1.5)::double precision', nativeType: 'float8', value: 1.5 },
  ])('reads $raw as the number $value for $nativeType', ({ raw, nativeType, value }) => {
    expect(parsePostgresDefault(raw, nativeType)).toEqual({ kind: 'literal', value });
  });

  it.each([
    { raw: "'-9007199254740993'::bigint", value: '-9007199254740993' },
    { raw: "'-5'::integer", value: '-5' },
    { raw: '(1)::bigint', value: '1' },
  ])('reads $raw as decimal text for int8', ({ raw, value }) => {
    expect(parsePostgresDefault(raw, 'int8')).toEqual({ kind: 'literal', value });
  });
});

describe('parsePostgresDefault numerals on a column that is not a number type', () => {
  it.each([
    { raw: "'-1'::integer", nativeType: 'text', value: '-1' },
    { raw: "'-1'::integer", nativeType: 'character varying(10)', value: '-1' },
    { raw: "'-1.5'::numeric", nativeType: 'text', value: '-1.5' },
    { raw: '5', nativeType: 'text', value: '5' },
  ])('reads $raw as the text $value for $nativeType', ({ raw, nativeType, value }) => {
    expect(parsePostgresDefault(raw, nativeType)).toEqual({ kind: 'literal', value });
  });

  it.each([
    { raw: "ARRAY['-1'::integer, 2]", value: ['-1', '2'] },
    { raw: "'{-1,2}'::text[]", value: ['-1', '2'] },
  ])('reads the elements of $raw as text for text[]', ({ raw, value }) => {
    expect(parsePostgresDefault(raw, 'text[]')).toEqual({ kind: 'literal', value });
  });

  it('reads a numeral as a number when no native type is given', () => {
    expect(parsePostgresDefault("'-1'::integer")).toEqual({ kind: 'literal', value: -1 });
  });
});

describe('parsePostgresDefault numeric columns', () => {
  it.each([
    { raw: '12345678901234567890.123456789', nativeType: 'numeric(65,30)' },
    { raw: '0.000000000000000001', nativeType: 'numeric(65,30)' },
    { raw: '1.50', nativeType: 'numeric(65,30)' },
    { raw: '10', nativeType: 'numeric(65,30)' },
    { raw: '12.34', nativeType: 'numeric' },
    { raw: '1.50', nativeType: 'numeric' },
    { raw: '1.5', nativeType: 'numeric(10,2)' },
    { raw: '2.0', nativeType: 'numeric(10,0)' },
  ])('reads $raw as that decimal text for $nativeType', ({ raw, nativeType }) => {
    expect(parsePostgresDefault(raw, nativeType)).toEqual({ kind: 'literal', value: raw });
  });

  it.each([
    { raw: "'-0.5'::numeric", nativeType: 'numeric(65,30)', value: '-0.5' },
    { raw: "'-1.5'::numeric", nativeType: 'numeric(10,2)', value: '-1.5' },
    {
      raw: "'12345678901234567890'::numeric",
      nativeType: 'numeric',
      value: '12345678901234567890',
    },
    { raw: '1.5::numeric(10,2)', nativeType: 'numeric(10,2)', value: '1.5' },
    { raw: "'NaN'::numeric", nativeType: 'numeric', value: 'NaN' },
  ])('reads $raw as the decimal text $value for $nativeType', ({ raw, nativeType, value }) => {
    expect(parsePostgresDefault(raw, nativeType)).toEqual({ kind: 'literal', value });
  });
});

/**
 * Postgres prints a float default through `float4out` or `float8out`, which switch to exponent
 * notation for very large and very small magnitudes. Each raw expression below is what
 * `pg_get_expr` reported for the column default named beside it.
 */
describe('parsePostgresDefault float defaults Postgres prints in exponent notation', () => {
  it.each([
    { raw: "'1e+20'::real", nativeType: 'float4', value: 1e20 },
    { raw: "'1.5e-40'::real", nativeType: 'float4', value: 1.5e-40 },
    { raw: "'1e+300'::double precision", nativeType: 'float8', value: 1e300 },
    { raw: "'1e-320'::double precision", nativeType: 'float8', value: 1e-320 },
    { raw: "'-1.5e-40'::real", nativeType: 'float4', value: -1.5e-40 },
  ])('reads $raw as the number $value for $nativeType', ({ raw, nativeType, value }) => {
    expect(parsePostgresDefault(raw, nativeType)).toEqual({ kind: 'literal', value });
  });

  it.each([
    { raw: '1e+20', nativeType: 'float8', value: 1e20 },
    { raw: '1.5e-40::double precision', nativeType: 'float8', value: 1.5e-40 },
    { raw: '-2.5E+3', nativeType: 'float8', value: -2500 },
  ])('reads the unquoted $raw as the number $value', ({ raw, nativeType, value }) => {
    expect(parsePostgresDefault(raw, nativeType)).toEqual({ kind: 'literal', value });
  });
});
