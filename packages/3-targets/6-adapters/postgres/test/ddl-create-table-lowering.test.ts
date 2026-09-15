import { col, fn, lit } from '@internal/sql-relational-core/contract-free';
import { PostgresCreateTable } from '@internal/target-postgres/ddl';
import { describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-lookup';
import { PostgresControlAdapter } from '../src/core/control-adapter';
import type { PostgresContract } from '../src/core/types';

describe('PostgresCreateTable DDL lowering', () => {
  it('renders IF NOT EXISTS on schema-qualified create table', async () => {
    const ast = new PostgresCreateTable({
      schema: 'prisma_contract',
      table: 'marker',
      ifNotExists: true,
      columns: [
        col('space', 'text', { notNull: true, primaryKey: true }),
        col('core_hash', 'text', { notNull: true }),
      ],
    });

    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const lowered = await adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract });

    expect(lowered.sql).toBe(
      'CREATE TABLE IF NOT EXISTS "prisma_contract"."marker" (\n  "space" text NOT NULL PRIMARY KEY,\n  "core_hash" text NOT NULL\n)',
    );
    expect(lowered.params).toEqual([]);
  });

  it('renders each column default shape', async () => {
    const ast = new PostgresCreateTable({
      table: 'defaults',
      columns: [
        col('a', 'text', { default: lit('x') }),
        col('b', 'int', { default: lit(7) }),
        col('c', 'boolean', { default: lit(true) }),
        col('d', 'text', { default: lit(null) }),
        col('e', 'timestamptz', { default: fn('now()') }),
        col('f', 'uuid', { default: fn('gen_random_uuid()') }),
        col('g', 'bigserial', { default: fn('autoincrement()') }),
      ],
    });

    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const lowered = await adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract });

    expect(lowered.sql).toContain(`"a" text DEFAULT 'x'`);
    expect(lowered.sql).toContain('"b" int DEFAULT 7');
    expect(lowered.sql).toContain('"c" boolean DEFAULT true');
    expect(lowered.sql).toContain('"d" text DEFAULT NULL');
    expect(lowered.sql).toContain('"e" timestamptz DEFAULT (now())');
    expect(lowered.sql).toContain('"f" uuid DEFAULT (gen_random_uuid())');
    expect(lowered.sql).toContain('"g" bigserial');
    expect(lowered.sql).not.toContain('autoincrement');
  });

  it('throws when an autoincrement() default is paired with a non-SERIAL-family type', async () => {
    const ast = new PostgresCreateTable({
      table: 'defaults',
      columns: [col('id', 'int4', { notNull: true, default: fn('autoincrement()') })],
    });

    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    await expect(
      adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract }),
    ).rejects.toMatchObject({
      code: 'CONTRACT.DEFAULT_INVALID',
      meta: { nativeType: 'int4' },
    });
  });

  it('accepts lowercase SERIAL-family pseudo-types paired with autoincrement()', async () => {
    const ast = new PostgresCreateTable({
      table: 'defaults',
      columns: [
        col('a', 'serial', { default: fn('autoincrement()') }),
        col('b', 'SMALLSERIAL', { default: fn('autoincrement()') }),
      ],
    });

    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const lowered = await adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract });

    expect(lowered.sql).toContain('"a" serial');
    expect(lowered.sql).toContain('"b" SMALLSERIAL');
    expect(lowered.sql).not.toContain('autoincrement');
  });

  it('accepts serial2/serial4/serial8 aliases paired with autoincrement()', async () => {
    const ast = new PostgresCreateTable({
      table: 'defaults',
      columns: [
        col('a', 'serial2', { default: fn('autoincrement()') }),
        col('b', 'serial4', { default: fn('autoincrement()') }),
        col('c', 'serial8', { default: fn('autoincrement()') }),
      ],
    });

    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const lowered = await adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract });

    expect(lowered.sql).toContain('"a" serial2');
    expect(lowered.sql).toContain('"b" serial4');
    expect(lowered.sql).toContain('"c" serial8');
    expect(lowered.sql).not.toContain('autoincrement');
  });

  it('escapes single quotes in string-literal defaults', async () => {
    const ast = new PostgresCreateTable({
      table: 'defaults',
      columns: [col('name', 'text', { default: lit("O'Reilly") })],
    });

    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const lowered = await adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract });

    expect(lowered.sql).toContain(`"name" text DEFAULT 'O''Reilly'`);
  });

  it('escapes single quotes in JSON-object literal defaults on jsonb columns and adds the ::jsonb cast', async () => {
    const ast = new PostgresCreateTable({
      table: 'defaults',
      columns: [col('meta', 'jsonb', { default: lit({ a: "x'y" }) })],
    });

    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const lowered = await adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract });

    expect(lowered.sql).toContain(`"meta" jsonb DEFAULT '{"a":"x''y"}'::jsonb`);
  });

  it('casts a string literal default to the column type on non-text columns', async () => {
    // The literal `'abc-...'` parses as `text` by default; without the
    // cast Postgres would attempt an implicit text → uuid coercion at
    // default-evaluation time, which exists for some target types
    // (jsonb, json, text aliases) and not for others (PostGIS,
    // user-defined types). Emitting the cast is the form that
    // generalises.
    const ast = new PostgresCreateTable({
      table: 'defaults',
      columns: [
        col('id', 'uuid', { default: lit('00000000-0000-0000-0000-000000000000') }),
        col('window', 'tstzrange', { default: lit('[2024-01-01,2024-12-31)') }),
        col('birthdate', 'date', { default: lit('2024-01-01') }),
      ],
    });
    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const lowered = await adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract });
    expect(lowered.sql).toContain(`"id" uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid`);
    expect(lowered.sql).toContain(
      `"window" tstzrange DEFAULT '[2024-01-01,2024-12-31)'::tstzrange`,
    );
    expect(lowered.sql).toContain(`"birthdate" date DEFAULT '2024-01-01'::date`);
  });

  it('omits the cast when the column type is already text-shaped', async () => {
    // `text`, `varchar(N)`, `character varying(N)`, `char(N)`,
    // `character(N)` all type a string literal identically — the
    // implicit cast is a no-op, so the explicit cast would only add
    // noise. Plain `varchar` / `character varying` / `char` /
    // `character` without parameters fall in the same bucket.
    const ast = new PostgresCreateTable({
      table: 'defaults',
      columns: [
        col('a_text', 'text', { default: lit('hello') }),
        col('a_varchar', 'varchar(50)', { default: lit('hello') }),
        col('a_character_varying', 'character varying(255)', { default: lit('hello') }),
        col('a_char', 'char(8)', { default: lit('hello') }),
        col('a_character', 'character(8)', { default: lit('hello') }),
      ],
    });
    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const lowered = await adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract });
    expect(lowered.sql).toContain(`"a_text" text DEFAULT 'hello'`);
    expect(lowered.sql).toContain(`"a_varchar" varchar(50) DEFAULT 'hello'`);
    expect(lowered.sql).toContain(`"a_character_varying" character varying(255) DEFAULT 'hello'`);
    expect(lowered.sql).toContain(`"a_char" char(8) DEFAULT 'hello'`);
    expect(lowered.sql).toContain(`"a_character" character(8) DEFAULT 'hello'`);
    expect(lowered.sql).not.toContain('::text');
    expect(lowered.sql).not.toContain('::varchar');
    expect(lowered.sql).not.toContain('::char');
    expect(lowered.sql).not.toContain('::character');
  });

  it('omits the cast on numeric, boolean, and null literal defaults', async () => {
    // These literals are typed by Postgres directly (no `text`
    // indirection), so they need no explicit cast.
    const ast = new PostgresCreateTable({
      table: 'defaults',
      columns: [
        col('a_int', 'int', { default: lit(42) }),
        col('a_float', 'float8', { default: lit(3.14) }),
        col('a_bool', 'boolean', { default: lit(true) }),
        col('a_nullable', 'uuid', { default: lit(null) }),
      ],
    });
    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const lowered = await adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract });
    expect(lowered.sql).toContain('"a_int" int DEFAULT 42');
    expect(lowered.sql).toContain('"a_float" float8 DEFAULT 3.14');
    expect(lowered.sql).toContain('"a_bool" boolean DEFAULT true');
    expect(lowered.sql).toContain('"a_nullable" uuid DEFAULT NULL');
    expect(lowered.sql).not.toContain('::');
  });

  it('omits the cast on function defaults — a `DEFAULT (expr)` already returns the column type', async () => {
    const ast = new PostgresCreateTable({
      table: 'defaults',
      columns: [
        col('id', 'uuid', { default: fn('gen_random_uuid()') }),
        col('meta', 'jsonb', { default: fn(`jsonb_build_object('k', 1)`) }),
      ],
    });
    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const lowered = await adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract });
    expect(lowered.sql).toContain('"id" uuid DEFAULT (gen_random_uuid())');
    expect(lowered.sql).toContain(`"meta" jsonb DEFAULT (jsonb_build_object('k', 1))`);
    expect(lowered.sql).not.toContain('::');
  });

  it('renders a list literal default as an ARRAY[...] expression cast to the column type', async () => {
    const ast = new PostgresCreateTable({
      table: 'lists',
      columns: [
        col('ids', 'int8[]', {
          default: lit(['1', '-2', '9007199254740993']),
          codecRef: { codecId: 'pg/int8@1', many: true },
        }),
        col('amounts', 'numeric(10,2)[]', {
          default: lit(['1.5', '-2.25']),
          codecRef: {
            codecId: 'pg/numeric@1',
            typeParams: { precision: 10, scale: 2 },
            many: true,
          },
        }),
        col('stamps', 'timestamp(3)[]', {
          default: lit(['2024-01-01T00:00:00']),
          codecRef: {
            codecId: 'pg/timestamp-temporal@1',
            typeParams: { precision: 3 },
            many: true,
          },
        }),
        col('tags', 'text[]', { default: lit([]), codecRef: { codecId: 'pg/text@1', many: true } }),
      ],
    });
    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const lowered = await adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract });
    expect(lowered.sql).toContain(
      `"ids" int8[] DEFAULT ARRAY['1', '-2', '9007199254740993']::int8[]`,
    );
    expect(lowered.sql).toContain(
      `"amounts" numeric(10,2)[] DEFAULT ARRAY['1.5', '-2.25']::numeric(10,2)[]`,
    );
    expect(lowered.sql).toContain(
      `"stamps" timestamp(3)[] DEFAULT ARRAY['2024-01-01T00:00:00']::timestamp(3)[]`,
    );
    expect(lowered.sql).toContain(`"tags" text[] DEFAULT '{}'`);
  });

  it('column with both default and notNull renders DEFAULT before NOT NULL, neither dropped', async () => {
    const ast = new PostgresCreateTable({
      table: 't',
      columns: [
        col('active', 'bool', { notNull: true, default: lit(true) }),
        col('status', 'text', { notNull: true, default: lit('open') }),
      ],
    });
    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const lowered = await adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract });
    expect(lowered.sql).toContain('"active" bool DEFAULT true NOT NULL');
    expect(lowered.sql).toContain(`"status" text DEFAULT 'open' NOT NULL`);
  });
});
