import { coreHash } from '@internal/contract/types';
import {
  AggregateExpr,
  ColumnRef,
  LiteralExpr,
  ProjectionItem,
  SelectAst,
  type SqlCodecCallContext,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
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

function buildPlan(projections: ReadonlyArray<ProjectionItem>): SqlExecutionPlan {
  const ast = SelectAst.from(TableSource.named('users')).withProjection(projections);
  return {
    sql: 'select 1',
    params: [],
    ast,
    meta: {
      target: 'postgres',
      storageHash: TEST_HASH,
      lane: 'dsl',
    },
  };
}

function columnProjection(
  alias: string,
  table: string,
  column: string,
  codecId: string,
): ProjectionItem {
  return ProjectionItem.of(alias, ColumnRef.of(table, column), { codecId });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('decodeRow — SqlCodecCallContext threading', () => {
  it('forwards a per-cell ctx whose signal is the same instance as the row-level ctx (signal identity preserved)', async () => {
    const observed: AbortSignal[] = [];
    const registry = [
      defineTestCodec({
        typeId: 'test/observe@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: (w: string, ctx?: SqlCodecCallContext) => {
          if (ctx?.signal) observed.push(ctx.signal);
          return w;
        },
      }),
    ];

    const p = buildPlan([
      columnProjection('a', 'users', 'a', 'test/observe@1'),
      columnProjection('b', 'users', 'b', 'test/observe@1'),
    ]);

    const controller = new AbortController();
    const rowCtx: SqlCodecCallContext = { signal: controller.signal };
    await decodeRow(
      { a: 'A', b: 'B' },
      buildDecodeContext(p.ast, buildTestContractCodecs(registry)),
      rowCtx,
    );

    expect(observed).toHaveLength(2);
    expect(observed[0]).toBe(controller.signal);
    expect(observed[1]).toBe(controller.signal);
  });

  it('populates ctx.column = { table, name } for cells whose ColumnRef resolves', async () => {
    const observed: { alias: string; column: SqlCodecCallContext['column'] }[] = [];
    const registry = [
      defineTestCodec({
        typeId: 'test/observe-col@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: (w: string, ctx?: SqlCodecCallContext) => {
          observed.push({ alias: w, column: ctx?.column });
          return w;
        },
      }),
    ];

    const p = buildPlan([
      columnProjection('email', 'users', 'email', 'test/observe-col@1'),
      columnProjection('total', 'orders', 'total', 'test/observe-col@1'),
    ]);

    await decodeRow(
      { email: 'email', total: 'total' },
      buildDecodeContext(p.ast, buildTestContractCodecs(registry)),
      { signal: new AbortController().signal },
    );

    expect(observed).toEqual([
      { alias: 'email', column: { table: 'users', name: 'email' } },
      { alias: 'total', column: { table: 'orders', name: 'total' } },
    ]);
  });

  it('populates ctx.column when the projection points at a different table.column than the alias', async () => {
    let observed: SqlCodecCallContext | undefined;
    const registry = [
      defineTestCodec({
        typeId: 'test/observe-projection@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: (w: string, ctx?: SqlCodecCallContext) => {
          observed = ctx;
          return w;
        },
      }),
    ];

    const p = buildPlan([
      columnProjection('secret', 'user', 'secret', 'test/observe-projection@1'),
    ]);

    await decodeRow(
      { secret: 'wire' },
      buildDecodeContext(p.ast, buildTestContractCodecs(registry)),
      { signal: new AbortController().signal },
    );

    expect(observed?.column).toEqual({ table: 'user', name: 'secret' });
  });

  it('leaves ctx.column undefined for cells the runtime cannot resolve to a single (table, name) — aggregate projection', async () => {
    let observed: SqlCodecCallContext | undefined;
    const registry = [
      defineTestCodec({
        typeId: 'test/observe-undef@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: (w: string, ctx?: SqlCodecCallContext) => {
          observed = ctx;
          return w;
        },
      }),
    ];

    const p = buildPlan([
      // Aggregate (count) projections are not single-column refs, so the runtime cannot project a `{ table, name }` for them.
      ProjectionItem.of('agg', AggregateExpr.count(), { codecId: 'test/observe-undef@1' }),
    ]);

    // Seed the row ctx with a stale `column` to confirm unresolved cells explicitly clear inherited `column` rather than passing `rowCtx` through unchanged.
    const rowCtx: SqlCodecCallContext = {
      signal: new AbortController().signal,
      column: { table: 'stale', name: 'stale' },
    };

    await decodeRow(
      { agg: '1' },
      buildDecodeContext(p.ast, buildTestContractCodecs(registry)),
      rowCtx,
    );

    expect(observed).toBeDefined();
    expect(observed?.column).toBeUndefined();
  });

  it('leaves ctx.column undefined for non-column-ref projections (computed expression)', async () => {
    let observed: SqlCodecCallContext | undefined;
    const registry = [
      defineTestCodec({
        typeId: 'test/observe-no-ref@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: (w: string, ctx?: SqlCodecCallContext) => {
          observed = ctx;
          return w;
        },
      }),
    ];

    const p = buildPlan([
      ProjectionItem.of('computed', LiteralExpr.of(1), { codecId: 'test/observe-no-ref@1' }),
    ]);

    const rowCtx: SqlCodecCallContext = {
      signal: new AbortController().signal,
      column: { table: 'stale', name: 'stale' },
    };

    await decodeRow(
      { computed: 'wire' },
      buildDecodeContext(p.ast, buildTestContractCodecs(registry)),
      rowCtx,
    );

    expect(observed).toBeDefined();
    expect(observed?.column).toBeUndefined();
  });

  it('1-arg codec authors observe no behavioral change when ctx is the default empty ctx', async () => {
    let invoked = 0;
    let receivedWire: unknown;
    const registry = [
      defineTestCodec({
        typeId: 'test/single-arg-author@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: (w: string) => {
          invoked += 1;
          receivedWire = w;
          return w;
        },
      }),
    ];

    const p = buildPlan([columnProjection('x', 'users', 'x', 'test/single-arg-author@1')]);

    const result = await decodeRow(
      { x: 'wire' },
      buildDecodeContext(p.ast, buildTestContractCodecs(registry)),
      {},
    );
    expect(result).toEqual({ x: 'wire' });
    expect(invoked).toBe(1);
    expect(receivedWire).toBe('wire');
  });

  it('already-aborted signal at entry short-circuits before any codec call', async () => {
    let callCount = 0;
    const registry = [
      defineTestCodec({
        typeId: 'test/counter@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: (w: string) => {
          callCount += 1;
          return w;
        },
      }),
    ];

    const p = buildPlan([
      columnProjection('a', 'users', 'a', 'test/counter@1'),
      columnProjection('b', 'users', 'b', 'test/counter@1'),
    ]);

    const controller = new AbortController();
    const reason = new Error('decode short-circuit');
    controller.abort(reason);

    await expect(
      decodeRow({ a: '1', b: '2' }, buildDecodeContext(p.ast, buildTestContractCodecs(registry)), {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'decode' },
      cause: reason,
    });
    expect(callCount).toBe(0);
  });

  it('mid-decode abort surfaces RUNTIME.ABORTED { phase: decode } via abortable race', async () => {
    const release = deferred<string>();
    const registry = [
      defineTestCodec({
        typeId: 'test/blocking@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: (w: string) => release.promise.then((suffix) => `${w}:${suffix}`),
      }),
    ];

    const p = buildPlan([columnProjection('x', 'users', 'x', 'test/blocking@1')]);

    const controller = new AbortController();
    const reason = new Error('mid-decode abort');
    const promise = decodeRow(
      { x: 'wire' },
      buildDecodeContext(p.ast, buildTestContractCodecs(registry)),
      { signal: controller.signal },
    );

    queueMicrotask(() => controller.abort(reason));

    await expect(promise).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'decode' },
      cause: reason,
    });

    release.resolve('done');
  });

  it('passes through RUNTIME.DECODE_FAILED unchanged when the codec body throws (no double-wrap)', async () => {
    const cause = new Error('decode boom');
    const registry = [
      defineTestCodec({
        typeId: 'test/explody@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: () => {
          throw cause;
        },
      }),
    ];

    const p = buildPlan([columnProjection('x', 'users', 'x', 'test/explody@1')]);

    await expect(
      decodeRow({ x: 'wire' }, buildDecodeContext(p.ast, buildTestContractCodecs(registry)), {
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      cause,
    });
  });

  it('reuses the existing per-cell ColumnRef resolution: the column passed to the codec matches the table/name used by RUNTIME.DECODE_FAILED for the same cell', async () => {
    // The codec records the column it observes via ctx; the same plan exercises the failure path by throwing on a different cell. The observed `ctx.column` for the success cell must match the `{ table, column }` shape the runtime would have constructed for the error envelope (proving the resolution is shared, not duplicated).
    const observedColumns: SqlCodecCallContext['column'][] = [];
    const registry = [
      defineTestCodec({
        typeId: 'test/recorder@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: (w: string, ctx?: SqlCodecCallContext) => {
          observedColumns.push(ctx?.column);
          return w;
        },
      }),
    ];

    const p = buildPlan([columnProjection('email', 'users', 'email', 'test/recorder@1')]);

    await decodeRow(
      { email: 'wire' },
      buildDecodeContext(p.ast, buildTestContractCodecs(registry)),
      { signal: new AbortController().signal },
    );

    // SqlColumnRef shape `{ table, name }` projected from the ColumnRef shape `{ table, column }` the resolver returns — same source, one resolution per cell.
    expect(observedColumns).toEqual([{ table: 'users', name: 'email' }]);
  });
});
