/**
 * `refused-by-codec`: the parser reads a literal, but the column's codec refuses it because the column would round it on insert, so `contract infer` keeps the raw expression.
 */
export type FidelityExpectation =
  | 'literal'
  | 'raw'
  | 'refused-by-codec'
  | { readonly function: string };

export interface FidelityRow {
  readonly name: string;
  readonly storageType: string;
  readonly written: string;
  readonly expect: FidelityExpectation;
}

const literal = (name: string, storageType: string, written: string): FidelityRow => ({
  name,
  storageType,
  written,
  expect: 'literal',
});

const refusedByCodec = (name: string, storageType: string, written: string): FidelityRow => ({
  name,
  storageType,
  written,
  expect: 'refused-by-codec',
});

const raw = (name: string, storageType: string, written: string): FidelityRow => ({
  name,
  storageType,
  written,
  expect: 'raw',
});

const fn = (
  name: string,
  storageType: string,
  written: string,
  canonical: string,
): FidelityRow => ({
  name,
  storageType,
  written,
  expect: { function: canonical },
});

export const enumTypes = [{ name: 'Role', values: ['USER', 'ADMIN'] }] as const;

export const rows: readonly FidelityRow[] = [
  literal('text_plain', 'text', "'hello'"),
  literal('text_quote', 'text', "'a''b'"),
  literal('text_comma', 'text', "'a,b'"),
  literal('text_backslash', 'text', String.raw`'a\b'`),
  literal('text_double_quote', 'text', `'a"b'`),
  literal('text_spaces', 'text', "' a '"),
  literal('text_empty', 'text', "''"),
  literal('text_null_word', 'text', "'NULL'"),
  literal('text_true_word', 'text', "'true'"),
  literal('text_one', 'text', "'1'"),
  literal('text_cast', 'text', "'x'::text"),
  literal('varchar_plain', 'varchar(10)', "'abc'"),
  literal('varchar_quote', 'varchar(10)', "'a''b'"),
  literal('varchar_full', 'varchar(3)', "'abc'"),
  literal('char_full', 'char(3)', "'abc'"),
  literal('char_padded', 'char(3)', "'ab'"),
  literal('bool_true', 'boolean', 'true'),
  literal('bool_false', 'boolean', 'false'),
  literal('int4_plain', 'int4', '42'),
  literal('int4_negative', 'int4', '-7'),
  literal('int4_quoted', 'int4', "'5'::integer"),
  literal('int8_past_2_53', 'int8', '9007199254740993'),
  literal('int8_negative', 'int8', "'-1'::bigint"),
  literal('numeric_exact_scale', 'numeric(10,2)', '12.50'),
  literal('numeric_short_scale', 'numeric(10,2)', '12.5'),
  refusedByCodec('numeric_rounded', 'numeric(10,2)', '12.345'),
  literal('numeric_quoted', 'numeric(10,2)', "'-0.01'::numeric"),
  literal('float8_plain', 'float8', '1.5'),
  literal('float8_exponent', 'float8', "'1e300'::float8"),
  literal('date_plain', 'date', "'2024-02-29'::date"),
  literal('timestamp_millis', 'timestamp(3)', "'2024-01-02 03:04:05.678'::timestamp"),
  literal('timestamp_excess_precision', 'timestamp(3)', "'2024-01-02 03:04:05.6789'"),
  literal('timestamptz_utc', 'timestamptz', "'2024-01-02 03:04:05+00'::timestamptz"),
  literal('timestamptz_offset', 'timestamptz', "'2024-01-02 03:04:05+05:30'"),
  literal('uuid_lower', 'uuid', "'0e0f0a0b-0000-4000-8000-000000000001'::uuid"),
  literal('uuid_upper', 'uuid', "'0E0F0A0B-0000-4000-8000-000000000001'::uuid"),
  literal('json_object', 'json', `'{"a": 1}'::json`),
  literal('json_quote', 'json', `'["a''b"]'::json`),
  literal('jsonb_object', 'jsonb', `'{"b": 2, "a": 1}'::jsonb`),
  literal('jsonb_null', 'jsonb', "'null'::jsonb"),
  literal('jsonb_number', 'jsonb', "'1E2'::jsonb"),
  literal('json_number', 'json', "'1E2'::json"),
  literal('enum_member', '"Role"', `'ADMIN'::"Role"`),
  literal('text_arr_unquoted', 'text[]', "'{a,b}'::text[]"),
  literal('text_arr_quoted', 'text[]', `'{"a","b"}'::text[]`),
  literal('text_arr_uncast', 'text[]', "'{a,b}'"),
  literal('text_arr_spaced', 'text[]', "'{ a , b }'"),
  literal('text_arr_ctor', 'text[]', "ARRAY['a', 'b']"),
  literal('text_arr_ctor_cast', 'text[]', "ARRAY['a', 'b']::text[]"),
  literal('text_arr_ctor_elem_cast', 'text[]', "ARRAY['a'::text, 'b'::text]"),
  literal('text_arr_empty', 'text[]', "'{}'::text[]"),
  literal('text_arr_empty_uncast', 'text[]', "'{}'"),
  literal('text_arr_ctor_empty', 'text[]', 'ARRAY[]::text[]'),
  literal('text_arr_quote', 'text[]', `'{"a''b"}'::text[]`),
  literal('text_arr_comma', 'text[]', `'{"a,b"}'::text[]`),
  literal('text_arr_backslash', 'text[]', String.raw`'{"a\\b"}'::text[]`),
  literal('text_arr_double_quote', 'text[]', String.raw`'{"a\"b"}'::text[]`),
  literal('text_arr_spaces', 'text[]', `'{" a "}'::text[]`),
  literal('text_arr_empty_string', 'text[]', `'{""}'::text[]`),
  literal('text_arr_null_word', 'text[]', `'{"NULL"}'::text[]`),
  literal('text_arr_sql_null', 'text[]', "'{NULL,a}'::text[]"),
  literal('text_arr_true_one', 'text[]', `'{"true","1",true,1}'::text[]`),
  literal('text_arr_ctor_quote', 'text[]', "ARRAY['a''b']"),
  literal('text_arr_ctor_comma', 'text[]', "ARRAY['a,b', 'c']"),
  literal('text_arr_ctor_backslash', 'text[]', String.raw`ARRAY['a\b']`),
  literal('text_arr_ctor_double_quote', 'text[]', `ARRAY['a"b']`),
  literal('text_arr_ctor_spaces', 'text[]', "ARRAY[' a ', '']"),
  literal('text_arr_ctor_nulls', 'text[]', "ARRAY['NULL', NULL]"),
  literal('varchar_arr', 'varchar(10)[]', "'{x,y}'::varchar(10)[]"),
  literal('char_arr', 'char(3)[]', "'{abc}'::char(3)[]"),
  literal('bool_arr', 'boolean[]', "'{t,f}'::boolean[]"),
  literal('bool_arr_ctor', 'boolean[]', 'ARRAY[true, false]'),
  literal('int4_arr', 'int4[]', "'{1,2,3}'::int4[]"),
  literal('int4_arr_ctor', 'int4[]', 'ARRAY[1, -2]'),
  literal('int4_arr_empty', 'int4[]', "'{}'"),
  literal('int8_arr', 'int8[]', "'{9007199254740993,-1}'::int8[]"),
  literal('numeric_arr', 'numeric(10,2)[]', "'{1.50,2.25}'::numeric(10,2)[]"),
  literal('numeric_arr_short_scale', 'numeric(10,2)[]', "'{1.5}'"),
  literal('float8_arr', 'float8[]', "'{1.5,-2}'::float8[]"),
  literal('date_arr', 'date[]', "'{2024-01-01,2024-12-31}'::date[]"),
  literal('timestamp_arr', 'timestamp(3)[]', `'{"2024-01-02 03:04:05.678"}'::timestamp(3)[]`),
  literal('timestamptz_arr', 'timestamptz[]', `'{"2024-01-02 03:04:05+00"}'::timestamptz[]`),
  literal('uuid_arr', 'uuid[]', "'{0e0f0a0b-0000-4000-8000-000000000001}'::uuid[]"),
  literal('json_arr', 'json[]', String.raw`'{"{\"a\":1}","[2]"}'::json[]`),
  literal('jsonb_arr_unquoted', 'jsonb[]', `'{"[2]","[]"}'`),
  literal('jsonb_arr_ctor', 'jsonb[]', `ARRAY['{"a": 1}'::jsonb, 'null'::jsonb]`),
  literal('jsonb_arr_numbers', 'jsonb[]', "'{1.0,1E2,-0,0.1,5e-324,9007199254740994}'"),
  literal('enum_arr', '"Role"[]', `'{USER,ADMIN}'::"Role"[]`),
  raw('box_arr', 'box[]', "'{(3,4),(1,2)}'::box[]"),
  raw('text_arr_multidim', 'text[]', "'{{a,b},{c,d}}'::text[]"),
  raw('text_arr_multidim_uncast', 'text[]', "'{{a,b},{c,d}}'"),
  raw('text_arr_ctor_call', 'text[]', "ARRAY[upper('a')]"),
  raw('int4_expression', 'int4', '(1 + 1)'),
  raw('text_concat', 'text', "'a' || 'b'"),
  raw('text_call', 'text', "lower('X')"),
  raw('jsonb_big_integer', 'jsonb', "'12345678901234567890'::jsonb"),
  raw('jsonb_huge_number', 'jsonb', "'1e400'::jsonb"),
  raw('jsonb_arr_big_integer', 'jsonb[]', `'{"[12345678901234567890]"}'::jsonb[]`),
  raw('jsonb_arr_big_integer_uncast', 'jsonb[]', `'{"[12345678901234567890]"}'`),
  raw('jsonb_arr_huge_number', 'jsonb[]', `'{"[1e400]"}'::jsonb[]`),
  fn('timestamptz_now', 'timestamptz', 'now()', 'now()'),
  fn('timestamptz_current', 'timestamptz', 'CURRENT_TIMESTAMP', 'now()'),
  fn('uuid_random', 'uuid', 'gen_random_uuid()', 'gen_random_uuid()'),
];
