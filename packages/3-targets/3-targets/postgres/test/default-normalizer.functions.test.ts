import { describe, expect, it } from 'vitest';
import { parsePostgresDefault, postgresResolveDefault } from '../src/core/default-normalizer';

describe('parsePostgresDefault sequences', () => {
  it('normalizes nextval(...) to autoincrement()', () => {
    expect(parsePostgresDefault("nextval('foo_id_seq'::regclass)")).toEqual({
      kind: 'function',
      expression: 'autoincrement()',
    });
  });
});

describe('parsePostgresDefault timestamps', () => {
  it('normalizes now()', () => {
    expect(parsePostgresDefault('now()')).toEqual({ kind: 'function', expression: 'now()' });
  });

  it('normalizes CURRENT_TIMESTAMP', () => {
    expect(parsePostgresDefault('CURRENT_TIMESTAMP')).toEqual({
      kind: 'function',
      expression: 'now()',
    });
  });

  it('normalizes clock_timestamp()', () => {
    expect(parsePostgresDefault('clock_timestamp()')).toEqual({
      kind: 'function',
      expression: 'clock_timestamp()',
    });
  });

  it('normalizes now() with a bare ::timestamp cast suffix', () => {
    expect(parsePostgresDefault('now()::timestamp')).toEqual({
      kind: 'function',
      expression: 'now()',
    });
  });

  it('normalizes clock_timestamp() with a ::timestamptz cast suffix', () => {
    expect(parsePostgresDefault('clock_timestamp()::timestamptz')).toEqual({
      kind: 'function',
      expression: 'clock_timestamp()',
    });
  });

  it('normalizes now() with a "with time zone" cast suffix', () => {
    expect(parsePostgresDefault('now()::timestamp with time zone')).toEqual({
      kind: 'function',
      expression: 'now()',
    });
  });

  it('normalizes CURRENT_TIMESTAMP with a "without time zone" cast suffix', () => {
    expect(parsePostgresDefault('CURRENT_TIMESTAMP::timestamp without time zone')).toEqual({
      kind: 'function',
      expression: 'now()',
    });
  });

  it('unwraps a parenthesized now() before a timestamp cast', () => {
    expect(parsePostgresDefault('(now())::timestamp')).toEqual({
      kind: 'function',
      expression: 'now()',
    });
  });

  it('unwraps a parenthesized clock_timestamp() before a timestamp cast', () => {
    expect(parsePostgresDefault('(clock_timestamp())::timestamptz')).toEqual({
      kind: 'function',
      expression: 'clock_timestamp()',
    });
  });

  it("unwraps a parenthesized 'now'::text before a timestamp cast", () => {
    expect(parsePostgresDefault("('now'::text)::timestamp")).toEqual({
      kind: 'function',
      expression: 'now()',
    });
  });

  it('falls back to a function expression when the parenthesized inner expression is unrecognized', () => {
    expect(parsePostgresDefault('(SELECT 2)::timestamp')).toEqual({
      kind: 'function',
      expression: '(SELECT 2)::timestamp',
    });
  });

  it('falls back to a function expression for an unbalanced leading paren before a timestamp cast', () => {
    expect(parsePostgresDefault('(SELECT 1::timestamp')).toEqual({
      kind: 'function',
      expression: '(SELECT 1::timestamp',
    });
  });

  it('treats a quoted date string with a timestamp cast as a plain string literal, not a timestamp function', () => {
    expect(parsePostgresDefault("'2024-01-01'::timestamp")).toEqual({
      kind: 'literal',
      value: '2024-01-01',
    });
  });
});

describe('parsePostgresDefault UUIDs', () => {
  it('normalizes gen_random_uuid()', () => {
    expect(parsePostgresDefault('gen_random_uuid()')).toEqual({
      kind: 'function',
      expression: 'gen_random_uuid()',
    });
  });

  it('normalizes uuid-ossp uuid_generate_v4() to gen_random_uuid()', () => {
    expect(parsePostgresDefault('uuid_generate_v4()')).toEqual({
      kind: 'function',
      expression: 'gen_random_uuid()',
    });
  });
});

