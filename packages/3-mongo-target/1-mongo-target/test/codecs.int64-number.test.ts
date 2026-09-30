import { BSON, Long } from 'bson';
import { describe, expect, it } from 'vitest';
import { MONGO_INT64_NUMBER_CODEC_ID } from '../src/core/codec-ids';
import { buildStandardCodecRegistry, mongoDescriptorById } from '../src/core/codecs';

const decodeFailed = expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED' });
const encodeFailed = expect.objectContaining({ code: 'RUNTIME.ENCODE_FAILED' });

function codec() {
  const found = buildStandardCodecRegistry().get(MONGO_INT64_NUMBER_CODEC_ID);
  if (found === undefined) throw new Error(`${MONGO_INT64_NUMBER_CODEC_ID} is not registered`);
  return found;
}

function wrongType<T>(value: unknown): T {
  return value as T;
}

describe('mongo/int64Number@1', () => {
  it('writes a safe integer as a BSON long', async () => {
    for (const value of [0, 42, -7, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
      const wire = await codec().encode(value, {});
      expect(BSON.deserialize(BSON.serialize({ v: wire }), { promoteLongs: false })).toEqual({
        v: Long.fromNumber(value),
      });
    }
  });

  it('refuses a number that is not an integer or lies outside the safe integer range', async () => {
    for (const value of [2.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      await expect(codec().encode(value, {})).rejects.toThrow(encodeFailed);
    }
    await expect(codec().encode(2.5, {})).rejects.toThrow(
      'mongo/int64Number@1 value must be an integer from -9007199254740991 to 9007199254740991; received 2.5',
    );
  });

  it('refuses a value that is not a number', async () => {
    await expect(codec().encode(wrongType<number>(9n), {})).rejects.toThrow(
      'mongo/int64Number@1 value must be an integer from -9007199254740991 to 9007199254740991; received 9n',
    );
    await expect(codec().encode(wrongType<number>('9'), {})).rejects.toThrow(
      'mongo/int64Number@1 value must be an integer from -9007199254740991 to 9007199254740991; received string "9"',
    );
  });

  it.each([
    ['the default options', {}],
    ['promoteLongs: false', { promoteLongs: false }],
    ['useBigInt64: true', { useBigInt64: true }],
  ])('reads a stored long as a number with %s', async (_name, options) => {
    const document = BSON.deserialize(
      BSON.serialize({ v: Long.fromNumber(-123456789012) }),
      options,
    );

    expect(await codec().decode(document['v'], {})).toBe(-123456789012);
  });

  it('reads a long past the safe integer range as an error, not a rounded number', async () => {
    for (const wire of [Long.fromBigInt(2n ** 53n), 2n ** 53n, -(2n ** 60n)]) {
      await expect(codec().decode(wire, {})).rejects.toThrow(decodeFailed);
    }
    await expect(codec().decode(Long.fromBigInt(2n ** 53n), {})).rejects.toThrow(
      'mongo/int64Number@1 wire value must be a whole number from -9007199254740991 to 9007199254740991; received 9007199254740992',
    );
  });

  it('reads a stored double past the safe integer range, or not finite, as an error', async () => {
    for (const wire of [2 ** 60, Number.NaN, Number.NEGATIVE_INFINITY]) {
      await expect(codec().decode(wire, {})).rejects.toThrow(decodeFailed);
    }
    await expect(codec().decode(2 ** 60, {})).rejects.toThrow(
      'mongo/int64Number@1 wire value must be a whole number from -9007199254740991 to 9007199254740991; received 1152921504606847000',
    );
  });

  it('reads a stored int and a whole double as the number they hold', async () => {
    expect(await codec().decode(7, {})).toBe(7);
    expect(await codec().decode(2 ** 40, {})).toBe(2 ** 40);
  });

  it('says a stored fractional double is no whole number, and points at the repair', async () => {
    await expect(codec().decode(2.5, {})).rejects.toThrow(
      'mongo/int64Number@1 wire value is the fractional double 2.5, and a 64-bit integer holds whole numbers only. Rewrite each such stored value as a long, rounded or cut off ({ $toLong: { $round: [<value>, 0] } }, or $trunc in place of $round), mapping over the list when the value sits in one. The upgrade guide step prisma6-int-written-as-long has the queries for a plain field, a list and a list of composite values.',
    );
  });

  it('refuses a wire value of another BSON type', async () => {
    await expect(codec().decode(wrongType<number>('7'), {})).rejects.toThrow(
      'mongo/int64Number@1 wire value must be a whole number from -9007199254740991 to 9007199254740991; received string "7"',
    );
  });

  it('writes and reads its JSON form as decimal text, as mongo/int64@1 does', () => {
    expect(codec().encodeJson(42)).toBe('42');
    expect(codec().decodeJson('-42')).toBe(-42);
    expect(() => codec().decodeJson(42)).toThrow(
      'mongo/int64Number@1 JSON value must be decimal integer text',
    );
    expect(() => codec().decodeJson('9007199254740992')).toThrow(
      'mongo/int64Number@1 JSON value must be a whole number from -9007199254740991 to 9007199254740991; received 9007199254740992',
    );
    expect(() => codec().encodeJson(1.5)).toThrow(encodeFailed);
  });

  it('describes a long of the int64 data type, and renders a default as a number literal', () => {
    const descriptor = mongoDescriptorById(MONGO_INT64_NUMBER_CODEC_ID);

    expect(descriptor).toMatchObject({
      dataType: 'mongo/int64',
      targetTypes: ['long'],
      traits: ['equality', 'order', 'numeric'],
    });
    expect(descriptor?.renderValueLiteral?.('123', 'output')).toBe('123');
    expect(descriptor?.renderValueLiteral?.(123, 'output')).toBeUndefined();
  });
});
