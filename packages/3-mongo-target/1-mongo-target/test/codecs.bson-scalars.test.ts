import type { JsonValue } from '@internal/contract/types';
import { Binary, Decimal128, Long } from 'bson';
import { describe, expect, it } from 'vitest';
import {
  MONGO_BINARY_CODEC_ID,
  MONGO_DECIMAL128_CODEC_ID,
  MONGO_INT64_CODEC_ID,
  MONGO_JSON_CODEC_ID,
} from '../src/core/codec-ids';
import {
  mongoBinaryCodec,
  mongoDecimal128Codec,
  mongoDescriptorById,
  mongoInt64Codec,
  mongoJsonCodec,
  mongoStandardCodecs,
} from '../src/core/codecs';

const decodeFailed = expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED' });
const encodeFailed = expect.objectContaining({ code: 'RUNTIME.ENCODE_FAILED' });

function wrongWire<T>(value: unknown): T {
  return value as T;
}

describe('mongoInt64Codec', () => {
  it('encodes a bigint to a Long carrying the same value', async () => {
    const wire = await mongoInt64Codec.encode(2n ** 60n, {});
    expect(wire).toEqual(Long.fromBigInt(2n ** 60n));
  });

  it('decodes a Long past the safe integer range to the exact bigint', async () => {
    expect(await mongoInt64Codec.decode(Long.fromBigInt(-(2n ** 62n) - 7n), {})).toBe(
      -(2n ** 62n) - 7n,
    );
  });

  it('decodes the number the driver promotes a small Long to', async () => {
    expect(await mongoInt64Codec.decode(42, {})).toBe(42n);
  });

  it('decodes a bigint wire value unchanged', async () => {
    expect(await mongoInt64Codec.decode(9007199254740993n, {})).toBe(9007199254740993n);
  });

  it('round-trips through the wire form', async () => {
    const value = 9_223_372_036_854_775_807n;
    expect(await mongoInt64Codec.decode(await mongoInt64Codec.encode(value, {}), {})).toBe(value);
  });

  it('refuses a wire value of the wrong type', async () => {
    await expect(mongoInt64Codec.decode(wrongWire<Long>('42'), {})).rejects.toThrow(decodeFailed);
  });

  it('refuses a non-integral or unsafe number on the wire', async () => {
    await expect(mongoInt64Codec.decode(1.5, {})).rejects.toThrow(decodeFailed);
    await expect(mongoInt64Codec.decode(2 ** 60, {})).rejects.toThrow(decodeFailed);
  });

  it('refuses an application value that is not a bigint', async () => {
    await expect(mongoInt64Codec.encode(wrongWire<bigint>(42), {})).rejects.toThrow(encodeFailed);
  });

  const int64Max = 2n ** 63n - 1n;
  const int64Min = -(2n ** 63n);

  it('encodes both ends of the signed 64-bit range exactly', async () => {
    for (const value of [int64Max, int64Min]) {
      expect(await mongoInt64Codec.decode(await mongoInt64Codec.encode(value, {}), {})).toBe(value);
    }
  });

  it('refuses a bigint outside the signed 64-bit range instead of wrapping it', async () => {
    await expect(mongoInt64Codec.encode(int64Max + 1n, {})).rejects.toThrow(encodeFailed);
    await expect(mongoInt64Codec.encode(int64Min - 1n, {})).rejects.toThrow(encodeFailed);
  });

  it('writes both ends of the signed 64-bit range as JSON and reads them back', () => {
    for (const value of [int64Max, int64Min]) {
      expect(mongoInt64Codec.decodeJson(mongoInt64Codec.encodeJson(value))).toBe(value);
    }
  });

  it('refuses a bigint outside the signed 64-bit range on the way into JSON', () => {
    expect(() => mongoInt64Codec.encodeJson(int64Max + 1n)).toThrow(encodeFailed);
    expect(() => mongoInt64Codec.encodeJson(int64Min - 1n)).toThrow(encodeFailed);
  });

  it('refuses JSON decimal text outside the signed 64-bit range', () => {
    expect(() => mongoInt64Codec.decodeJson((int64Max + 1n).toString())).toThrow(decodeFailed);
    expect(() => mongoInt64Codec.decodeJson((int64Min - 1n).toString())).toThrow(decodeFailed);
    expect(() => mongoInt64Codec.decodeJson('99999999999999999999')).toThrow(decodeFailed);
  });

  it('writes decimal text as its JSON form and reads it back', () => {
    expect(mongoInt64Codec.encodeJson(-123n)).toBe('-123');
    expect(mongoInt64Codec.decodeJson('-123')).toBe(-123n);
  });

  it('accepts a safe-integer number on the way into JSON', () => {
    expect(mongoInt64Codec.encodeJson(wrongWire<bigint>(7))).toBe('7');
  });

  it('refuses an unsafe number on the way into JSON', () => {
    expect(() => mongoInt64Codec.encodeJson(wrongWire<bigint>(2 ** 60))).toThrow(encodeFailed);
  });

  it('refuses JSON that is not decimal integer text', () => {
    expect(() => mongoInt64Codec.decodeJson(12)).toThrow(decodeFailed);
    expect(() => mongoInt64Codec.decodeJson('1.5')).toThrow(decodeFailed);
  });

  it('renders a decimal-text default as a bigint literal', () => {
    const descriptor = mongoDescriptorById(MONGO_INT64_CODEC_ID);
    expect(descriptor?.renderValueLiteral?.('123', 'output')).toBe('123n');
    expect(descriptor?.renderValueLiteral?.(123, 'output')).toBeUndefined();
  });
});

