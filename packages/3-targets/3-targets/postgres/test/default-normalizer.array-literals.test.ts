import { describe, expect, it } from 'vitest';
import { parsePostgresDefault } from '../src/core/default-normalizer';

describe('parsePostgresDefault array literals', () => {
  it('parses an empty array body', () => {
    expect(parsePostgresDefault("'{}'::text[]", 'text[]')).toEqual({
      kind: 'literal',
      value: [],
    });
  });

  it('parses a numeric array body', () => {
    expect(parsePostgresDefault("'{1,2}'::integer[]", 'integer[]')).toEqual({
      kind: 'literal',
      value: [1, 2],
    });
  });

  it('parses a quoted-string array body', () => {
    expect(parsePostgresDefault('\'{"a","b"}\'::text[]', 'text[]')).toEqual({
      kind: 'literal',
      value: ['a', 'b'],
    });
  });

  it('parses a NULL element', () => {
    expect(parsePostgresDefault("'{NULL}'::text[]", 'text[]')).toEqual({
      kind: 'literal',
      value: [null],
    });
  });

  it('parses boolean array body', () => {
    expect(parsePostgresDefault("'{true,false}'::boolean[]", 'boolean[]')).toEqual({
      kind: 'literal',
      value: [true, false],
    });
  });

  it('reads the t/f tokens Postgres prints for a boolean element as booleans', () => {
    expect(parsePostgresDefault("'{t,f}'::boolean[]", 'bool[]')).toEqual({
      kind: 'literal',
      value: [true, false],
    });
  });

  it('fails closed for an unquoted boolean element that is not t, f, true or false', () => {
    expect(parsePostgresDefault("'{yes}'::boolean[]", 'bool[]')).toEqual({
      kind: 'function',
      expression: "'{yes}'::boolean[]",
    });
  });

  it('reads unquoted text elements as strings', () => {
    expect(parsePostgresDefault("'{a,b}'::text[]", 'text[]')).toEqual({
      kind: 'literal',
      value: ['a', 'b'],
    });
  });

  it('reads unquoted true, false and numerals in a text array as strings', () => {
    expect(parsePostgresDefault("'{true,false,1}'::text[]", 'text[]')).toEqual({
      kind: 'literal',
      value: ['true', 'false', '1'],
    });
  });

  it('reads an unquoted enum member as a string', () => {
    expect(parsePostgresDefault('\'{USER}\'::"Role"[]', 'Role[]')).toEqual({
      kind: 'literal',
      value: ['USER'],
    });
  });

  it('reads an unquoted varchar element as a string', () => {
    expect(parsePostgresDefault("'{x}'::character varying[]", 'character varying[]')).toEqual({
      kind: 'literal',
      value: ['x'],
    });
  });

  it('reads an unquoted date element as its text', () => {
    expect(parsePostgresDefault("'{2024-01-01}'::date[]", 'date[]')).toEqual({
      kind: 'literal',
      value: ['2024-01-01'],
    });
  });

  it('fails closed for a non-numeral in a number array', () => {
    expect(parsePostgresDefault("'{1,a}'::integer[]", 'int4[]')).toEqual({
      kind: 'function',
      expression: "'{1,a}'::integer[]",
    });
  });

  it('fails closed for an unquoted non-numeric json element', () => {
    expect(parsePostgresDefault("'{a}'::jsonb[]", 'jsonb[]')).toEqual({
      kind: 'function',
      expression: "'{a}'::jsonb[]",
    });
  });

  it.each([
    { raw: "'{[2],[]}'::jsonb[]", nativeType: 'jsonb[]', value: [[2], []] },
    { raw: String.raw`'{"{\"a\":1}",[2]}'::json[]`, nativeType: 'json[]', value: [{ a: 1 }, [2]] },
  ])('reads the unquoted JSON elements Postgres prints in $raw', ({ raw, nativeType, value }) => {
    expect(parsePostgresDefault(raw, nativeType)).toEqual({ kind: 'literal', value });
  });

  it('fails closed for an unquoted json element that is not JSON', () => {
    expect(parsePostgresDefault("'{[2}'::jsonb[]", 'jsonb[]')).toEqual({
      kind: 'function',
      expression: "'{[2}'::jsonb[]",
    });
  });

  it.each([
    "'{[12345678901234567890]}'::jsonb[]",
    "'{[1e400]}'::jsonb[]",
    "'{12345678901234567890}'::jsonb[]",
    `'{"[12345678901234567890]"}'::jsonb[]`,
    "ARRAY['12345678901234567890'::jsonb]",
  ])(
    'keeps the raw expression when a JavaScript number would change a json number in %s',
    (raw) => {
      expect(parsePostgresDefault(raw, 'jsonb[]')).toEqual({ kind: 'function', expression: raw });
    },
  );

  it('reads json numbers a JavaScript number keeps exactly', () => {
    expect(
      parsePostgresDefault(`'{[1.0],1.5,"[0.1]",[100000000000000000000]}'::jsonb[]`, 'jsonb[]'),
    ).toEqual({ kind: 'literal', value: [[1], 1.5, [0.1], [1e20]] });
  });

  it.each([
    { raw: "'{1,true}'::jsonb[]", nativeType: 'jsonb[]', value: [1, true] },
    { raw: "'{-1.5,2,false}'::json[]", nativeType: 'json[]', value: [-1.5, 2, false] },
    { raw: "ARRAY['1'::jsonb, 'true'::jsonb]", nativeType: 'jsonb[]', value: [1, true] },
  ])('reads the numerals in $raw as JSON numbers', ({ raw, nativeType, value }) => {
    expect(parsePostgresDefault(raw, nativeType)).toEqual({ kind: 'literal', value });
  });

  it('fails closed for a multidimensional array body whose sub-arrays start and end quoted', () => {
    expect(parsePostgresDefault('\'{{"a b","c d"}}\'::text[]', 'text[]')).toEqual({
      kind: 'function',
      expression: '\'{{"a b","c d"}}\'::text[]',
    });
  });

  it('fails closed for a multidimensional array body', () => {
    expect(parsePostgresDefault("'{{a,b},{c,d}}'::text[]", 'text[]')).toEqual({
      kind: 'function',
      expression: "'{{a,b},{c,d}}'::text[]",
    });
  });

  it('keeps a comma inside a quoted element as part of that element', () => {
    expect(parsePostgresDefault('\'{"a,b","c"}\'::text[]', 'text[]')).toEqual({
      kind: 'literal',
      value: ['a,b', 'c'],
    });
  });

  it('unescapes a doubled quote inside a quoted element', () => {
    expect(parsePostgresDefault('\'{"a""b"}\'::text[]', 'text[]')).toEqual({
      kind: 'literal',
      value: ['a"b'],
    });
  });

  it('unescapes a backslash-escaped quote inside a quoted element', () => {
    expect(parsePostgresDefault('\'{"a\\"b"}\'::text[]', 'text[]')).toEqual({
      kind: 'literal',
      value: ['a"b'],
    });
  });

  it('undoes the SQL quote escape in an unquoted element', () => {
    expect(parsePostgresDefault("'{a''b}'::text[]", 'text[]')).toEqual({
      kind: 'literal',
      value: ["a'b"],
    });
  });

  it('undoes the SQL quote escape in a quoted element', () => {
    expect(parsePostgresDefault("'{\"a''b c\"}'::text[]", 'text[]')).toEqual({
      kind: 'literal',
      value: ["a'b c"],
    });
  });

  it('keeps a box array default raw, since box elements are delimited by semicolons', () => {
    expect(parsePostgresDefault("'{(3,4),(1,2)}'::box[]", 'box[]')).toEqual({
      kind: 'function',
      expression: "'{(3,4),(1,2)}'::box[]",
    });
  });

  it('keeps a default raw when a backslash sits outside quotes', () => {
    expect(parsePostgresDefault("'{a\\,b}'::text[]", 'text[]')).toEqual({
      kind: 'function',
      expression: "'{a\\,b}'::text[]",
    });
  });

  it('keeps quoted elements that look like a boolean or a number as literal text', () => {
    expect(parsePostgresDefault('\'{"true","1"}\'::text[]', 'text[]')).toEqual({
      kind: 'literal',
      value: ['true', '1'],
    });
  });

  it('keeps a quoted element that looks like NULL as the literal string', () => {
    expect(parsePostgresDefault('\'{"NULL"}\'::text[]', 'text[]')).toEqual({
      kind: 'literal',
      value: ['NULL'],
    });
  });

  it('parses negative and decimal integer and float elements as numbers', () => {
    expect(parsePostgresDefault("'{-1,2}'::integer[]", 'int4[]')).toEqual({
      kind: 'literal',
      value: [-1, 2],
    });
    expect(parsePostgresDefault("'{-1.5,2}'::double precision[]", 'float8[]')).toEqual({
      kind: 'literal',
      value: [-1.5, 2],
    });
  });

  it('reads numeric elements as the decimal text Postgres printed', () => {
    expect(parsePostgresDefault("'{-1,2.5}'::numeric[]", 'numeric[]')).toEqual({
      kind: 'literal',
      value: ['-1', '2.5'],
    });
    expect(
      parsePostgresDefault("'{12345678901234567890.123456789}'::numeric[]", 'numeric[]'),
    ).toEqual({ kind: 'literal', value: ['12345678901234567890.123456789'] });
  });

  it('reads int8 elements as decimal text past the safe integer range', () => {
    expect(parsePostgresDefault("'{1,9007199254740993}'::bigint[]", 'int8[]')).toEqual({
      kind: 'literal',
      value: ['1', '9007199254740993'],
    });
  });

  it('falls back to a function expression for an unterminated quoted element', () => {
    expect(parsePostgresDefault("'{\"abc}'::text[]", 'text[]')).toEqual({
      kind: 'function',
      expression: "'{\"abc}'::text[]",
    });
  });

  it('falls back to a function expression for a trailing backslash inside a quoted element', () => {
    expect(parsePostgresDefault("'{\"a\\}'::text[]", 'text[]')).toEqual({
      kind: 'function',
      expression: "'{\"a\\}'::text[]",
    });
  });

  it.each(['NULL', 'NULL::text[]'])(
    'reads the SQL NULL default %s on an array column as null',
    (raw) => {
      expect(parsePostgresDefault(raw, 'text[]')).toEqual({ kind: 'literal', value: null });
    },
  );

  it('reads an array literal written without the outer cast', () => {
    expect(parsePostgresDefault("'{a,b}'", 'text[]')).toEqual({
      kind: 'literal',
      value: ['a', 'b'],
    });
  });

  it.each([
    { raw: "'{{a,b},{c,d}}'", nativeType: 'text[]' },
    { raw: `'{"[12345678901234567890]"}'`, nativeType: 'jsonb[]' },
  ])(
    'keeps the raw expression for $raw on a $nativeType column when no array reader reads it',
    ({ raw, nativeType }) => {
      expect(parsePostgresDefault(raw, nativeType)).toEqual({ kind: 'function', expression: raw });
    },
  );

  it('does not treat a brace literal as an array default without an array native type', () => {
    expect(parsePostgresDefault("'{1,2}'::integer[]")).toEqual({
      kind: 'function',
      expression: "'{1,2}'::integer[]",
    });
  });
});

describe('parsePostgresDefault uuid array literals', () => {
  it.each([
    { raw: "'{A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11,B0EEBC999C0B4EF8BB6D6BB9BD380A11}'::uuid[]" },
    {
      raw: '\'{"A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11","{B0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11}"}\'',
    },
  ])('reads each element of $raw as the text Postgres prints', ({ raw }) => {
    expect(parsePostgresDefault(raw, 'uuid[]')).toEqual({
      kind: 'literal',
      value: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
    });
  });

  it('keeps the case of uuid-shaped elements of a text array', () => {
    expect(
      parsePostgresDefault("'{A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11}'::text[]", 'text[]'),
    ).toEqual({ kind: 'literal', value: ['A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'] });
  });
});
