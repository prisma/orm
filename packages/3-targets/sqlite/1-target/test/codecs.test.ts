import { describe, expect, it } from 'vitest';
import {
  type SqliteFloatCodec,
  type SqliteSqlIntCodec,
  sqliteBigintDescriptor,
  sqliteBlobDescriptor,
  sqliteIntegerDescriptor,
  sqliteJsonDescriptor,
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

  it('decodes number, bigint, and decimal-text wires to the same bigint', async () => {
    expect(await bigintCodec.fromWire(42, {})).toBe(42n);
    expect(await bigintCodec.fromWire(42n, {})).toBe(42n);
    expect(await bigintCodec.fromWire('9223372036854775807', {})).toBe(9223372036854775807n);
    expect(await bigintCodec.fromWire('-42', {})).toBe(-42n);
  });

  it('rejects a malformed string wire with a structured decode error', async () => {
    await expect(bigintCodec.fromWire('not-a-number', {})).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message:
        'A sqlite/bigint@1 value is "not-a-number", which is not an integer. sqlite/bigint@1 reads integers from -9223372036854775808 to 9223372036854775807.',
      meta: { codecId: 'sqlite/bigint@1', received: 'not-a-number' },
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
        'A sqlite/integer@1 value is "9007199254740993", which is not an integer within the safe integer range. sqlite/integer@1 reads integers from -9007199254740991 to 9007199254740991.',
    });
    await expect(sqlInt.fromWire('4.5', ctx)).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message:
        'A sql/int@1 value is "4.5", which is not an integer within the safe integer range. sql/int@1 reads integers from -9007199254740991 to 9007199254740991.',
    });
  });

  it('reads an infinity from its text', async () => {
    expect(await real.fromWire('Infinity', ctx)).toBe(Number.POSITIVE_INFINITY);
    expect(await sqlFloat.fromWire('-Infinity', ctx)).toBe(Number.NEGATIVE_INFINITY);
    await expect(real.fromWire('NaN', ctx)).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message:
        'A sqlite/real@1 value is "NaN", which is not a number. sqlite/real@1 reads a number, or the text Infinity or -Infinity.',
      meta: { codecId: 'sqlite/real@1', received: 'NaN' },
    });
  });

  it('reads a blob from the array of its uppercase hex text that its projection writes', async () => {
    expect(await blob.fromWire(['0ABCFF'], ctx)).toEqual(new Uint8Array([0x0a, 0xbc, 0xff]));
    expect(await blob.fromWire([''], ctx)).toEqual(new Uint8Array([]));
  });

  it.each([
    ['text, which a BLOB column outside a STRICT table holds as text', 'ABCD', '"ABCD"', 'ABCD'],
    ['a number', 42, '42', '42'],
    ['lowercase hex', ['0abc'], "bytes x'0abc'", "x'0abc'"],
  ])('sqlite/blob@1 refuses %s', async (_name, wire, shown, received) => {
    await expect(blob.fromWire(wire as never, ctx)).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: `A sqlite/blob@1 value is ${shown}, which is not a blob. sqlite/blob@1 reads a blob's bytes.`,
      meta: { codecId: 'sqlite/blob@1', received },
    });
  });

  it.each([
    ['sqlite/integer@1', integer, 'abc', '"abc"', 'abc'],
    ['sqlite/integer@1', integer, new Uint8Array([0x35]), "bytes x'35'", "x'35'"],
    ['sqlite/integer@1', integer, new Uint8Array([0x00, 0xff]), "bytes x'00FF'", "x'00FF'"],
    ['sqlite/integer@1', integer, ['35'], "bytes x'35'", "x'35'"],
    ['sql/int@1', sqlInt, 'abc', '"abc"', 'abc'],
    ['sql/int@1', sqlInt, new Uint8Array([0x35]), "bytes x'35'", "x'35'"],
    ['sql/int@1', sqlInt, new Uint8Array([0x00, 0xff]), "bytes x'00FF'", "x'00FF'"],
    ['sql/int@1', sqlInt, ['35'], "bytes x'35'", "x'35'"],
  ])(
    '%s refuses %j, which an INTEGER column outside a STRICT table can hold',
    async (codecId, codec, wire, shown, received) => {
      await expect(codec.fromWire(wire as never, ctx)).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
        message: `A ${codecId} value is ${shown}, which is not an integer within the safe integer range. ${codecId} reads integers from -9007199254740991 to 9007199254740991.`,
        meta: { codecId, received },
      });
    },
  );

  it.each([
    ['sqlite/real@1', real],
    ['sql/float@1', sqlFloat],
  ])(
    '%s refuses text, which a REAL column outside a STRICT table can hold',
    async (codecId, codec) => {
      await expect(codec.fromWire('abc' as never, ctx)).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
        message: `A ${codecId} value is "abc", which is not a number. ${codecId} reads a number, or the text Infinity or -Infinity.`,
        meta: { codecId, received: 'abc' },
      });
    },
  );

  it.each([
    ['sqlite/real@1', real, new Uint8Array([0x00, 0xff]), "x'00FF'"],
    ['sqlite/real@1', real, ['35'], "x'35'"],
    ['sql/float@1', sqlFloat, new Uint8Array([0x00, 0xff]), "x'00FF'"],
    ['sql/float@1', sqlFloat, ['35'], "x'35'"],
  ])('%s refuses the blob %j', async (codecId, codec, wire, received) => {
    await expect(codec.fromWire(wire as never, ctx)).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: `A ${codecId} value is bytes ${received}, which is not a number. ${codecId} reads a number, or the text Infinity or -Infinity.`,
      meta: { codecId, received },
    });
  });

  it.each([
    ['sqlite/real@1', real],
    ['sql/float@1', sqlFloat],
  ])(
    '%s reads an integer outside the safe range as the nearest number',
    async (_codecId, codec) => {
      expect(await codec.fromWire(2n ** 60n + 1n, ctx)).toBe(2 ** 60);
    },
  );

  it.each([
    ['sqlite/integer@1', integer],
    ['sql/int@1', sqlInt],
  ])(
    '%s reads an exact integer within the safe range and refuses one outside it',
    async (codecId, codec) => {
      expect(await codec.fromWire(-9007199254740991n, ctx)).toBe(-9007199254740991);
      await expect(codec.fromWire(9007199254740993n, ctx)).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
        message: `A ${codecId} value is 9007199254740993, which is not an integer within the safe integer range. ${codecId} reads integers from -9007199254740991 to 9007199254740991.`,
        meta: { codecId, received: '9007199254740993' },
      });
    },
  );

  it.each([
    ['sqlite/integer@1', integer],
    ['sql/int@1', sqlInt],
  ])('%s refuses a stored real in a row', async (codecId, codec) => {
    await expect(codec.fromWire(1.5, ctx)).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: `A ${codecId} value is 1.5, which is not an integer within the safe integer range. ${codecId} reads integers from -9007199254740991 to 9007199254740991.`,
    });
  });

  it('shows the first 100 characters of a stored value it cannot read', async () => {
    const long = 'a'.repeat(150);
    await expect(integer.fromWire(long, ctx)).rejects.toMatchObject({
      message: `A sqlite/integer@1 value is "${'a'.repeat(100)}", which is not an integer within the safe integer range. sqlite/integer@1 reads integers from -9007199254740991 to 9007199254740991.`,
      meta: { received: 'a'.repeat(100) },
    });
    await expect(integer.fromWire(new Uint8Array(80) as never, ctx)).rejects.toMatchObject({
      meta: { received: `x'${'0'.repeat(100)}'` },
    });
  });
});

describe('sqlite/json@1 reading a stored value', () => {
  const json = sqliteJsonDescriptor.factory()({ name: 'test' });
  const column = { table: 'documents', name: 'body' };

  it('reads JSON text as the document it holds', async () => {
    expect(await json.fromWire('{"a":[1,"b"]}', { column })).toEqual({ a: [1, 'b'] });
  });

  it.each([
    ['text that is not JSON', 'abc', '"abc"', 'abc'],
    ['a blob', new Uint8Array([0x7b]), "bytes x'7B'", "x'7B'"],
  ])('refuses %s, naming its column', async (_name, wire, shown, received) => {
    await expect(json.fromWire(wire as never, { column })).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: `Column "documents"."body" holds ${shown}, which is not JSON text. sqlite/json@1 reads JSON text as the document it holds.`,
      meta: { codecId: 'sqlite/json@1', table: 'documents', column: 'body', received },
    });
  });
});
