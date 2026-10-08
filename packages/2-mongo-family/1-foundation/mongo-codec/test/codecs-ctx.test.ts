import {
  type CodecCallContext,
  type DataTypeValue,
  dataType,
  readJsonString,
} from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { mongoCodec } from '../src/codecs';

const textType = dataType('test/text', { read: (json) => readJsonString('test/text', json) });

describe('mongoCodec() factory — CodecCallContext arity', () => {
  it('lifts a single-arg `(value)` author unchanged (back-compat)', async () => {
    const c = mongoCodec({
      typeId: 'demo/single-arg-encode@1',
      toWire: (value: string) => value.toUpperCase(),
      fromWire: (wire: string) => wire,
      dataType: textType,
      fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
    });
    expect(await c.toWire('hi', {})).toBe('HI');
  });

  it('forwards ctx (signal-only) to a `(value, ctx)` toWire author', async () => {
    let observed: CodecCallContext | undefined;
    const c = mongoCodec({
      typeId: 'demo/ctx-encode@1',
      toWire: (value: string, ctx?: CodecCallContext) => {
        observed = ctx;
        return value;
      },
      fromWire: (wire: string) => wire,
      dataType: textType,
      fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
    });
    const controller = new AbortController();
    const ctx: CodecCallContext = { signal: controller.signal };
    await c.toWire('x', ctx);
    expect(observed).toBe(ctx);
    expect(observed?.signal).toBe(controller.signal);
  });

  it('forwards ctx (signal-only) to a `(value, ctx)` fromWire author', async () => {
    let observed: CodecCallContext | undefined;
    const c = mongoCodec({
      typeId: 'demo/ctx-decode@1',
      toWire: (value: string) => value,
      fromWire: (wire: string, ctx?: CodecCallContext) => {
        observed = ctx;
        return wire;
      },
      dataType: textType,
      fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
    });
    const controller = new AbortController();
    const ctx: CodecCallContext = { signal: controller.signal };
    await c.fromWire('x', ctx);
    expect(observed).toBe(ctx);
    expect(observed?.signal).toBe(controller.signal);
  });

  it('preserves AbortSignal identity through the lifted method', async () => {
    let observedSignal: AbortSignal | undefined;
    const c = mongoCodec({
      typeId: 'demo/identity@1',
      toWire: (value: string, ctx?: CodecCallContext) => {
        observedSignal = ctx?.signal;
        return value;
      },
      fromWire: (wire: string) => wire,
      dataType: textType,
      fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
    });
    const controller = new AbortController();
    await c.toWire('x', { signal: controller.signal });
    expect(observedSignal).toBe(controller.signal);
  });

  it('forwards an empty ctx (no signal) as-is to a ctx-bearing author', async () => {
    let observed: unknown = 'sentinel';
    const c = mongoCodec({
      typeId: 'demo/empty-ctx@1',
      toWire: (value: string, ctx?: CodecCallContext) => {
        observed = ctx;
        return value;
      },
      fromWire: (wire: string) => wire,
      dataType: textType,
      fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
    });
    const ctx: CodecCallContext = {};
    await c.toWire('x', ctx);
    expect(observed).toBe(ctx);
  });

  it('async ctx-bearing encode resolves with the produced value', async () => {
    const c = mongoCodec({
      typeId: 'demo/async-ctx@1',
      toWire: async (value: string, _ctx?: CodecCallContext) => `enc:${value}`,
      fromWire: (wire: string) => wire,
      dataType: textType,
      fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
    });
    expect(await c.toWire('x', { signal: new AbortController().signal })).toBe('enc:x');
  });
});
