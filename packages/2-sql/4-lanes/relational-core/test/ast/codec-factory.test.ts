import { describe, expect, it } from 'vitest';
import { defineTestCodec } from './test-codec';

describe('defineTestCodec — async encoding and synchronous decoding', () => {
  it('lifts a sync encode into a Promise-returning method', async () => {
    const c = defineTestCodec({
      typeId: 'demo/sync-encode@1',
      encode: (value: string) => value.toUpperCase(),
      decode: (wire: string) => wire,
    });

    const encoded = c.encode!('hello', {});
    expect(encoded).toBeInstanceOf(Promise);
    expect(await encoded).toBe('HELLO');
  });

  it('preserves synchronous decoding', () => {
    const c = defineTestCodec({
      typeId: 'demo/sync-decode@1',
      encode: (value: string) => value,
      decode: (wire: string) => wire.toLowerCase(),
    });

    const decoded = c.decode('WORLD', {});
    expect(decoded).toBe('world');
  });

  it('accepts an async encode and produces a Promise-returning method', async () => {
    const c = defineTestCodec({
      typeId: 'demo/async-encode@1',
      encode: async (value: string) => value.toUpperCase(),
      decode: (wire: string) => wire,
    });

    const encoded = c.encode!('hello', {});
    expect(encoded).toBeInstanceOf(Promise);
    expect(await encoded).toBe('HELLO');
  });

  it('propagates decode errors synchronously', () => {
    const error = new Error('invalid wire value');
    const c = defineTestCodec({
      typeId: 'demo/throwing-decode@1',
      encode: (value: string) => value,
      decode: (_wire: string): string => {
        throw error;
      },
    });

    expect(() => c.decode('invalid', {})).toThrow(error);
  });

  it('accepts a mix of async encode + sync decode', async () => {
    const c = defineTestCodec({
      typeId: 'demo/mixed-b@1',
      encode: async (value: string) => value.toUpperCase(),
      decode: (wire: string) => wire,
    });

    expect(c.encode!('a', {})).toBeInstanceOf(Promise);
    expect(await c.encode!('a', {})).toBe('A');
    expect(c.decode('a', {})).toBe('a');
  });

  it('passes encodeJson and decodeJson through as synchronous methods', () => {
    const c = defineTestCodec({
      typeId: 'demo/json-passthrough@1',
      encode: (value: string) => value,
      decode: (wire: string) => wire,
      encodeJson: (value: string) => value.toUpperCase(),
      decodeJson: (json) => `prefixed:${json as string}`,
    });

    const encodedJson = c.encodeJson('hello');
    const decodedJson = c.decodeJson('hello');
    expect(encodedJson).toBe('HELLO');
    expect(decodedJson).toBe('prefixed:hello');
    expect(encodedJson).not.toBeInstanceOf(Promise);
    expect(decodedJson).not.toBeInstanceOf(Promise);
  });

  // `renderOutputType` is a `CodecDescriptor`-side concern (TML-2357) — the legacy `defineTestCodec()` factory accepts the field for back-compat with existing call sites but the produced codec instance no longer carries it. The descriptor side is exercised by `sql-codecs.test.ts`.
});
