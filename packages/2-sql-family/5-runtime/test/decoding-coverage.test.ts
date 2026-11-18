import {
  AggregateExpr,
  ColumnRef,
  ProjectionItem,
  RawQueryAst,
  SelectAst,
  SubqueryExpr,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { buildDecodeContext, decodeRow, sqlNativeArrayListDecoder } from '../src/codecs/decoding';
import { defineTestCodec } from './test-codec';
import { buildTestContractCodecs } from './utils';

function includeAst(): SelectAst {
  return SelectAst.from(TableSource.named('users')).withProjection([
    ProjectionItem.of(
      'posts',
      SubqueryExpr.of(SelectAst.from(TableSource.named('posts'))),
      undefined,
    ),
  ]);
}

describe('buildDecodeContext — include aliases', () => {
  it('marks a subquery projection item as an include alias', () => {
    const ctx = buildDecodeContext(includeAst(), undefined);
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
        toWire: (v: string) => v,
        fromWire: (v: unknown) => String(v),
      }),
    ];

    await expect(
      decodeRow(
        { tags: 'not-an-array' },
        buildDecodeContext(ast, buildTestContractCodecs(registry)),
        {},
        sqlNativeArrayListDecoder,
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: expect.stringContaining('expected an array from the driver for many-typed column'),
    });
  });
});

describe('decodeRow — include aggregate (JSON) columns', () => {
  it('returns [] for a null include aggregate wire value', async () => {
    const ast = includeAst();
    const result = await decodeRow(
      { posts: null },
      buildDecodeContext(ast, undefined),
      {},
      sqlNativeArrayListDecoder,
    );
    expect(result).toEqual({ posts: [] });
  });

  it('parses a JSON string wire value for an include aggregate', async () => {
    const ast = includeAst();
    const result = await decodeRow(
      { posts: '[{"id":1}]' },
      buildDecodeContext(ast, undefined),
      {},
      sqlNativeArrayListDecoder,
    );
    expect(result).toEqual({ posts: [{ id: 1 }] });
  });

  it('passes through an already-parsed object wire value unchanged', async () => {
    const ast = includeAst();
    const result = await decodeRow(
      { posts: { count: 5 } },
      buildDecodeContext(ast, undefined),
      {},
      sqlNativeArrayListDecoder,
    );
    expect(result).toEqual({ posts: { count: 5 } });
  });

  it('throws RUNTIME.DECODE_FAILED when the JSON string is malformed', async () => {
    const ast = includeAst();
    await expect(
      decodeRow(
        { posts: '{not valid json' },
        buildDecodeContext(ast, undefined),
        {},
        sqlNativeArrayListDecoder,
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: expect.stringContaining("Failed to parse JSON array for include alias 'posts'"),
    });
  });

  it('coerces a non-string, non-object wire value via String() before parsing', async () => {
    const ast = includeAst();
    const result = await decodeRow(
      { posts: 42 },
      buildDecodeContext(ast, undefined),
      {},
      sqlNativeArrayListDecoder,
    );
    expect(result).toEqual({ posts: 42 });
  });
});

describe('buildDecodeContext — raw-query row spec', () => {
  it('builds decode context from row spec columns without contractCodecs', () => {
    const ast = RawQueryAst.rows(['select id from users'], {
      id: { codecId: 'test/int@1', nullable: false },
    });

    const ctx = buildDecodeContext(ast, undefined);
    expect({
      aliasSource: ctx.aliasSource,
      aliases: ctx.aliases,
      codecCount: ctx.codecs.size,
    }).toEqual({ aliasSource: 'row-spec', aliases: ['id'], codecCount: 0 });
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
        toWire: (v: string) => v,
        fromWire: () => {
          throw new Error('boom');
        },
      }),
    ];

    await expect(
      decodeRow(
        { value: longValue },
        buildDecodeContext(ast, buildTestContractCodecs(registry)),
        {},
        sqlNativeArrayListDecoder,
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
      ProjectionItem.of('total', AggregateExpr.count(), { codecId: 'test/broken@1' }),
    ]);
    const registry = [
      defineTestCodec({
        typeId: 'test/broken@1',
        toWire: (v: number) => v,
        fromWire: () => {
          throw new Error('boom');
        },
      }),
    ];

    await expect(
      decodeRow(
        { total: '5' },
        buildDecodeContext(ast, buildTestContractCodecs(registry)),
        {},
        sqlNativeArrayListDecoder,
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      details: expect.objectContaining({ alias: 'total' }),
    });
  });
});
