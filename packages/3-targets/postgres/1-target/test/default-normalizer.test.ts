import { describe, expect, it } from 'vitest';
import { postgresResolveDefault, readPostgresDefault } from '../src/core/default-normalizer';

const value = (body: string) => ({ kind: 'literal', literal: { kind: 'value', body } });
const list = (elements: readonly (string | null)[]) => ({
  kind: 'literal',
  literal: { kind: 'list', elements },
});

describe('readPostgresDefault', () => {
  it.each([
    ['a quoted string with its cast', "'draft'::text", false, 'draft'],
    ['a doubled quote', "'O''Reilly'::text", false, "O'Reilly"],
    ['a numeral', '42', false, '42'],
    ['a quoted numeral cast to a number type', "'-1'::integer", false, '-1'],
    ['a parenthesised numeral cast', '(1)::bigint', false, '1'],
    ['a numeral in exponent notation', "'1e+20'::real", false, '1e+20'],
    ['true', 'true', false, 'true'],
    ['false', 'FALSE', false, 'false'],
    ['a JSON document', `'{"a": 1}'::jsonb`, false, '{"a": 1}'],
    ['bytea hex', "'\\x6869'::bytea", false, '\\x6869'],
    ['a date with its typed cast', "'2024-01-01'::date", false, '2024-01-01'],
    ['an enum member cast to a qualified type', '\'free\'::auth."Plan"', false, 'free'],
    ['an escape string', "E'a\\\\b\\nc'::text", false, 'a\\b\nc'],
  ])('takes the body out of %s', (_name, raw, many, body) => {
    expect(readPostgresDefault(raw, many)).toEqual(value(body));
  });

  it.each([
    ['an array literal', '\'{a,"b,c",NULL}\'::text[]', true, ['a', 'b,c', null]],
    ['an empty array literal', "'{}'::integer[]", true, []],
    ['a constructor', "ARRAY['a'::text, NULL, 'b'::text]", true, ['a', null, 'b']],
    ['an empty constructor', 'ARRAY[]::text[]', true, []],
    ['a constructor of numerals and booleans', 'ARRAY[1, 2]', true, ['1', '2']],
    ['a cast constructor', "(ARRAY['{}'::jsonb])::jsonb[]", true, ['{}']],
  ])('takes the element bodies out of %s', (_name, raw, many, elements) => {
    expect(readPostgresDefault(raw, many)).toEqual(list(elements));
  });

  it.each([
    ["nextval('t_id_seq'::regclass)", false, 'autoincrement()'],
    ['now()', false, 'now()'],
    ['CURRENT_TIMESTAMP', false, 'now()'],
    ["('now'::text)::timestamp with time zone", false, 'now()'],
    ['clock_timestamp()', false, 'clock_timestamp()'],
    ['uuid_generate_v4()', false, 'gen_random_uuid()'],
    ["(now() + '00:03:00'::interval)", false, "(now() + '00:03:00'::interval)"],
    ['(1.5)::integer', false, '(1.5)::integer'],
    ['ARRAY[(1 + 1)]', true, 'ARRAY[(1 + 1)]'],
  ])('reads %s as the function %s', (raw, many, expression) => {
    expect(readPostgresDefault(raw, many)).toEqual({ kind: 'function', expression });
  });

  it('reads a list literal by the list flag, whatever the type text', () => {
    expect({
      list: readPostgresDefault("'{a,b}'::text[]", true),
      single: readPostgresDefault("'{a,b}'::text[]", false),
    }).toEqual({
      list: list(['a', 'b']),
      single: { kind: 'function', expression: "'{a,b}'::text[]" },
    });
  });

  it.each([
    ['NULL', false],
    ['NULL::jsonb', false],
    ['NULL::text[]', true],
  ])('reads %s as SQL NULL', (raw, many) => {
    expect(readPostgresDefault(raw, many)).toEqual({ kind: 'null' });
  });
});

describe('postgresResolveDefault', () => {
  const single = { typeText: 'int4', dataTypeId: 'pg/int4', many: false };

  it.each([
    ["nextval('my_seq'::regclass)", 'autoincrement()'],
    ['CURRENT_TIMESTAMP', 'now()'],
  ])('names the expression %s as introspection names it', (expression, named) => {
    expect(postgresResolveDefault({ kind: 'function', expression }, single)).toEqual({
      kind: 'function',
      expression: named,
    });
  });

  it('keeps an expression that is a literal as the expression', () => {
    const expression = "'{a,b}'::text[]";
    expect(
      postgresResolveDefault(
        { kind: 'function', expression },
        { typeText: 'text', dataTypeId: 'pg/text', many: true },
      ),
    ).toEqual({
      kind: 'function',
      expression,
    });
  });

  it('passes a literal default through unchanged', () => {
    const literal = { kind: 'literal' as const, value: 'draft' };
    expect(postgresResolveDefault(literal, single)).toEqual(literal);
  });
});
