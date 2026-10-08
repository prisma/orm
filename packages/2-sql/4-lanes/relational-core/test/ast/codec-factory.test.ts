import { describe, expect, it } from 'vitest';
import { defineTestCodec } from './test-codec';

describe('defineTestCodec — query-time methods are Promise-returning', () => {
  it('lifts a sync toWire into a Promise-returning method', async () => {
    const c = defineTestCodec({
      typeId: 'demo/sync-encode@1',
      toWire: (value: string) => value.toUpperCase(),
      fromWire: (wire: string) => wire,
    });

    const encoded = c.toWire('hello', {});
    expect(encoded).toBeInstanceOf(Promise);
    expect(await encoded).toBe('HELLO');
  });

  it('lifts a sync fromWire into a Promise-returning method', async () => {
    const c = defineTestCodec({
      typeId: 'demo/sync-decode@1',
      toWire: (value: string) => value,
      fromWire: (wire: string) => wire.toLowerCase(),
    });

    const decoded = c.fromWire('WORLD', {});
    expect(decoded).toBeInstanceOf(Promise);
    expect(await decoded).toBe('world');
  });

  it('accepts an async toWire and produces a Promise-returning method', async () => {
    const c = defineTestCodec({
      typeId: 'demo/async-encode@1',
      toWire: async (value: string) => value.toUpperCase(),
      fromWire: (wire: string) => wire,
    });

    const encoded = c.toWire('hello', {});
    expect(encoded).toBeInstanceOf(Promise);
    expect(await encoded).toBe('HELLO');
  });

  it('accepts an async fromWire and produces a Promise-returning method', async () => {
    const c = defineTestCodec({
      typeId: 'demo/async-decode@1',
      toWire: (value: string) => value,
      fromWire: async (wire: string) => wire.toLowerCase(),
    });

    const decoded = c.fromWire('WORLD', {});
    expect(decoded).toBeInstanceOf(Promise);
    expect(await decoded).toBe('world');
  });

  it('accepts a mix of sync toWire + async fromWire', async () => {
    const c = defineTestCodec({
      typeId: 'demo/mixed-a@1',
      toWire: (value: string) => value,
      fromWire: async (wire: string) => wire.toUpperCase(),
    });

    expect(c.toWire('a', {})).toBeInstanceOf(Promise);
    expect(c.fromWire('a', {})).toBeInstanceOf(Promise);
    expect(await c.toWire('a', {})).toBe('a');
    expect(await c.fromWire('a', {})).toBe('A');
  });

  it('accepts a mix of async toWire + sync fromWire', async () => {
    const c = defineTestCodec({
      typeId: 'demo/mixed-b@1',
      toWire: async (value: string) => value.toUpperCase(),
      fromWire: (wire: string) => wire,
    });

    expect(c.toWire('a', {})).toBeInstanceOf(Promise);
    expect(c.fromWire('a', {})).toBeInstanceOf(Promise);
    expect(await c.toWire('a', {})).toBe('A');
    expect(await c.fromWire('a', {})).toBe('a');
  });

  it('passes toDataTypeValue and fromDataTypeValue through as synchronous methods', () => {
    const c = defineTestCodec({
      typeId: 'demo/json-passthrough@1',
      toWire: (value: string) => value,
      fromWire: (wire: string) => wire,
      toDataTypeValue: (value: string) => value.toUpperCase(),
      fromDataTypeValue: (value) => `prefixed:${value.value as string}`,
    });

    const value = c.toDataTypeValue('hello');
    const read = c.fromDataTypeValue(c.dataType.fromContract('hello', {}));
    expect(c.dataType.toContract(value)).toBe('HELLO');
    expect(read).toBe('prefixed:hello');
    expect(value).not.toBeInstanceOf(Promise);
    expect(read).not.toBeInstanceOf(Promise);
  });

  // `renderOutputType` is a `CodecDescriptor`-side concern (TML-2357) — the legacy `defineTestCodec()` factory accepts the field for back-compat with existing call sites but the produced codec instance no longer carries it. The descriptor side is exercised by `sql-codecs.test.ts`.
});