describe('parsePostgresDefault unparseable expressions', () => {
  it('falls back to a raw function expression for an arbitrary SQL expression', () => {
    expect(parsePostgresDefault('some_custom_function(1, 2)')).toEqual({
      kind: 'function',
      expression: 'some_custom_function(1, 2)',
    });
  });
});

describe('postgresResolveDefault', () => {
  // The contract-derived (expected) side's `resolveDefault` hook, called at
  // `SchemaIR` construction so the expected side normalizes a raw sql`...`
  // default whose body is a literal the same way introspection does. If this
  // ever passes the contract default through unnormalized, `db verify`
  // reports permanent drift for a jsonb/text[] literal default that matches
  // the live database exactly.

  it('a literal default passes through unchanged', () => {
    const literal = { kind: 'literal' as const, value: 'draft' };
    expect(postgresResolveDefault(literal, 'text')).toEqual(literal);
  });

  it('resolves a raw jsonb literal default to a literal object, matching introspection', () => {
    const result = postgresResolveDefault({ kind: 'function', expression: "'{}'::jsonb" }, 'jsonb');
    expect(result).toEqual({ kind: 'literal', value: {} });
  });

  it('resolves a raw text[] literal default to a literal array, matching introspection', () => {
    const result = postgresResolveDefault(
      { kind: 'function', expression: "'{}'::text[]" },
      'text[]',
    );
    expect(result).toEqual({ kind: 'literal', value: [] });
  });

  it('resolves a raw text[] default with unquoted elements to the literal introspection produces', () => {
    const expression = "'{a,b}'::text[]";
    expect(postgresResolveDefault({ kind: 'function', expression }, 'text[]')).toEqual({
      kind: 'literal',
      value: ['a', 'b'],
    });
  });

  it('normalizes a raw nextval(...) default to autoincrement(), matching a serial/identity column', () => {
    const result = postgresResolveDefault(
      { kind: 'function', expression: "nextval('my_seq'::regclass)" },
      'int4',
    );
    expect(result).toEqual({ kind: 'function', expression: 'autoincrement()' });
  });

  it('keeps gen_random_uuid() a function, unresolved', () => {
    const expression = 'gen_random_uuid()';
    expect(postgresResolveDefault({ kind: 'function', expression }, 'uuid')).toEqual({
      kind: 'function',
      expression,
    });
  });

  it('keeps a now()-plus-interval expression a function, unresolved', () => {
    const expression = "(now() + '00:03:00'::interval)";
    expect(postgresResolveDefault({ kind: 'function', expression }, 'timestamptz')).toEqual({
      kind: 'function',
      expression,
    });
  });

  it('resolves a literal cast to a schema-qualified enum type to the literal', () => {
    const expression = "'confidential'::auth.oauth_client_type";
    expect(postgresResolveDefault({ kind: 'function', expression }, 'oauth_client_type')).toEqual({
      kind: 'literal',
      value: 'confidential',
    });
  });
});

describe('parsePostgresDefault expressions that are not literals', () => {
  it.each([
    { raw: '(- (1.5)::double precision)', nativeType: 'float8' },
    { raw: '(- 1.5::numeric(10,2))', nativeType: 'numeric(10,2)' },
    { raw: '((1 + 2))::bigint', nativeType: 'int8' },
    { raw: "('a'::text || 'b'::text)", nativeType: 'text' },
    { raw: 'round(1.555, 2)', nativeType: 'numeric' },
    { raw: 'ARRAY[(1 + 1)]', nativeType: 'int4[]' },
    { raw: 'ARRAY[ARRAY[1, 2]]', nativeType: 'int4[]' },
    { raw: '(1.5)::integer', nativeType: 'int4' },
    { raw: 'ARRAY[(1.5)::integer]', nativeType: 'int4[]' },
    { raw: "('now'::text)::date", nativeType: 'date' },
    { raw: "ARRAY[('today'::text)::date]", nativeType: 'date[]' },
  ])('keeps $raw a raw expression', ({ raw, nativeType }) => {
    expect(parsePostgresDefault(raw, nativeType)).toEqual({ kind: 'function', expression: raw });
  });
});
