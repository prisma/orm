import { RawQueryAst } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  buildDecodeContext,
  decodeRow as decodeRowBase,
  sqlNativeArrayListDecoder,
} from '../src/codecs/decoding';
import { defineTestCodec } from './test-codec';
import { buildTestContractCodecs } from './utils';

const contractCodecs = buildTestContractCodecs([
  defineTestCodec({
    typeId: 'test/int@1',
    targetTypes: ['int4'],
    encode: (v: number) => v,
    decode: (w: number) => w * 10,
  }),
  defineTestCodec({
    typeId: 'test/text@1',
    targetTypes: ['text'],
    encode: (v: string) => v,
    decode: (w: string) => `decoded:${w}`,
  }),
]);

const rowsAst = RawQueryAst.rows(['select id, email from "user"'], {
  id: { codecId: 'test/int@1', nullable: false },
  email: { codecId: 'test/text@1', nullable: true },
});

const affectedCountAst = RawQueryAst.affectedCount(['update "user" set seen = now()']);

function decodeRow(
  row: Parameters<typeof decodeRowBase>[0],
  decodeCtx: Parameters<typeof decodeRowBase>[1],
  rowCtx: Parameters<typeof decodeRowBase>[2],
  listDecoder: Parameters<typeof decodeRowBase>[3] = sqlNativeArrayListDecoder,
): ReturnType<typeof decodeRowBase> {
  return decodeRowBase(row, decodeCtx, rowCtx, listDecoder);
}

describe('raw-query decode context', () => {
  it('takes its aliases and codecs from the declared row spec', () => {
    const ctx = buildDecodeContext(rowsAst, contractCodecs);

    expect(ctx.aliases).toEqual(['id', 'email']);
    expect(ctx.codecs.get('id')?.id).toBe('test/int@1');
    expect(ctx.codecs.get('email')?.id).toBe('test/text@1');
  });

  it('declares no aliases for an affected-count statement', () => {
    const ctx = buildDecodeContext(affectedCountAst, contractCodecs);

    expect(ctx.aliases).toBeUndefined();
    expect(ctx.codecs.size).toBe(0);
  });
});

describe('raw-query row decoding', () => {
  it('decodes each column through the codec its spec declares', async () => {
    const decoded = await decodeRow(
      { id: 4, email: 'a@b.example' },
      buildDecodeContext(rowsAst, contractCodecs),
      {},
    );

    expect(decoded).toEqual({ id: 40, email: 'decoded:a@b.example' });
  });

  it('passes a null wire value through for a nullable column', async () => {
    const decoded = await decodeRow(
      { id: 4, email: null },
      buildDecodeContext(rowsAst, contractCodecs),
      {},
    );

    expect(decoded).toEqual({ id: 40, email: null });
  });

  it('drops result columns the spec does not declare', async () => {
    const decoded = await decodeRow(
      { id: 4, email: 'a@b.example', surplus: 'ignored' },
      buildDecodeContext(rowsAst, contractCodecs),
      {},
    );

    expect(decoded).toEqual({ id: 40, email: 'decoded:a@b.example' });
  });

  it('raises RUNTIME.RAW_ROW_COLUMN_MISSING when the result omits a declared column', async () => {
    await expect(
      decodeRow({ id: 4 }, buildDecodeContext(rowsAst, contractCodecs), {}),
    ).rejects.toMatchObject({
      code: 'RUNTIME.RAW_ROW_COLUMN_MISSING',
      details: {
        column: 'email',
        declaredColumns: ['id', 'email'],
        resultColumns: ['id'],
      },
    });
  });

  it('leaves an affected-count row untouched', async () => {
    const decoded = await decodeRow(
      { affectedRows: 3 },
      buildDecodeContext(affectedCountAst, contractCodecs),
      {},
    );

    expect(decoded).toEqual({ affectedRows: 3 });
  });
});

describe('column names that collide with object machinery', () => {
  const oddNamesAst = RawQueryAst.rows(['select 1 as "constructor"'], {
    constructor: { codecId: 'test/int@1', nullable: false },
  });

  it('keys the alias list and codec map by the declared name', () => {
    const ctx = buildDecodeContext(oddNamesAst, contractCodecs);

    expect(ctx.aliases).toEqual(['constructor']);
    expect(ctx.codecs.get('constructor')?.id).toBe('test/int@1');
  });

  it('decodes a constructor column into an own property of the row', async () => {
    const decoded = await decodeRow(
      { constructor: 4 },
      buildDecodeContext(oddNamesAst, contractCodecs),
      {},
    );

    expect(Object.hasOwn(decoded, 'constructor')).toBe(true);
    expect(decoded['constructor']).toBe(40);
  });

  it('ignores a __proto__ column the result carries but the spec does not declare', async () => {
    const wireRow = Object.fromEntries([
      ['id', 4],
      ['email', 'a@b.example'],
      ['__proto__', { polluted: true }],
    ]);

    const decoded = await decodeRow(wireRow, buildDecodeContext(rowsAst, contractCodecs), {});

    expect(decoded).toEqual({ id: 40, email: 'decoded:a@b.example' });
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
  });
});
