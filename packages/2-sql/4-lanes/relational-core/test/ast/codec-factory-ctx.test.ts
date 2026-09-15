import { describe, expect, it } from 'vitest';
import type { SqlCodecCallContext } from '../../src/ast/codec-types';
import { defineTestCodec } from './test-codec';

describe('defineTestCodec() factory — SqlCodecCallContext arity', () => {
  it('lifts a single-arg `(value)` author unchanged (back-compat)', async () => {
    const c = defineTestCodec({
      typeId: 'demo/single-arg-encode@1',
      encode: (value: string) => value.toUpperCase(),
      decode: (wire: string) => wire,
    });
    expect(await c.encode('hi', {})).toBe('HI');
  });

  it('forwards ctx (signal + column) to a `(value, ctx)` encode author', async () => {
    let observed: SqlCodecCallContext | undefined;
    const c = defineTestCodec({
      typeId: 'demo/ctx-encode@1',
      encode: (value: string, ctx?: SqlCodecCallContext) => {
        observed = ctx;
        return value;
      },
      decode: (wire: string) => wire,
    });
    const controller = new AbortController();
    const ctx: SqlCodecCallContext = {
      signal: controller.signal,
      column: { table: 'users', name: 'email' },
    };
    await c.encode('x', ctx);
    expect(observed).toBe(ctx);
    expect(observed?.signal).toBe(controller.signal);
    expect(observed?.column).toEqual({ table: 'users', name: 'email' });
  });

  it('forwards ctx (signal + column) to a `(value, ctx)` decode author', () => {
    let observed: SqlCodecCallContext | undefined;
    const c = defineTestCodec({
      typeId: 'demo/ctx-decode@1',
      encode: (value: string) => value,
      decode: (wire: string, ctx?: SqlCodecCallContext) => {
        observed = ctx;
        return wire;
      },
    });
    const controller = new AbortController();
    const ctx: SqlCodecCallContext = {
      signal: controller.signal,
      column: { table: 'orders', name: 'total' },
    };
    expect(c.decode('x', ctx)).toBe('x');
    expect(observed).toBe(ctx);
    expect(observed?.signal).toBe(controller.signal);
    expect(observed?.column).toEqual({ table: 'orders', name: 'total' });
  });

  it('preserves AbortSignal identity through the lifted method', async () => {
    let observedSignal: AbortSignal | undefined;
    const c = defineTestCodec({
      typeId: 'demo/identity@1',
      encode: (value: string, ctx?: SqlCodecCallContext) => {
        observedSignal = ctx?.signal;
        return value;
      },
      decode: (wire: string) => wire,
    });
    const controller = new AbortController();
    await c.encode('x', { signal: controller.signal });
    expect(observedSignal).toBe(controller.signal);
  });

  it('forwards an empty ctx (no signal, no column) as-is to a ctx-bearing author', async () => {
    let observed: unknown = 'sentinel';
    const c = defineTestCodec({
      typeId: 'demo/empty-ctx@1',
      encode: (value: string, ctx?: SqlCodecCallContext) => {
        observed = ctx;
        return value;
      },
      decode: (wire: string) => wire,
    });
    const ctx: SqlCodecCallContext = {};
    await c.encode('x', ctx);
    expect(observed).toBe(ctx);
  });

  it('async ctx-bearing encode resolves with the produced value', async () => {
    const c = defineTestCodec({
      typeId: 'demo/async-ctx@1',
      encode: async (value: string, _ctx?: SqlCodecCallContext) => `enc:${value}`,
      decode: (wire: string) => wire,
    });
    expect(await c.encode('x', { signal: new AbortController().signal })).toBe('enc:x');
  });

  it('a column-aware decode author observes ctx.column shape `{ table, name }`', () => {
    let observedColumn: SqlCodecCallContext['column'];
    const c = defineTestCodec({
      typeId: 'demo/column-aware@1',
      encode: (value: string) => value,
      decode: (wire: string, ctx?: SqlCodecCallContext) => {
        observedColumn = ctx?.column;
        return wire;
      },
    });
    expect(c.decode('x', { column: { table: 'users', name: 'email' } })).toBe('x');
    expect(observedColumn).toEqual({ table: 'users', name: 'email' });
  });
});
