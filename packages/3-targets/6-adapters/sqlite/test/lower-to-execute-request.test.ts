import type { Codec } from '@internal/framework-components/codec';
import {
  CodecDescriptorImpl,
  dataTypeId,
  voidParamsSchema,
} from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageTableInput } from '@internal/sql-contract/types';
import type { ContractCodecRegistry } from '@internal/sql-relational-core/ast';
import { col, fn, lit } from '@internal/sql-relational-core/contract-free';
import {
  type AnySqliteCodecDescriptor,
  sqliteCodec,
} from '@internal/target-sqlite/codec-descriptor';
import { jsonText, sqliteTable, text } from '@internal/target-sqlite/contract-free';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { SqliteCreateTable } from '@internal/target-sqlite/ddl';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  createSqliteBuiltinCodecLookup,
  createSqliteCodecRegistryWithBuiltins,
} from '../src/core/codec-lookup';
import { SqliteControlAdapter } from '../src/core/control-adapter';
import { encodeControlQueryParams } from '../src/core/control-codecs';
import type { SqliteContract } from '../src/core/types';

const adapter = new SqliteControlAdapter(createSqliteBuiltinCodecLookup());
const ctx = { contract: {} as SqliteContract };

/**
 * A codec whose `encode` transforms its input. The raw value never appears
 * in correct output, so this distinguishes codec routing (walker calls
 * `encode`, inlines the wire result) from the type-branching fallback.
 */
const transformingCodec = {
  id: 'test/transform@1',
  encode: async (value: unknown) => `ENC:${String(value).toUpperCase()}`,
  decode: async (wire: unknown) => wire,
  encodeJson: (value: unknown) => value,
  decodeJson: (json: unknown) => json,
} as unknown as Codec;

const transformingDescriptor: AnySqliteCodecDescriptor = {
  descriptorKind: 'sqlite-codec',
  codecId: 'test/transform@1',
  dataType: dataTypeId('test/transform'),
  traits: [],
  targetTypes: ['TEXT'],
  paramsSchema: voidParamsSchema,
  isParameterized: false,
  factory: () => () => transformingCodec,
  projectJson: (expression) => expression,
};

const transformingLookup = createSqliteCodecRegistryWithBuiltins([transformingDescriptor]);

