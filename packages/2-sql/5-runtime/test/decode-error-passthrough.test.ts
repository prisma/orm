import { coreHash } from '@internal/contract/types';
import { runtimeAborted, runtimeError } from '@internal/framework-components/runtime';
import {
  ColumnRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import {
  buildDecodeContext,
  decodeRow as decodeRowBase,
  sqlNativeArrayListDecoder,
} from '../src/codecs/decoding';
import { defineTestCodec } from './test-codec';
import { buildTestContractCodecs } from './utils';

const TEST_HASH = coreHash('test');

function decodeRow(
  row: Parameters<typeof decodeRowBase>[0],
  decodeCtx: Parameters<typeof decodeRowBase>[1],
  rowCtx: Parameters<typeof decodeRowBase>[2],
  listDecoder: Parameters<typeof decodeRowBase>[3] = sqlNativeArrayListDecoder,
): ReturnType<typeof decodeRowBase> {
  return decodeRowBase(row, decodeCtx, rowCtx, listDecoder);
}

function buildPlan(): SqlExecutionPlan {
  const ast = SelectAst.from(TableSource.named('users')).withProjection([
    ProjectionItem.of('value', ColumnRef.of('users', 'value'), { codecId: 'test/passthrough@1' }),
  ]);
  return {
    sql: 'select value from users',
    params: [],
    ast,
    meta: {
      target: 'postgres',
      storageHash: TEST_HASH,
      lane: 'dsl',
    },
  };
}

describe('decodeRow — runtime-envelope passthrough', () => {
  it('rethrows codec-authored RUNTIME.DECODE_FAILED without wrapping', async () => {
    const original = runtimeError('RUNTIME.DECODE_FAILED', 'codec-authored failure', {
      table: 'users',
      column: 'value',
      codec: 'test/passthrough@1',
      detail: 'codec-specific',
    });
    const registry = [
      defineTestCodec({
        typeId: 'test/passthrough@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: () => {
          throw original;
        },
      }),
    ];

    await expect(
      decodeRow(
        { value: 'wire' },
        buildDecodeContext(buildPlan().ast, buildTestContractCodecs(registry)),
        {},
      ),
    ).rejects.toBe(original);
  });

  it('rethrows codec-authored RUNTIME.ABORTED without wrapping', async () => {
    const original = runtimeAborted('decode', new Error('codec aborted'));
    const registry = [
      defineTestCodec({
        typeId: 'test/passthrough@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: () => {
          throw original;
        },
      }),
    ];

    await expect(
      decodeRow(
        { value: 'wire' },
        buildDecodeContext(buildPlan().ast, buildTestContractCodecs(registry)),
        {},
      ),
    ).rejects.toBe(original);
  });

  it('rethrows a plain structuredError DECODE_FAILED envelope without wrapping', async () => {
    const original = structuredError('RUNTIME.DECODE_FAILED', 'extension codec failure', {
      meta: { codec: 'test/passthrough@1', detail: 'codec-specific' },
    });
    const registry = [
      defineTestCodec({
        typeId: 'test/passthrough@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: () => {
          throw original;
        },
      }),
    ];

    await expect(
      decodeRow(
        { value: 'wire' },
        buildDecodeContext(buildPlan().ast, buildTestContractCodecs(registry)),
        {},
      ),
    ).rejects.toBe(original);
  });

  it('rethrows a plain structuredError envelope from a many-element decode without wrapping', async () => {
    const original = structuredError('RUNTIME.DECODE_FAILED', 'element decode failure');
    const ast = SelectAst.from(TableSource.named('users')).withProjection([
      ProjectionItem.of('value', ColumnRef.of('users', 'value'), {
        codecId: 'test/passthrough@1',
        many: true,
      }),
    ]);
    const registry = [
      defineTestCodec({
        typeId: 'test/passthrough@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: () => {
          throw original;
        },
      }),
    ];

    await expect(
      decodeRow(
        { value: ['wire'] },
        buildDecodeContext(ast, buildTestContractCodecs(registry)),
        {},
      ),
    ).rejects.toBe(original);
  });

  it('wraps a foreign Error into RUNTIME.DECODE_FAILED with the original on cause', async () => {
    const original = new Error('boom');
    const registry = [
      defineTestCodec({
        typeId: 'test/passthrough@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: () => {
          throw original;
        },
      }),
    ];

    await expect(
      decodeRow(
        { value: 'wire' },
        buildDecodeContext(buildPlan().ast, buildTestContractCodecs(registry)),
        {},
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      cause: original,
      details: expect.objectContaining({
        table: 'users',
        column: 'value',
        codec: 'test/passthrough@1',
      }),
    });
  });
});
