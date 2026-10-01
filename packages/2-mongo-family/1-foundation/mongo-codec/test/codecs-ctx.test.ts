import { type CodecCallContext, decodeJsonString } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { mongoCodec } from '../src/codecs';

describe('mongoCodec() factory — CodecCallContext arity', () => {
  it('lifts a single-arg `(value)` author unchanged (back-compat)', async () => {
    const c = mongoCodec({
      typeId: 'demo/single-arg-encode@1',
      encode: (value: string) => value.toUpperCase(),
      decode: (wire: string) => wire,
      decodeJson: (json) => decodeJsonString('demo/single-arg-encode@1', json),
    });
    expect(await c.encode('hi', {})).toBe('HI');
  });

  it('forwards ctx (signal-only) to a `(value, ctx)` encode author', async () => {
    let observed: CodecCallContext | undefined;
    const c = mongoCodec({
      typeId: 'demo/ctx-encode@1',
      encode: (value: string, ctx?: CodecCallContext) => {
        observed = ctx;
        return value;
      },
      decode: (wire: string) => wire,
      decodeJson: (json) => decodeJsonString('demo/ctx-encode@1', json),
    });
    const controller = new AbortController();
    const ctx: CodecCallContext = { signal: controller.signal };
    await c.encode('x', ctx);
    expect(observed).toBe(ctx);
    expect(observed?.signal).toBe(controller.signal);
  });

  it('forwards ctx (signal-only) to a `(value, ctx)` decode author', async () => {
    let observed: CodecCallContext | undefined;
    const c = mongoCodec({
      typeId: 'demo/ctx-decode@1',
      encode: (value: string) => value,
      decode: (wire: string, ctx?: CodecCallContext) => {
        observed = ctx;
        return wire;
      },
      decodeJson: (json) => decodeJsonString('demo/ctx-decode@1', json),
    });
    const controller = new AbortController();
    const ctx: CodecCallContext = { signal: controller.signal };
    await c.decode('x', ctx);
    expect(observed).toBe(ctx);
    expect(observed?.signal).toBe(controller.signal);
  });

  it('preserves AbortSignal identity through the lifted method', async () => {
    let observedSignal: AbortSignal | undefined;
    const c = mongoCodec({
      typeId: 'demo/identity@1',
      encode: (value: string, ctx?: CodecCallContext) => {
        observedSignal = ctx?.signal;
        return value;
      },
      decode: (wire: string) => wire,
      decodeJson: (json) => decodeJsonString('demo/identity@1', json),
    });
    const controller = new AbortController();
    await c.encode('x', { signal: controller.signal });
    expect(observedSignal).toBe(controller.signal);
  });

  it('forwards an empty ctx (no signal) as-is to a ctx-bearing author', async () => {
    let observed: unknown = 'sentinel';
    const c = mongoCodec({
      typeId: 'demo/empty-ctx@1',
      encode: (value: string, ctx?: CodecCallContext) => {
        observed = ctx;
        return value;
      },
      decode: (wire: string) => wire,
      decodeJson: (json) => decodeJsonString('demo/empty-ctx@1', json),
    });
    const ctx: CodecCallContext = {};
    await c.encode('x', ctx);
    expect(observed).toBe(ctx);
  });

  it('async ctx-bearing encode resolves with the produced value', async () => {
    const c = mongoCodec({
      typeId: 'demo/async-ctx@1',
      encode: async (value: string, _ctx?: CodecCallContext) => `enc:${value}`,
      decode: (wire: string) => wire,
      decodeJson: (json) => decodeJsonString('demo/async-ctx@1', json),
    });
    expect(await c.encode('x', { signal: new AbortController().signal })).toBe('enc:x');
  });
});
