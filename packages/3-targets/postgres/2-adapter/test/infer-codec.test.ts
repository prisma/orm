import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { describe, expect, it } from 'vitest';
import { postgresRawCodecInferer } from '../src/core/adapter';

const adapter = postgresRawCodecInferer;

describe('inferCodec', () => {
  describe('number → pg/int4@1 or pg/float8@1', () => {
    it('maps a safe integer to pg/int4@1', () => {
      expect(adapter.inferCodec(42)).toBe('pg/int4@1');
    });

    it('maps zero to pg/int4@1', () => {
      expect(adapter.inferCodec(0)).toBe('pg/int4@1');
    });

    it('maps negative zero to pg/int4@1', () => {
      expect(adapter.inferCodec(-0)).toBe('pg/int4@1');
    });

    it('maps a fractional number to pg/float8@1', () => {
      expect(adapter.inferCodec(1.5)).toBe('pg/float8@1');
    });

    it('maps a value above MAX_SAFE_INTEGER to pg/float8@1 to avoid silent truncation', () => {
      expect(adapter.inferCodec(Number.MAX_SAFE_INTEGER + 1)).toBe('pg/float8@1');
    });
  });

  // int4 is a signed 32-bit column: an integer outside that range must not be
  // handed to a codec whose native type cannot hold it.
  describe('integers beyond int4 → pg/int8number@1', () => {
    it('maps the largest int4 to pg/int4@1', () => {
      expect(adapter.inferCodec(2_147_483_647)).toBe('pg/int4@1');
    });

    it('maps the smallest int4 to pg/int4@1', () => {
      expect(adapter.inferCodec(-2_147_483_648)).toBe('pg/int4@1');
    });

    it('maps the first integer above the int4 range to pg/int8number@1', () => {
      expect(adapter.inferCodec(2_147_483_648)).toBe('pg/int8number@1');
    });

    it('maps the first integer below the int4 range to pg/int8number@1', () => {
      expect(adapter.inferCodec(-2_147_483_649)).toBe('pg/int8number@1');
    });

    it('maps MAX_SAFE_INTEGER to pg/int8number@1', () => {
      expect(adapter.inferCodec(Number.MAX_SAFE_INTEGER)).toBe('pg/int8number@1');
    });
  });

  describe('bigint → pg/int8@1', () => {
    it('maps a bigint literal to pg/int8@1', () => {
      expect(adapter.inferCodec(1n)).toBe('pg/int8@1');
    });
  });

  describe('string → pg/text@1', () => {
    it('maps a non-empty string to pg/text@1', () => {
      expect(adapter.inferCodec('hello')).toBe('pg/text@1');
    });

    it('maps an empty string to pg/text@1', () => {
      expect(adapter.inferCodec('')).toBe('pg/text@1');
    });
  });

  describe('boolean → pg/bool@1', () => {
    it('maps true to pg/bool@1', () => {
      expect(adapter.inferCodec(true)).toBe('pg/bool@1');
    });

    it('maps false to pg/bool@1', () => {
      expect(adapter.inferCodec(false)).toBe('pg/bool@1');
    });
  });

  describe('Uint8Array → pg/bytea@1', () => {
    it('maps a non-empty Uint8Array to pg/bytea@1', () => {
      expect(adapter.inferCodec(new Uint8Array([1, 2, 3]))).toBe('pg/bytea@1');
    });

    it('maps an empty Uint8Array to pg/bytea@1', () => {
      expect(adapter.inferCodec(new Uint8Array([]))).toBe('pg/bytea@1');
    });
  });

  // An inferred id is only useful if lowering can resolve it: renderTypedParam
  // looks the id up in this registry by exact match, so an id the registry does
  // not carry fails every raw interpolation that infers it.
  describe('inferred ids resolve in the postgres codec registry', () => {
    it.each([
      ['safe integer', 42],
      ['fractional number', 1.5],
      ['bigint', 1n],
      ['string', 'hello'],
      ['boolean', true],
      ['Uint8Array', new Uint8Array([1, 2, 3])],
      ['integer beyond the int4 range', 2_147_483_648],
    ] as const)('resolves the id inferred from a %s', (_label, value) => {
      const codecId = adapter.inferCodec(value);

      expect(postgresCodecDescriptorRegistry.descriptorFor(codecId)).toBeDefined();
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
