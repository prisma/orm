/**
 * Byte-parity oracle for the ALTER TABLE … ADD COLUMN lowering path.
 *
 * Asserts the exact SQL strings produced by the `PostgresAlterTable` +
 * `AddColumnAction` AST nodes lowered through `PostgresControlAdapter.lowerToExecuteRequest`.
 * All cases route through the codec-aware `pgRenderDdlColumn` path,
 * including codec-encoded defaults.
 *
 * Column attribute order in the rendered fragment:
 *   "name" type [DEFAULT ...] [NOT NULL] [PRIMARY KEY]
 */

import { col, fn, lit } from '@internal/sql-relational-core/contract-free';
import type { AnyPostgresCodecDescriptor } from '@internal/target-postgres/codec-descriptor';
import { addColumnAction, alterTable } from '@internal/target-postgres/contract-free';
import { PostgresAlterTable } from '@internal/target-postgres/ddl';
import { describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-lookup';
import { PostgresControlAdapter } from '../src/core/control-adapter';

const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());

describe('PostgresAlterTable ADD COLUMN lowering', () => {
  it('plain nullable column (no default, no NOT NULL)', async () => {
    const ast = alterTable({
      schema: 's',
      table: 't',
      actions: [addColumnAction(col('c', 'text'))],
    });
    const lowered = await adapter.lowerToExecuteRequest(ast);
    expect(lowered.sql).toBe('ALTER TABLE "s"."t" ADD COLUMN "c" text');
    expect(lowered.params).toEqual([]);
  });

  it('NOT NULL column (no default)', async () => {
    const ast = alterTable({
      schema: 's',
      table: 't',
      actions: [addColumnAction(col('c', 'text', { notNull: true }))],
    });
    const lowered = await adapter.lowerToExecuteRequest(ast);
    expect(lowered.sql).toBe('ALTER TABLE "s"."t" ADD COLUMN "c" text NOT NULL');
  });

  it('nullable column with literal string default', async () => {
    const ast = alterTable({
      schema: 's',
      table: 't',
      actions: [addColumnAction(col('c', 'text', { default: lit('hello') }))],
    });
    const lowered = await adapter.lowerToExecuteRequest(ast);
    expect(lowered.sql).toBe(`ALTER TABLE "s"."t" ADD COLUMN "c" text DEFAULT 'hello'`);
  });

  it('NOT NULL column with literal numeric default (DEFAULT before NOT NULL)', async () => {
    const ast = alterTable({
      schema: 's',
      table: 't',
      actions: [addColumnAction(col('count', 'int', { notNull: true, default: lit(0) }))],
    });
    const lowered = await adapter.lowerToExecuteRequest(ast);
    expect(lowered.sql).toBe('ALTER TABLE "s"."t" ADD COLUMN "count" int DEFAULT 0 NOT NULL');
  });

  it('nullable column with function default (now())', async () => {
    const ast = alterTable({
      schema: 's',
      table: 't',
      actions: [addColumnAction(col('created_at', 'timestamptz', { default: fn('now()') }))],
    });
    const lowered = await adapter.lowerToExecuteRequest(ast);
    expect(lowered.sql).toBe(
      'ALTER TABLE "s"."t" ADD COLUMN "created_at" timestamptz DEFAULT (now())',
    );
  });

  it('NOT NULL with literal boolean default', async () => {
    const ast = alterTable({
      schema: 's',
      table: 't',
      actions: [addColumnAction(col('active', 'boolean', { notNull: true, default: lit(true) }))],
    });
    const lowered = await adapter.lowerToExecuteRequest(ast);
    expect(lowered.sql).toBe(
      'ALTER TABLE "s"."t" ADD COLUMN "active" boolean DEFAULT true NOT NULL',
    );
  });

  it('unqualified (no schema) table reference', async () => {
    const ast = alterTable({
      table: 't',
      actions: [addColumnAction(col('c', 'text'))],
    });
    const lowered = await adapter.lowerToExecuteRequest(ast);
    expect(lowered.sql).toBe('ALTER TABLE "t" ADD COLUMN "c" text');
  });

  it('string literal default with single-quote escaping', async () => {
    const ast = alterTable({
      schema: 's',
      table: 't',
      actions: [addColumnAction(col('name', 'text', { default: lit("O'Reilly") }))],
    });
    const lowered = await adapter.lowerToExecuteRequest(ast);
    expect(lowered.sql).toBe(`ALTER TABLE "s"."t" ADD COLUMN "name" text DEFAULT 'O''Reilly'`);
  });

  it('non-text type gets a ::type cast on string literal default', async () => {
    const ast = alterTable({
      schema: 's',
      table: 't',
      actions: [
        addColumnAction(
          col('id', 'uuid', { default: lit('00000000-0000-0000-0000-000000000000') }),
        ),
      ],
    });
    const lowered = await adapter.lowerToExecuteRequest(ast);
    expect(lowered.sql).toBe(
      `ALTER TABLE "s"."t" ADD COLUMN "id" uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid`,
    );
  });

  it('codec-encoded default: pg/jsonb@1 encodes an object through the codec path', async () => {
    const ast = alterTable({
      schema: 's',
      table: 't',
      actions: [
        addColumnAction(
          col('meta', 'jsonb', {
            default: lit({ key: 'value' }),
            codecRef: { codecId: 'pg/jsonb@1' },
          }),
        ),
      ],
    });
    const lowered = await adapter.lowerToExecuteRequest(ast);
    expect(lowered.sql).toBe(
      `ALTER TABLE "s"."t" ADD COLUMN "meta" jsonb DEFAULT '{"key":"value"}'::jsonb`,
    );
  });

  describe('a parameterized column whose codec answers for its params', () => {
    // A codec whose wire form depends on the length its column declares, as `pg/vector@1` does.
    const descriptor = {
      codecId: 'test/vector@1',
      traits: ['equality'],
      targetTypes: ['vector'],
      isParameterized: true,
      paramsSchema: {
        '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) },
      },
      factory: (params: { readonly length: number }) => () => ({
        id: 'test/vector@1',
        encode: async (value: readonly number[]) => `[${value.join(',')}]`,
        decode: async (wire: unknown) => wire,
        encodeJson: (value: unknown) => value,
        decodeJson: (json: unknown) => {
          if (!Array.isArray(json) || json.length !== params.length) {
            throw new Error(`length mismatch: expected ${params.length}, got ${String(json)}`);
          }
          return [...json];
        },
      }),
    } as unknown as AnyPostgresCodecDescriptor;

    const builtin = createPostgresBuiltinCodecLookup();
    const withVector = new PostgresControlAdapter({
      ...builtin,
      // The representative instance carries no params, as the control stack's does.
      get: (id: string) =>
        id === 'test/vector@1' ? descriptor.factory({})({ name: id }) : builtin.get(id),
      descriptorFor: (id: string): AnyPostgresCodecDescriptor | undefined =>
        id === 'test/vector@1'
          ? descriptor
          : (builtin.descriptorFor(id) as AnyPostgresCodecDescriptor | undefined),
    });

    const vectorColumn = (length: number) =>
      alterTable({
        schema: 's',
        table: 't',
        actions: [
          addColumnAction(
            col('embedding', 'vector', {
              default: lit([0.5, 0.25, 0.125]),
              codecRef: { codecId: 'test/vector@1', typeParams: { length } },
            }),
          ),
        ],
      });

    it("renders the default through a codec built with the column's typeParams", async () => {
      const lowered = await withVector.lowerToExecuteRequest(vectorColumn(3));
      expect(lowered.sql).toBe(
        `ALTER TABLE "s"."t" ADD COLUMN "embedding" vector DEFAULT '[0.5,0.25,0.125]'::vector`,
      );
    });

    it('refuses a default whose length is not the length the column declares', async () => {
      await expect(withVector.lowerToExecuteRequest(vectorColumn(2))).rejects.toThrow(
        'length mismatch: expected 2',
      );
    });
  });

  it('params array is always empty for DDL', async () => {
    const ast = alterTable({
      schema: 's',
      table: 't',
      actions: [addColumnAction(col('c', 'text'))],
    });
    const lowered = await adapter.lowerToExecuteRequest(ast);
    expect(lowered.params).toEqual([]);
  });
});

describe('PostgresAlterTable node shape', () => {
  it('is a frozen PostgresDdlNode with kind "alter-table"', () => {
    const ast = alterTable({ table: 't', actions: [addColumnAction(col('c', 'text'))] });
    expect(ast).toBeInstanceOf(PostgresAlterTable);
    expect(Object.isFrozen(ast)).toBe(true);
    expect(ast.kind).toBe('alter-table');
  });

  it('AddColumnAction carries no primaryKey on the DdlColumn (planner invariant)', () => {
    const ddlCol = col('c', 'text', { notNull: true });
    const action = addColumnAction(ddlCol);
    expect(action.kind).toBe('add-column');
    expect(action.column.primaryKey).toBeFalsy();
  });
});
