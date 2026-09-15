import type { JsonValue } from '@internal/contract/types';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { newMongoCodecRegistry } from '../src/codec-registry';
import { type MongoCodec, mongoCodec } from '../src/codecs';

describe('mongoCodec()', () => {
  it('creates a codec with the given config', async () => {
    const codec = mongoCodec({
      typeId: 'test/string@1',
      decode: (wire: string) => wire,
      encode: (value: string) => value,
    });

    expect(codec.id).toBe('test/string@1');
    expect(codec.decode('hello', {})).toBe('hello');
    expect(await codec.encode('hello', {})).toBe('hello');
  });

  it('creates a codec with encode and decode', async () => {
    const codec = mongoCodec({
      typeId: 'test/upper@1',
      decode: (wire: string) => wire.toUpperCase(),
      encode: (value: string) => value.toLowerCase(),
    });

    expect(codec.decode('hello', {})).toBe('HELLO');
    expect(await codec.encode('HELLO', {})).toBe('hello');
  });

  it('keeps decode synchronous while lifting encode to a Promise', () => {
    const codec = mongoCodec({
      typeId: 'test/sync@1',
      decode: (wire: string) => wire,
      encode: (value: string) => value,
    });

    const decoded = codec.decode('x', {});
    const encoded = codec.encode('y', {});
    expect(decoded).toBe('x');
    expect(typeof (encoded as { then?: unknown }).then).toBe('function');
  });

  it('accepts async encode alongside synchronous decode', async () => {
    const codec = mongoCodec({
      typeId: 'test/async@1',
      decode: (wire: string) => `decoded:${wire}`,
      encode: async (value: string) => `encoded:${value}`,
    });

    expect(codec.decode('a', {})).toBe('decoded:a');
    expect(await codec.encode('b', {})).toBe('encoded:b');
  });
});

describe('MongoCodecRegistry', () => {
  function makeCodec(id: string): MongoCodec<string> {
    return mongoCodec<string, readonly [], JsonValue, JsonValue>({
      typeId: id,
      decode: (wire: JsonValue) => wire,
      encode: (value: JsonValue) => value,
    });
  }

  it('registers and retrieves a codec by id', () => {
    const registry = newMongoCodecRegistry();
    const codec = makeCodec('test/a@1');
    registry.register(codec);

    expect(registry.get('test/a@1')).toBe(codec);
  });

  it('returns undefined for unregistered id', () => {
    const registry = newMongoCodecRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('has() returns true for registered, false for unregistered', () => {
    const registry = newMongoCodecRegistry();
    const codec = makeCodec('test/b@1');
    registry.register(codec);

    expect(registry.has('test/b@1')).toBe(true);
    expect(registry.has('nope')).toBe(false);
  });

  it('throws on duplicate registration', () => {
    const registry = newMongoCodecRegistry();
    const codec = makeCodec('test/dup@1');
    registry.register(codec);

    expect(() => registry.register(makeCodec('test/dup@1'))).toThrow(
      "Codec with ID 'test/dup@1' is already registered",
    );
  });

  it('duplicate registration raises RUNTIME.DUPLICATE_CODEC', () => {
    const registry = newMongoCodecRegistry();
    registry.register(makeCodec('test/dup@1'));
    try {
      registry.register(makeCodec('test/dup@1'));
      expect.fail('expected throw');
    } catch (e) {
      expect(isStructuredError(e)).toBe(true);
      if (!isStructuredError(e)) return;
      expect(e.code).toBe('RUNTIME.DUPLICATE_CODEC');
    }
  });

  it('iterates over registered codecs', () => {
    const registry = newMongoCodecRegistry();
    const a = makeCodec('test/x@1');
    const b = makeCodec('test/y@1');
    registry.register(a);
    registry.register(b);

    const collected = [...registry];
    expect(collected).toContain(a);
    expect(collected).toContain(b);
    expect(collected).toHaveLength(2);
  });

  it('values() returns an iterable of codecs', () => {
    const registry = newMongoCodecRegistry();
    const a = makeCodec('test/v@1');
    registry.register(a);

    const vals = Array.from(registry.values());
    expect(vals).toEqual([a]);
  });
});