describe('mongoDecimal128Codec', () => {
  it('encodes decimal text to a Decimal128', async () => {
    const wire = await mongoDecimal128Codec.encode('123.4500', {});
    expect(wire).toBeInstanceOf(Decimal128);
    expect(wire.toString()).toBe('123.4500');
  });

  it.each([
    ['1E+3', '1000'],
    ['1.000E+3', '1000'],
    ['1.5E-2', '0.015'],
    ['-1.50E-5', '-0.0000150'],
    ['1.23E+40', '12300000000000000000000000000000000000000'],
    ['123.4500', '123.4500'],
    ['-0', '0'],
    ['NaN', 'NaN'],
    ['-Infinity', '-Infinity'],
  ])('decodes %s as the canonical text %s', async (stored, canonical) => {
    expect(await mongoDecimal128Codec.decode(Decimal128.fromString(stored), {})).toBe(canonical);
  });

  it('keeps the canonical text stable across a wire round trip', async () => {
    for (const stored of ['1E+3', '1.5E-2', '1.23E+40', '123.4500']) {
      const text = await mongoDecimal128Codec.decode(Decimal128.fromString(stored), {});
      const again = await mongoDecimal128Codec.decode(
        await mongoDecimal128Codec.encode(text, {}),
        {},
      );
      expect(again).toBe(text);
    }
  });

  it('refuses a wire value of the wrong type', async () => {
    await expect(mongoDecimal128Codec.decode(wrongWire<Decimal128>(1.5), {})).rejects.toThrow(
      decodeFailed,
    );
  });

  it('refuses an application value that is not canonical decimal text', async () => {
    await expect(mongoDecimal128Codec.encode('1e3', {})).rejects.toThrow(encodeFailed);
    await expect(mongoDecimal128Codec.encode('abc', {})).rejects.toThrow(encodeFailed);
  });

  it('refuses decimal text Decimal128 cannot hold exactly', async () => {
    await expect(
      mongoDecimal128Codec.encode('12345678901234567890123456789012345', {}),
    ).rejects.toThrow(encodeFailed);
  });

  it('uses the canonical text as its JSON form', () => {
    expect(mongoDecimal128Codec.encodeJson('-0.015')).toBe('-0.015');
    expect(mongoDecimal128Codec.decodeJson('-0.015')).toBe('-0.015');
    expect(mongoDecimal128Codec.encodeJson(mongoDecimal128Codec.decodeJson('1.50'))).toBe('1.50');
  });

  it.each([
    ['exponent form', '1E+3'],
    ['a huge exponent', '1E+99999'],
    ['an exponent too large to expand', '1E+1000000000'],
    ['more digits than a Decimal128 holds', '12345678901234567890123456789012345'],
  ])('refuses JSON in %s, as encode does', (_label, json) => {
    expect(() => mongoDecimal128Codec.decodeJson(json)).toThrow(decodeFailed);
  });

  it('refuses JSON that is not decimal text', () => {
    expect(() => mongoDecimal128Codec.decodeJson(1.5)).toThrow(decodeFailed);
    expect(() => mongoDecimal128Codec.encodeJson('1e3')).toThrow(encodeFailed);
  });
});

