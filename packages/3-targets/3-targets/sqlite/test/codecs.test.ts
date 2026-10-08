import { describe, expect, it } from 'vitest';
import {
  sqliteBigintDescriptor,
  sqliteBlobDescriptor,
  sqliteIntegerDescriptor,
  sqliteRealDescriptor,
  sqliteSqlFloatDescriptor,
  sqliteSqlIntDescriptor,
} from '../src/core/codecs';
import { fromContractJson, toContractJson } from './contract-json';

describe('SQLite codec JSON representations', () => {
  const bigintCodec = sqliteBigintDescriptor.factory()({ name: 'test' });

  it('uses decimal text for bigint values, so the int64 range survives', () => {
    expect(toContractJson(bigintCodec, 42n)).toBe('42');
    expect(fromContractJson(bigintCodec, '42')).toBe(42n);
    expect(toContractJson(bigintCodec, 9223372036854775807n)).toBe('9223372036854775807');
    expect(fromContractJson(bigintCodec, '9223372036854775807')).toBe(9223372036854775807n);
  });

  it('rejects a JSON number, which has already lost digits', () => {
    expect(() => fromContractJson(bigintCodec, 42)).toThrow(
      'sqlite/integer JSON value must be a decimal integer string from -9223372036854775808 to 9223372036854775807',
    );
  });

  it('decodes number, bigint, and decimal-text wires to the same bigint', async () => {
    expect(await bigintCodec.fromWire(42, {})).toBe(42n);
    expect(await bigintCodec.fromWire(42n, {})).toBe(42n);
    expect(await bigintCodec.fromWire('9223372036854775807', {})).toBe(9223372036854775807n);
    expect(await bigintCodec.fromWire('-42', {})).toBe(-42n);
  });

  it('rejects a malformed string wire with a structured decode error', async () => {
    await expect(bigintCodec.fromWire('not-a-number', {})).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: 'sqlite/bigint@1 wire value must be a decimal string',
      meta: { codecId: 'sqlite/bigint@1' },
    });
  });
});

describe('SQLite codecs read the value an include carries', () => {
  const ctx = {};
  const integer = sqliteIntegerDescriptor.factory()({ name: 'test' });
  const sqlInt = sqliteSqlIntDescriptor.factory()({ name: 'test' });
  const real = sqliteRealDescriptor.factory()({ name: 'test' });
  const sqlFloat = sqliteSqlFloatDescriptor.factory()({ name: 'test' });
  const blob = sqliteBlobDescriptor.factory()({ name: 'test' });

  it('reads an integer from its decimal text, refusing one past the safe range', async () => {
    expect(await integer.fromWire('-42', ctx)).toBe(-42);
    expect(await sqlInt.fromWire('9007199254740991', ctx)).toBe(9007199254740991);
    await expect(integer.fromWire('9007199254740993', ctx)).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message:
        'sqlite/integer@1 value must be an integer within the safe integer range, got 9007199254740993',
    });
    await expect(sqlInt.fromWire('4.5', ctx)).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: 'sql/int@1 wire value must be an integer or its decimal text',
    });
  });

  it('reads an infinity from its text', async () => {
    expect(await real.fromWire('Infinity', ctx)).toBe(Number.POSITIVE_INFINITY);
    expect(await sqlFloat.fromWire('-Infinity', ctx)).toBe(Number.NEGATIVE_INFINITY);
    await expect(real.fromWire('NaN', ctx)).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: 'sqlite/real@1 wire value must be a number, or the text Infinity or -Infinity',
    });
  });

  it('reads a blob from the uppercase hex text hex() writes', async () => {
    expect(await blob.fromWire('0ABCFF', ctx)).toEqual(new Uint8Array([0x0a, 0xbc, 0xff]));
    expect(await blob.fromWire('', ctx)).toEqual(new Uint8Array([]));
    await expect(blob.fromWire('0abc', ctx)).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: 'sqlite/blob@1 wire value must be bytes or the uppercase hex text of bytes',
    });
  });
});
