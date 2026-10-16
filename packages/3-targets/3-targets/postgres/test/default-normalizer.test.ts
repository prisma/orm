import { describe, expect, it } from 'vitest';
import { postgresResolveDefault, readPostgresDefault } from '../src/core/default-normalizer';

const value = (body: string) => ({ kind: 'literal', literal: { kind: 'value', body } });
const list = (elements: readonly (string | null)[]) => ({
  kind: 'literal',
  literal: { kind: 'list', elements },
});

describe('readPostgresDefault', () => {
  it.each([
    ['a quoted string with its cast', "'draft'::text", 'text', 'draft'],
    ['a doubled quote', "'O''Reilly'::text", 'text', "O'Reilly"],
    ['a numeral', '42', 'int4', '42'],
    ['a quoted numeral cast to a number type', "'-1'::integer", 'int4', '-1'],
    ['a parenthesised numeral cast', '(1)::bigint', 'int8', '1'],
    ['a numeral in exponent notation', "'1e+20'::real", 'float4', '1e+20'],
    ['true', 'true', 'bool', 'true'],
    ['false', 'FALSE', 'bool', 'false'],
    ['a JSON document', `'{"a": 1}'::jsonb`, 'jsonb', '{"a": 1}'],
    ['bytea hex', "'\\x6869'::bytea", 'bytea', '\\x6869'],
    ['a date with its typed cast', "'2024-01-01'::date", 'date', '2024-01-01'],
    ['an enum member cast to a qualified type', '\'free\'::auth."Plan"', 'Plan', 'free'],
    ['an escape string', "E'a\\\\b\\nc'::text", 'text', 'a\\b\nc'],
  ])('takes the body out of %s', (_name, raw, nativeType, body) => {
    expect(readPostgresDefault(raw, nativeType)).toEqual(value(body));
  });

  it.each([
    ['an array literal', '\'{a,"b,c",NULL}\'::text[]', 'text[]', ['a', 'b,c', null]],
    ['an empty array literal', "'{}'::integer[]", 'int4[]', []],
    ['a constructor', "ARRAY['a'::text, NULL, 'b'::text]", 'text[]', ['a', null, 'b']],
    ['an empty constructor', 'ARRAY[]::text[]', 'text[]', []],
    ['a constructor of numerals and booleans', 'ARRAY[1, 2]', 'int4[]', ['1', '2']],
    ['a cast constructor', "(ARRAY['{}'::jsonb])::jsonb[]", 'jsonb[]', ['{}']],
  ])('takes the element bodies out of %s', (_name, raw, nativeType, elements) => {
    expect(readPostgresDefault(raw, nativeType)).toEqual(list(elements));
  });

  it.each([
    ["nextval('t_id_seq'::regclass)", 'int4', 'autoincrement()'],
    ['now()', 'timestamptz', 'now()'],
    ['CURRENT_TIMESTAMP', 'timestamptz', 'now()'],
    ["('now'::text)::timestamp with time zone", 'timestamptz', 'now()'],
    ['clock_timestamp()', 'timestamptz', 'clock_timestamp()'],
    ['uuid_generate_v4()', 'uuid', 'gen_random_uuid()'],
    ["(now() + '00:03:00'::interval)", 'timestamptz', "(now() + '00:03:00'::interval)"],
    ['(1.5)::integer', 'int4', '(1.5)::integer'],
    ['ARRAY[(1 + 1)]', 'int4[]', 'ARRAY[(1 + 1)]'],
  ])('reads %s as the function %s', (raw, nativeType, expression) => {
    expect(readPostgresDefault(raw, nativeType)).toEqual({ kind: 'function', expression });
  });

  it.each([
    ['NULL', 'text'],
    ['NULL::jsonb', 'jsonb'],
    ['NULL::text[]', 'text[]'],
  ])('reads %s as SQL NULL', (raw, nativeType) => {
    expect(readPostgresDefault(raw, nativeType)).toEqual({ kind: 'null' });
  });
});

describe('postgresResolveDefault', () => {
  it.each([
    ["nextval('my_seq'::regclass)", 'int4', 'autoincrement()'],
    ['CURRENT_TIMESTAMP', 'timestamptz', 'now()'],
  ])('names the expression %s as introspection names it', (expression, nativeType, named) => {
    expect(postgresResolveDefault({ kind: 'function', expression }, nativeType)).toEqual({
      kind: 'function',
      expression: named,
    });
  });

  it('keeps an expression that is a literal as the expression', () => {
    const expression = "'{a,b}'::text[]";
    expect(postgresResolveDefault({ kind: 'function', expression }, 'text[]')).toEqual({
      kind: 'function',
      expression,
    });
  });

  it('passes a literal default through unchanged', () => {
    const literal = { kind: 'literal' as const, value: 'draft' };
    expect(postgresResolveDefault(literal, 'text')).toEqual(literal);
  });
});