describe('mongoBinaryCodec', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255]);

  it('encodes bytes to a Binary', async () => {
    const wire = await mongoBinaryCodec.encode(bytes, {});
    expect(wire).toBeInstanceOf(Binary);
    expect([...wire.buffer]).toEqual([...bytes]);
  });

  it('decodes a Binary to a plain Uint8Array of the same bytes', async () => {
    const decoded = await mongoBinaryCodec.decode(new Binary(bytes), {});
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(decoded)).toBe(false);
    expect([...decoded]).toEqual([...bytes]);
  });

  it('refuses a wire value of the wrong type', async () => {
    await expect(mongoBinaryCodec.decode(wrongWire<Binary>('AAEC'), {})).rejects.toThrow(
      decodeFailed,
    );
  });

  it('uses unwrapped base64 as its JSON form', () => {
    expect(mongoBinaryCodec.encodeJson(bytes)).toBe('AAEC+v8=');
    expect([...mongoBinaryCodec.decodeJson('AAEC+v8=')]).toEqual([...bytes]);
  });

  it('refuses JSON that is not base64 text', () => {
    expect(() => mongoBinaryCodec.decodeJson('not base64!')).toThrow(decodeFailed);
    expect(() => mongoBinaryCodec.decodeJson(12)).toThrow(decodeFailed);
  });
});

describe('mongoJsonCodec', () => {
  const document: JsonValue = { a: [1, 'two', null, { b: true }], c: { d: 1.5 } };

  it('passes a JSON value through the wire unchanged', async () => {
    expect(await mongoJsonCodec.encode(document, {})).toEqual(document);
    expect(await mongoJsonCodec.decode(document, {})).toEqual(document);
  });

  it('uses the value itself as its JSON form', () => {
    expect(mongoJsonCodec.encodeJson(document)).toEqual(document);
    expect(mongoJsonCodec.decodeJson(document)).toEqual(document);
  });
});

describe('BSON scalar descriptors', () => {
  it.each([
    [MONGO_INT64_CODEC_ID, ['long'], ['equality', 'order', 'numeric']],
    [MONGO_DECIMAL128_CODEC_ID, ['decimal'], ['equality', 'order', 'numeric']],
    [MONGO_BINARY_CODEC_ID, ['binData'], ['equality']],
    [MONGO_JSON_CODEC_ID, [], []],
  ])('%s declares its BSON type and traits', (codecId, targetTypes, traits) => {
    expect(mongoDescriptorById(codecId)).toMatchObject({ codecId, targetTypes, traits });
  });

  it('registers each codec in the standard set', () => {
    expect(mongoStandardCodecs.map((codec) => codec.id)).toEqual(
      expect.arrayContaining([
        MONGO_INT64_CODEC_ID,
        MONGO_DECIMAL128_CODEC_ID,
        MONGO_BINARY_CODEC_ID,
        MONGO_JSON_CODEC_ID,
      ]),
    );
  });
});