describe('SqliteControlAdapter.lowerToExecuteRequest — DDL literal defaults', () => {
  it('inlines a string default with single-quoting (no cast suffix)', async () => {
    const ast = new SqliteCreateTable({
      table: 't',
      columns: [col('name', 'TEXT', { default: lit('hello') })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain(`"name" TEXT DEFAULT 'hello'`);
    expect(result.sql).not.toContain('::');
    expect(result.params).toEqual([]);
  });

  it('inlines a Date default as ISO string (no cast suffix)', async () => {
    const date = new Date('2025-06-01T00:00:00.000Z');
    const ast = new SqliteCreateTable({
      table: 'events',
      columns: [col('created_at', 'TEXT', { default: lit(date) })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain(`"created_at" TEXT DEFAULT '2025-06-01T00:00:00.000Z'`);
    expect(result.sql).not.toContain('::');
    expect(result.params).toEqual([]);
  });

  it('inlines a bigint-equivalent number default as a bare integer string', async () => {
    const ast = new SqliteCreateTable({
      table: 'counters',
      columns: [col('n', 'INTEGER', { default: lit(9007199254740991) })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain('"n" INTEGER DEFAULT 9007199254740991');
    expect(result.params).toEqual([]);
  });

  it('inlines boolean true as 1 and false as 0', async () => {
    const ast = new SqliteCreateTable({
      table: 'flags',
      columns: [
        col('active', 'INTEGER', { default: lit(true) }),
        col('disabled', 'INTEGER', { default: lit(false) }),
      ],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain('"active" INTEGER DEFAULT 1');
    expect(result.sql).toContain('"disabled" INTEGER DEFAULT 0');
    expect(result.params).toEqual([]);
  });

  it('inlines a JSON-object default as single-quoted JSON (no cast suffix)', async () => {
    const ast = new SqliteCreateTable({
      table: 't',
      columns: [col('meta', 'TEXT', { default: lit({ key: 'val' }) })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain(`"meta" TEXT DEFAULT '{"key":"val"}'`);
    expect(result.sql).not.toContain('::');
    expect(result.params).toEqual([]);
  });

  it('inlines a null default as DEFAULT NULL', async () => {
    const ast = new SqliteCreateTable({
      table: 't',
      columns: [col('opt', 'TEXT', { default: lit(null) })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain('"opt" TEXT DEFAULT NULL');
    expect(result.params).toEqual([]);
  });

  it('preserves a function default expression unchanged', async () => {
    const ast = new SqliteCreateTable({
      table: 't',
      columns: [
        col('ts', 'TEXT', { default: fn("datetime('now')") }),
        col('id', 'INTEGER', { default: fn('autoincrement()') }),
      ],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain(`"ts" TEXT DEFAULT (datetime('now'))`);
    expect(result.sql).toContain('"id" INTEGER');
    expect(result.sql).not.toContain('autoincrement');
  });

  it("maps the canonical now() function default to SQLite's datetime('now')", async () => {
    const ast = new SqliteCreateTable({
      table: 't',
      columns: [col('created_at', 'TEXT', { default: fn('now()') })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    // SQLite has no now(); the contract canonicalizes CURRENT_TIMESTAMP to
    // now(), which must map back to a valid SQLite expression at apply time.
    expect(result.sql).toContain(`"created_at" TEXT DEFAULT (datetime('now'))`);
    expect(result.sql).not.toContain('(now())');
    expect(result.params).toEqual([]);
  });

  it('escapes single quotes in string defaults', async () => {
    const ast = new SqliteCreateTable({
      table: 't',
      columns: [col('name', 'TEXT', { default: lit("O'Brien") })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain(`"name" TEXT DEFAULT 'O''Brien'`);
    expect(result.params).toEqual([]);
  });
});

describe('SqliteControlAdapter.lowerToExecuteRequest — guards', () => {
  it('throws when a numeric literal default is non-finite (NaN / ±Infinity)', async () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const ast = new SqliteCreateTable({
        table: 'defaults',
        columns: [col('x', 'INTEGER', { default: lit(value) })],
      });
      await expect(adapter.lowerToExecuteRequest(ast, ctx)).rejects.toThrow(
        /non-finite number wire value/,
      );
    }
  });

  it('throws when a Date literal default is invalid', async () => {
    const ast = new SqliteCreateTable({
      table: 'defaults',
      columns: [col('x', 'TEXT', { default: lit(new Date('not-a-date')) })],
    });
    await expect(adapter.lowerToExecuteRequest(ast, ctx)).rejects.toThrow(/invalid Date/);
  });
});

describe('SqliteControlAdapter.lowerToExecuteRequest — codec routing + DDL shape', () => {
  it('routes a codec-bearing literal default through codec.encode (not raw type-branching)', async () => {
    const codecAdapter = new SqliteControlAdapter(transformingLookup);
    const ast = new SqliteCreateTable({
      table: 'secrets',
      columns: [
        col('token', 'TEXT', {
          default: lit('plaintext'),
          codecRef: { codecId: 'test/transform@1' },
        }),
      ],
    });
    const result = await codecAdapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain(`DEFAULT 'ENC:PLAINTEXT'`);
    expect(result.sql).not.toContain('plaintext');
  });

  it('renders IF NOT EXISTS with quoted identifiers (bootstrap control-table shape)', async () => {
    const ast = new SqliteCreateTable({
      table: '_prisma_marker',
      ifNotExists: true,
      columns: [col('space', 'TEXT', { notNull: true, primaryKey: true })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      'CREATE TABLE IF NOT EXISTS "_prisma_marker" (\n  "space" TEXT NOT NULL PRIMARY KEY\n)',
    );
    expect(result.params).toEqual([]);
  });
});

const TEST_CODEC_ID = 'test/transform@1';

const transformingQueryCodec: Codec = {
  id: TEST_CODEC_ID,
  encode: async (value: unknown) => `ENC:${String(value).toUpperCase()}`,
  decode: async (wire: unknown) => wire,
  encodeJson: (v) => v as never,
  decodeJson: (v) => v as never,
};

const testRegistry: ContractCodecRegistry = {
  forColumn: () => undefined,
  forCodecRef: (ref) => {
    if (ref.codecId === TEST_CODEC_ID) return transformingQueryCodec;
    throw new Error(`unknown codec ${ref.codecId}`);
  },
};

const testTable = sqliteTable('things', {
  label: { codecId: TEST_CODEC_ID, nullable: false },
  name: text(),
});

const jsonTable = sqliteTable('json_things', {
  meta: jsonText(),
  name: text(),
});

describe('SqliteControlAdapter.lowerToExecuteRequest — query branch encoding', () => {
  it('codec-encodes a literal param bound to a transforming-codec column', async () => {
    const ast = testTable.select(testTable.label).where(testTable.label.eq('plaintext')).build();
    const lowered = adapter.lower(ast, ctx);
    const params = await encodeControlQueryParams(lowered, ast, testRegistry);
    expect(params).not.toContain('plaintext');
    expect(params).toContain('ENC:PLAINTEXT');
  });

  it('passes uncodec-d params through unchanged', async () => {
    const ast = testTable.select(testTable.name).where(testTable.name.eq('raw-value')).build();
    const lowered = adapter.lower(ast, ctx);
    const params = await encodeControlQueryParams(lowered, ast);
    expect(params).toContain('raw-value');
  });

  it('lowerToExecuteRequest query branch returns an execute request for a plain column', async () => {
    const ast = testTable.select(testTable.name).where(testTable.name.eq('value')).build();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toHaveProperty('sql');
    expect(result.params).toContain('value');
  });

  it('lowerToExecuteRequest encodes a jsonText param end-to-end via CONTROL_CODECS', async () => {
    const ast = jsonTable
      .select(jsonTable.name)
      .where(jsonTable.meta.eq({ key: 'val' }))
      .build();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.params).toContain('{"key":"val"}');
    expect(result.params).not.toContainEqual({ key: 'val' });
  });
});

const EXT_CODEC_ID = 'test/ext-transform@1';

class ExtTransformDescriptor extends CodecDescriptorImpl<void> {
  override readonly dataType = dataTypeId('demo/fixture');
  override readonly codecId = EXT_CODEC_ID;
  override readonly traits = [] as const;
  override readonly targetTypes = ['TEXT'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: object) => Codec {
    return () =>
      ({
        id: EXT_CODEC_ID,
        encode: async (value: unknown) => `ENC:${String(value).toUpperCase()}`,
        decode: async (wire: unknown) => wire,
        encodeJson: (v: unknown) => v as never,
        decodeJson: (v: unknown) => v as never,
      }) as unknown as Codec;
  }
}

const extTransformDescriptor = sqliteCodec(new ExtTransformDescriptor(), {
  dataType: dataTypeId('demo/fixture'),
  jsonProjection: (expression) => expression,
});

function buildExtContractAndTable() {
  const tableColumns: StorageTableInput['columns'] = {
    label: { codecId: EXT_CODEC_ID, nativeType: 'TEXT', nullable: false },
    name: { codecId: 'sqlite/text@1', nativeType: 'TEXT', nullable: true },
  };
  const ns = sqliteCreateNamespace({
    id: UNBOUND_NAMESPACE_ID,
    entries: {
      table: {
        things: {
          columns: tableColumns,
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
  });
  const contract = createContract<SqliteContract['storage']>({
    storage: new SqlStorage({
      storageHash: 'test' as SqlStorage['storageHash'],
      namespaces: { [UNBOUND_NAMESPACE_ID]: ns },
    }),
  }) as SqliteContract;

  const table = sqliteTable('things', {
    label: { codecId: EXT_CODEC_ID, nullable: false },
    name: text(),
  });
  return { contract, table };
}

describe('SqliteControlAdapter.lowerToExecuteRequest — extension codec end-to-end', () => {
  const extCodecLookup = createSqliteCodecRegistryWithBuiltins([extTransformDescriptor]);

  it('encodes a query param through an extension codec when the adapter receives the descriptor', async () => {
    const { contract, table } = buildExtContractAndTable();
    const extAdapter = new SqliteControlAdapter(extCodecLookup);

    const ast = table.select(table.label).where(table.label.eq('plaintext')).build();
    const result = await extAdapter.lowerToExecuteRequest(ast, { contract });

    expect(result.params).toContain('ENC:PLAINTEXT');
    expect(result.params).not.toContain('plaintext');
  });

  it('throws when a contract column references a codec absent from the adapter lookup', async () => {
    const { contract, table } = buildExtContractAndTable();
    const noExtAdapter = new SqliteControlAdapter(createSqliteBuiltinCodecLookup());

    const ast = table.select(table.label).where(table.label.eq('plaintext')).build();
    await expect(noExtAdapter.lowerToExecuteRequest(ast, { contract })).rejects.toThrow(
      /CODEC_DESCRIPTOR_MISSING|No codec descriptor registered/,
    );
  });
});
