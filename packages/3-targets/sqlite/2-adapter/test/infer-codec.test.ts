import { sqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codecs';
import { describe, expect, it } from 'vitest';
import { sqliteRawCodecInferer } from '../src/core/adapter';

const adapter = sqliteRawCodecInferer;

describe('inferCodec', () => {
  describe('number → sqlite/integer@1 or sqlite/real@1', () => {
    it('maps a safe integer to sqlite/integer@1', () => {
      expect(adapter.inferCodec(42)).toBe('sqlite/integer@1');
    });

    it('maps zero to sqlite/integer@1', () => {
      expect(adapter.inferCodec(0)).toBe('sqlite/integer@1');
    });

    it('maps negative zero to sqlite/integer@1', () => {
      expect(adapter.inferCodec(-0)).toBe('sqlite/integer@1');
    });

    it('maps a fractional number to sqlite/real@1', () => {
      expect(adapter.inferCodec(1.5)).toBe('sqlite/real@1');
    });

    it('maps a value above MAX_SAFE_INTEGER to sqlite/real@1 to avoid silent truncation', () => {
      expect(adapter.inferCodec(Number.MAX_SAFE_INTEGER + 1)).toBe('sqlite/real@1');
    });
  });

  describe('bigint → sqlite/bigint@1', () => {
    it('maps a bigint literal to sqlite/bigint@1', () => {
      expect(adapter.inferCodec(1n)).toBe('sqlite/bigint@1');
    });
  });

  describe('string → sqlite/text@1', () => {
    it('maps a non-empty string to sqlite/text@1', () => {
      expect(adapter.inferCodec('hello')).toBe('sqlite/text@1');
    });

    it('maps an empty string to sqlite/text@1', () => {
      expect(adapter.inferCodec('')).toBe('sqlite/text@1');
    });
  });

  describe('boolean → sqlite/integer@1', () => {
    it('maps true to sqlite/integer@1', () => {
      expect(adapter.inferCodec(true)).toBe('sqlite/integer@1');
    });

    it('maps false to sqlite/integer@1', () => {
      expect(adapter.inferCodec(false)).toBe('sqlite/integer@1');
    });
  });

  describe('Uint8Array → sqlite/blob@1', () => {
    it('maps a non-empty Uint8Array to sqlite/blob@1', () => {
      expect(adapter.inferCodec(new Uint8Array([1, 2, 3]))).toBe('sqlite/blob@1');
    });

    it('maps an empty Uint8Array to sqlite/blob@1', () => {
      expect(adapter.inferCodec(new Uint8Array([]))).toBe('sqlite/blob@1');
    });
  });

  // An inferred id is only useful if lowering can resolve it: the render path
  // looks the id up in this registry by exact match, so an id the registry does
  // not carry fails every raw interpolation that infers it.
  describe('inferred ids resolve in the sqlite codec registry', () => {
    it.each([
      ['safe integer', 42],
      ['fractional number', 1.5],
      ['bigint', 1n],
      ['string', 'hello'],
      ['boolean', true],
      ['Uint8Array', new Uint8Array([1, 2, 3])],
    ] as const)('resolves the id inferred from a %s', (_label, value) => {
      const codecId = adapter.inferCodec(value);

      expect(sqliteCodecDescriptorRegistry.descriptorFor(codecId)).toBeDefined();
    });
  });

  describe('defence-in-depth throw for unsupported types', () => {
    const throwMsg = 'wrap this value in `param(...)` with an explicit codec';
    // Cast to a wider shape so TypeScript does not prevent passing unsupported
    // values — the purpose of these tests is to exercise the runtime guard.
    const unchecked = adapter as unknown as { inferCodec(v: unknown): string };

    it('throws for Date', () => {
      expect(() => unchecked.inferCodec(new Date())).toThrow(throwMsg);
    });

    it('throws for null', () => {
      expect(() => unchecked.inferCodec(null)).toThrow(throwMsg);
    });

    it('throws for undefined', () => {
      expect(() => unchecked.inferCodec(undefined)).toThrow(throwMsg);
    });

    it('throws for a plain object', () => {
      expect(() => unchecked.inferCodec({ foo: 1 })).toThrow(throwMsg);
    });

    it('throws for an array', () => {
      expect(() => unchecked.inferCodec([1, 2])).toThrow(throwMsg);
    });
  });
});
