import { describe, expect, it } from 'vitest';
import { parsePostgresDefault } from '../src/core/default-normalizer';

describe('parsePostgresDefault ARRAY[...] constructors', () => {
  it('reads a text array constructor with per-element casts', () => {
    expect(parsePostgresDefault("ARRAY['a'::text, 'b'::text]", 'text[]')).toEqual({
      kind: 'literal',
      value: ['a', 'b'],
    });
  });

  it('reads a numeric array constructor', () => {
    expect(parsePostgresDefault('ARRAY[1, 2]', 'integer[]')).toEqual({
      kind: 'literal',
      value: [1, 2],
    });
  });

  it('reads enum element casts, quoted and schema-qualified', () => {
    expect(parsePostgresDefault('ARRAY[\'x\'::"MyEnum"]', 'MyEnum[]')).toEqual({
      kind: 'literal',
      value: ['x'],
    });
    expect(
      parsePostgresDefault('ARRAY[\'x\'::sch."MyEnum", \'y\'::sch."MyEnum"]', 'sch.MyEnum[]'),
    ).toEqual({
      kind: 'literal',
      value: ['x', 'y'],
    });
  });

  it('keeps commas and doubled quotes inside an element', () => {
    expect(parsePostgresDefault("ARRAY['it''s, ok'::text, 'b'::text]", 'text[]')).toEqual({
      kind: 'literal',
      value: ["it's, ok", 'b'],
    });
  });

  it('reads an empty constructor and a cast constructor', () => {
    expect(parsePostgresDefault('ARRAY[]::text[]', 'text[]')).toEqual({
      kind: 'literal',
      value: [],
    });
    expect(parsePostgresDefault("ARRAY['a', 'b']::text[]", 'text[]')).toEqual({
      kind: 'literal',
      value: ['a', 'b'],
    });
  });

  it('fails closed for an element it cannot read', () => {
    expect(parsePostgresDefault('ARRAY[now()]', 'timestamptz[]')?.kind).toBe('function');
  });
});

describe('parsePostgresDefault ARRAY[...] elements Postgres prints with a cast', () => {
  it.each([
    { raw: "ARRAY['-1'::integer, 2]", nativeType: 'int4[]', value: [-1, 2] },
    { raw: 'ARRAY[(1)::bigint, (2)::bigint]', nativeType: 'int8[]', value: ['1', '2'] },
    {
      raw: "ARRAY[('-1'::integer)::bigint, (2)::bigint]",
      nativeType: 'int8[]',
      value: ['-1', '2'],
    },
    {
      raw: 'ARRAY[(1.5)::double precision, (2)::double precision]',
      nativeType: 'float8[]',
      value: [1.5, 2],
    },
    {
      raw: "ARRAY[('-1.5'::numeric)::double precision, (2)::double precision]",
      nativeType: 'float8[]',
      value: [-1.5, 2],
    },
    { raw: 'ARRAY[1.5::numeric(65,30)]', nativeType: 'numeric(65,30)[]', value: ['1.5'] },
    {
      raw: "ARRAY['-1.5'::numeric(65,30), (2)::numeric(65,30)]",
      nativeType: 'numeric(65,30)[]',
      value: ['-1.5', '2'],
    },
    {
      raw: 'ARRAY[12345678901234567890.123456789::numeric(65,30)]',
      nativeType: 'numeric(65,30)[]',
      value: ['12345678901234567890.123456789'],
    },
    {
      raw: "ARRAY[1.5::numeric(10,2), '-2.25'::numeric(10,2)]",
      nativeType: 'numeric(10,2)[]',
      value: ['1.5', '-2.25'],
    },
    { raw: 'ARRAY[(2)::numeric(10,2)]', nativeType: 'numeric(10,2)[]', value: ['2'] },
    {
      raw: "ARRAY[('-1'::integer)::smallint, (2)::smallint]",
      nativeType: 'int2[]',
      value: [-1, 2],
    },
    { raw: 'ARRAY[(1.1)::real]', nativeType: 'float4[]', value: [1.1] },
    {
      raw: "ARRAY['2024-01-01 00:00:00'::timestamp(3) without time zone]",
      nativeType: 'timestamp(3)[]',
      value: ['2024-01-01 00:00:00'],
    },
    {
      raw: "ARRAY['2024-01-01 00:00:00+00'::timestamp(3) with time zone]",
      nativeType: 'timestamptz(3)[]',
      value: ['2024-01-01 00:00:00+00'],
    },
  ])('reads $raw by each element cast', ({ raw, nativeType, value }) => {
    expect(parsePostgresDefault(raw, nativeType)).toEqual({ kind: 'literal', value });
  });

  it.each([
    {
      raw: '(ARRAY[]::character varying[])::character varying(32)[]',
      nativeType: 'character varying(32)[]',
      value: [],
    },
    {
      raw: "(ARRAY['a'::character varying])::character varying(32)[]",
      nativeType: 'character varying(32)[]',
      value: ['a'],
    },
  ])('unwraps the outer cast in $raw', ({ raw, nativeType, value }) => {
    expect(parsePostgresDefault(raw, nativeType)).toEqual({ kind: 'literal', value });
  });

  it('reads an empty constructor cast to a multi-word type', () => {
    expect(parsePostgresDefault('ARRAY[]::character varying[]', 'character varying[]')).toEqual({
      kind: 'literal',
      value: [],
    });
  });
});
