import { coreHash } from '@internal/contract/types';
import {
  ColumnRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { describe, expect, it } from 'vitest';
import { buildDecodeContext, decodeRow } from '../src/codecs/decoding';
import { defineTestCodec } from './test-codec';
import { buildTestContractCodecs } from './utils';

const TEST_HASH = coreHash('test');

describe('buildDecodeContext — include aliases', () => {
  it('marks a subquery projection item as an include alias', () => {
    const ast = SelectAst.from(TableSource.named('users')).withProjection([
      ProjectionItem.of('posts', { kind: 'subquery' } as never, undefined),
    ]);
    const ctx = buildDecodeContext(ast, undefined);
    expect(ctx.includeAliases.has('posts')).toBe(true);
  });
});

describe('decodeRow — many-typed column validation', () => {
  it('wraps a non-array wire value for a many-typed column in RUNTIME.DECODE_FAILED', async () => {
    const ast = SelectAst.from(TableSource.named('users')).withProjection([
      ProjectionItem.of('tags', ColumnRef.of('users', 'tags'), {
        codecId: 'test/passthrough@1',
        many: true,
      }),
    ]);
    const registry = [
      defineTestCodec({
        typeId: 'test/passthrough@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: (v: unknown) => String(v),
      }),
    ];

    await expect(
      decodeRow(
        { tags: 'not-an-array' },
        buildDecodeContext(ast, buildTestContractCodecs(registry)),
        {},
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: expect.stringContaining('expected an array from the driver for many-typed column'),
    });
  });
});

describe('decodeRow — include aggregate (JSON) columns', () => {
  function buildIncludePlan(): SqlExecutionPlan {
    const ast = SelectAst.from(TableSource.named('users')).withProjection([
      ProjectionItem.of('posts', { kind: 'subquery' } as never, undefined),
    ]);
    return {
      sql: 'select 1',
      params: [],
      ast,
      meta: { target: 'postgres', storageHash: TEST_HASH, lane: 'dsl' },
    };
  }

  it('returns [] for a null include aggregate wire value', async () => {
    const ast = buildIncludePlan().ast;
    const result = await decodeRow({ posts: null }, buildDecodeContext(ast, undefined), {});
    expect(result).toEqual({ posts: [] });
  });

  it('parses a JSON string wire value for an include aggregate', async () => {
    const ast = buildIncludePlan().ast;
    const result = await decodeRow({ posts: '[{"id":1}]' }, buildDecodeContext(ast, undefined), {});
    expect(result).toEqual({ posts: [{ id: 1 }] });
  });

  it('passes through an already-parsed object wire value unchanged', async () => {
    const ast = buildIncludePlan().ast;
    const result = await decodeRow({ posts: { count: 5 } }, buildDecodeContext(ast, undefined), {});
    expect(result).toEqual({ posts: { count: 5 } });
  });

  it('throws RUNTIME.DECODE_FAILED when the JSON string is malformed', async () => {
    const ast = buildIncludePlan().ast;
    await expect(
      decodeRow({ posts: '{not valid json' }, buildDecodeContext(ast, undefined), {}),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: expect.stringContaining("Failed to parse JSON array for include alias 'posts'"),
    });
  });

  it('coerces a non-string, non-object wire value via String() before parsing', async () => {
    const ast = buildIncludePlan().ast;
    const result = await decodeRow({ posts: 42 }, buildDecodeContext(ast, undefined), {});
    expect(result).toEqual({ posts: 42 });
  });
});

describe('buildDecodeContext — raw-query row spec', () => {
  it('builds decode context from row spec columns without contractCodecs', () => {
    const ast = {
      kind: 'raw-query',
      result: {
        kind: 'columns',
        columns: { id: { codecId: 'test/int@1' } },
      },
    } as unknown as Parameters<typeof buildDecodeContext>[0];

    const ctx = buildDecodeContext(ast, undefined);
    expect(ctx.aliasSource).toBe('row-spec');
    expect(ctx.aliases).toEqual(['id']);
    expect(ctx.codecs.size).toBe(0);
  });

  it('builds decode context from row spec columns with contractCodecs resolving each codec', () => {
    const registry = [
      defineTestCodec({
        typeId: 'test/int@1',
        targetTypes: ['int4'],
        encode: (v: number) => v,
        decode: (v: unknown) => Number(v),
      }),
    ];
    const ast = {
      kind: 'raw-query',
      result: {
        kind: 'columns',
        columns: { id: { codecId: 'test/int@1' } },
      },
    } as unknown as Parameters<typeof buildDecodeContext>[0];

    const ctx = buildDecodeContext(ast, buildTestContractCodecs(registry));
    expect(ctx.codecs.has('id')).toBe(true);
  });

  it('returns an undecoded context for an affected-count raw-query result', () => {
    const ast = {
      kind: 'raw-query',
      result: { kind: 'affected-count' },
    } as unknown as Parameters<typeof buildDecodeContext>[0];

    const ctx = buildDecodeContext(ast, undefined);
    expect(ctx.aliases).toBeUndefined();
  });
});

describe('decodeRow — wire preview truncation', () => {
  it('truncates long wire values in the DECODE_FAILED wirePreview', async () => {
    const longValue = 'x'.repeat(150);
    const ast = SelectAst.from(TableSource.named('users')).withProjection([
      ProjectionItem.of('value', ColumnRef.of('users', 'value'), { codecId: 'test/broken@1' }),
    ]);
    const registry = [
      defineTestCodec({
        typeId: 'test/broken@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: () => {
          throw new Error('boom');
        },
      }),
    ];

    await expect(
      decodeRow(
        { value: longValue },
        buildDecodeContext(ast, buildTestContractCodecs(registry)),
        {},
      ),
    ).rejects.toMatchObject({
      details: expect.objectContaining({
        wirePreview: `${'x'.repeat(100)}...`,
      }),
    });
  });
});

describe('decodeRow — decode failures without a resolvable column ref', () => {
  it('reports { alias } (not { table, column }) when the failing projection item has no column-ref', async () => {
    const ast = SelectAst.from(TableSource.named('users')).withProjection([
      ProjectionItem.of('total', { kind: 'aggregate' } as never, { codecId: 'test/broken@1' }),
    ]);
    const registry = [
      defineTestCodec({
        typeId: 'test/broken@1',
        targetTypes: ['int4'],
        encode: (v: number) => v,
        decode: () => {
          throw new Error('boom');
        },
      }),
    ];

    await expect(
      decodeRow({ total: '5' }, buildDecodeContext(ast, buildTestContractCodecs(registry)), {}),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      details: expect.objectContaining({ alias: 'total' }),
    });
  });
});
