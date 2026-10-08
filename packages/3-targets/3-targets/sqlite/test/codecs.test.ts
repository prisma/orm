import { describe, expect, it } from 'vitest';
import {
  type SqliteFloatCodec,
  type SqliteSqlIntCodec,
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
  // The adapted descriptors are typed with the family codec, whose wire value is a number; the SQLite codec also reads text.
  const sqlInt = sqliteSqlIntDescriptor.factory()({ name: 'test' }) as unknown as SqliteSqlIntCodec;
  const real = sqliteRealDescriptor.factory()({ name: 'test' });
  const sqlFloat = sqliteSqlFloatDescriptor.factory()({
    name: 'test',
  }) as unknown as SqliteFloatCodec;
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

  it('reads a blob from the array of its uppercase hex text that its projection writes', async () => {
    expect(await blob.fromWire(['0ABCFF'], ctx)).toEqual(new Uint8Array([0x0a, 0xbc, 0xff]));
    expect(await blob.fromWire([''], ctx)).toEqual(new Uint8Array([]));
  });

  it.each([
    ['text, which a BLOB column outside a STRICT table holds as text', 'ABCD'],
    ['a number', 42],
    ['lowercase hex', ['0abc']],
  ])('sqlite/blob@1 refuses %s', async (_name, wire) => {
    await expect(blob.fromWire(wire as never, ctx)).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message:
        'sqlite/blob@1 wire value must be bytes, or the array of their hex text an include carries',
    });
  });

  it.each([
    ['sqlite/integer@1', integer, 'abc'],
    ['sqlite/integer@1', integer, new Uint8Array([0x00, 0xff])],
    ['sql/int@1', sqlInt, 'abc'],
    ['sql/int@1', sqlInt, new Uint8Array([0x00, 0xff])],
  ])(
    '%s refuses %j, which an INTEGER column outside a STRICT table can hold',
    async (codecId, codec, wire) => {
      await expect(codec.fromWire(wire as never, ctx)).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
        message: `${codecId} wire value must be an integer or its decimal text`,
      });
    },
  );

  it.each([
    ['sqlite/real@1', real, 'abc'],
    ['sqlite/real@1', real, new Uint8Array([0x00, 0xff])],
    ['sql/float@1', sqlFloat, 'abc'],
    ['sql/float@1', sqlFloat, new Uint8Array([0x00, 0xff])],
  ])(
    '%s refuses %j, which a REAL column outside a STRICT table can hold',
    async (codecId, codec, wire) => {
      await expect(codec.fromWire(wire as never, ctx)).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
        message: `${codecId} wire value must be a number, or the text Infinity or -Infinity`,
      });
    },
  );
});
