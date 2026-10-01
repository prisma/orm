import { isStructuredError } from '@internal/utils/structured-error';
import { BSON, Double, ObjectId } from 'bson';
import { ObjectId as DriverObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { MONGO_DOUBLE_CODEC_ID, MONGO_VECTOR_CODEC_ID } from '../src/core/codec-ids';
import {
  mongoBooleanCodec,
  mongoDateCodec,
  mongoDescriptorById,
  mongoDoubleCodec,
  mongoInt32Codec,
  mongoObjectIdCodec,
  mongoStringCodec,
  mongoVectorCodec,
} from '../src/core/codecs';

describe('mongoObjectIdCodec', () => {
  it('decodes ObjectId to hex string', async () => {
    const oid = new ObjectId('507f1f77bcf86cd799439011');
    expect(await mongoObjectIdCodec.decode(oid, {})).toBe('507f1f77bcf86cd799439011');
  });

  it('encodes hex string to ObjectId', async () => {
    const result = await mongoObjectIdCodec.encode('507f1f77bcf86cd799439011', {});
    expect(result).toBeInstanceOf(ObjectId);
    expect(result.toHexString()).toBe('507f1f77bcf86cd799439011');
  });

  it('round-trips: decode(encode(hex)) === hex', async () => {
    const hex = '65a1b2c3d4e5f6a7b8c9d0e1';
    expect(await mongoObjectIdCodec.decode(await mongoObjectIdCodec.encode(hex, {}), {})).toBe(hex);
  });
});

describe('mongoStringCodec', () => {
  it('round-trips string values', async () => {
    const value = 'hello world';
    expect(await mongoStringCodec.decode(value, {})).toBe(value);
    expect(await mongoStringCodec.encode(value, {})).toBe(value);
  });
});

describe('mongoInt32Codec', () => {
  it('round-trips number values', async () => {
    expect(await mongoInt32Codec.decode(42, {})).toBe(42);
    expect(await mongoInt32Codec.encode(42, {})).toBe(42);
  });

  it('encodes both ends of the signed 32-bit range', async () => {
    expect(await mongoInt32Codec.encode(-(2 ** 31), {})).toBe(-(2 ** 31));
    expect(await mongoInt32Codec.encode(2 ** 31 - 1, {})).toBe(2 ** 31 - 1);
  });

  it.each([
    ['1.5', 1.5],
    ['2147483648', 2 ** 31],
    ['1099511627776', 2 ** 40],
    ['-2147483649', -(2 ** 31) - 1],
    ['NaN', Number.NaN],
    ['string "1"', '1'],
  ])('refuses %s instead of letting the server reject it', async (received, value) => {
    await expect(mongoInt32Codec.encode(value as number, {})).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: `mongo/int32@1 value must be an integer from -2147483648 to 2147483647; received ${received}`,
    });
  });
});

describe('mongoDoubleCodec', () => {
  it('round-trips floating-point number values', async () => {
    expect(await mongoDoubleCodec.decode(42.5, {})).toBe(42.5);
    expect(await mongoDoubleCodec.encode(42.5, {})).toEqual(new Double(42.5));
  });

  it('encodes a whole number so that it is stored as a BSON double, not an int', async () => {
    const stored = BSON.deserialize(
      BSON.serialize({ value: await mongoDoubleCodec.encode(2, {}) }),
      { promoteValues: false },
    );
    expect(stored['value']).toMatchObject({ _bsontype: 'Double' });
    expect(stored['value'].valueOf()).toBe(2);
  });

  it('refuses a value that is not a number', async () => {
    await expect(mongoDoubleCodec.encode('2' as unknown as number, {})).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: 'mongo/double@1 value must be a number; received string "2"',
    });
  });

  it('has id mongo/double@1', () => {
    expect(mongoDoubleCodec.id).toBe(MONGO_DOUBLE_CODEC_ID);
  });
});

describe('mongoBooleanCodec', () => {
  it('round-trips boolean values', async () => {
    expect(await mongoBooleanCodec.decode(true, {})).toBe(true);
    expect(await mongoBooleanCodec.encode(false, {})).toBe(false);
  });
});

describe('mongoDateCodec', () => {
  it('round-trips Date values', async () => {
    const date = new Date('2024-01-15T10:30:00Z');
    expect(await mongoDateCodec.decode(date, {})).toBe(date);
    expect(await mongoDateCodec.encode(date, {})).toBe(date);
  });
});

describe('codecs that check the type of the value they write', () => {
  it.each<[string, { encode(value: never, ctx: object): unknown }, unknown]>([
    ['mongo/string@1 value must be a string; received null', mongoStringCodec, null],
    ['mongo/string@1 value must be a string; received 5', mongoStringCodec, 5],
    [
      'mongo/string@1 value must be a string; received a Date',
      mongoStringCodec,
      new Date('2020-01-01T00:00:00Z'),
    ],
    ['mongo/bool@1 value must be a boolean; received object', mongoBooleanCodec, { on: true }],
    ['mongo/bool@1 value must be a boolean; received undefined', mongoBooleanCodec, undefined],
    ['mongo/bool@1 value must be a boolean; received string "true"', mongoBooleanCodec, 'true'],
    ['mongo/bool@1 value must be a boolean; received null', mongoBooleanCodec, null],
    [
      'mongo/date@1 value must be a valid Date; received string "2020-01-01"',
      mongoDateCodec,
      '2020-01-01',
    ],
    [
      'mongo/date@1 value must be a valid Date; received an invalid Date',
      mongoDateCodec,
      new Date('not a date'),
    ],
    [
      'mongo/objectId@1 value must be a 24-digit hex string or an ObjectId; received null',
      mongoObjectIdCodec,
      null,
    ],
    [
      'mongo/objectId@1 value must be a 24-digit hex string or an ObjectId; received 1700000000',
      mongoObjectIdCodec,
      1700000000,
    ],
    [
      'mongo/objectId@1 value must be a 24-digit hex string or an ObjectId; received string "abcdefabcdef"',
      mongoObjectIdCodec,
      'abcdefabcdef',
    ],
    [
      'mongo/objectId@1 value must be a 24-digit hex string or an ObjectId; received string "zzzzzzzzzzzzzzzzzzzzzzzz"',
      mongoObjectIdCodec,
      'zzzzzzzzzzzzzzzzzzzzzzzz',
    ],
    [
      'mongo/objectId@1 value must be a 24-digit hex string or an ObjectId; received an object tagged ObjectId whose toHexString() does not return 24 hex digits',
      mongoObjectIdCodec,
      { _bsontype: 'ObjectId' },
    ],
    [
      'mongo/objectId@1 value must be a 24-digit hex string or an ObjectId; received an object tagged ObjectId whose toHexString() does not return 24 hex digits',
      mongoObjectIdCodec,
      { _bsontype: 'ObjectId', toHexString: () => 'not hex' },
    ],
    [
      'mongo/vector@1 value must be an array of numbers; received an array',
      mongoVectorCodec,
      [1, '2'],
    ],
    ['mongo/vector@1 value must be an array of numbers; received null', mongoVectorCodec, null],
  ])('refuses with: %s', async (message, codec, value) => {
    await expect(
      Promise.resolve().then(() => codec.encode(value as never, {})),
    ).rejects.toMatchObject({ code: 'RUNTIME.ENCODE_FAILED', message });
  });

  it('ObjectId takes upper-case hex digits', async () => {
    const encoded = await mongoObjectIdCodec.encode('65F0000000000000000000A1', {});
    expect(encoded.toHexString()).toBe('65f0000000000000000000a1');
  });

  it('ObjectId takes the driver`s ObjectId as well as a hex string', async () => {
    const hex = '65f0000000000000000000a1';
    const encoded = await mongoObjectIdCodec.encode(
      new DriverObjectId(hex) as unknown as string,
      {},
    );
    expect(encoded).toBeInstanceOf(ObjectId);
    expect(encoded.toHexString()).toBe(hex);
  });

  it('ObjectId takes an ObjectId from another major version of bson, by its hex string', async () => {
    const hex = '65f0000000000000000000a2';
    const otherMajorObjectId = {
      _bsontype: 'ObjectId',
      [Symbol.for('@@mdb.bson.version')]: 6,
      toHexString: () => hex,
    };
    const encoded = await mongoObjectIdCodec.encode(otherMajorObjectId as unknown as string, {});
    expect(encoded).toBeInstanceOf(ObjectId);
    expect(encoded.toHexString()).toBe(hex);
  });
});

describe('codec traits (descriptor-side)', () => {
  it('objectId has equality trait', () => {
    expect(mongoDescriptorById(mongoObjectIdCodec.id)?.traits).toEqual(['equality']);
  });

  it('string has equality, order, textual traits', () => {
    expect(mongoDescriptorById(mongoStringCodec.id)?.traits).toEqual([
      'equality',
      'order',
      'textual',
    ]);
  });

  it('int32 has equality, order, numeric traits', () => {
    expect(mongoDescriptorById(mongoInt32Codec.id)?.traits).toEqual([
      'equality',
      'order',
      'numeric',
    ]);
  });

  it('double has equality, order, numeric traits', () => {
    expect(mongoDescriptorById(mongoDoubleCodec.id)?.traits).toEqual([
      'equality',
      'order',
      'numeric',
    ]);
  });

  it('boolean has equality, boolean traits', () => {
    expect(mongoDescriptorById(mongoBooleanCodec.id)?.traits).toEqual(['equality', 'boolean']);
  });

  it('date has equality, order traits', () => {
    expect(mongoDescriptorById(mongoDateCodec.id)?.traits).toEqual(['equality', 'order']);
  });

  it('vector has equality trait', () => {
    expect(mongoDescriptorById(mongoVectorCodec.id)?.traits).toEqual(['equality']);
  });
});

describe('mongoVectorCodec', () => {
  it('round-trips number array values', async () => {
    const vec = [1.0, 2.5, 3.7];
    expect(await mongoVectorCodec.decode(vec, {})).toBe(vec);
    expect(await mongoVectorCodec.encode(vec, {})).toBe(vec);
  });

  it('has id mongo/vector@1', () => {
    expect(mongoVectorCodec.id).toBe(MONGO_VECTOR_CODEC_ID);
  });
});

describe('mongoDateCodec', () => {
  it('decodes wire Date through identity', async () => {
    const d = new Date('2024-01-02T03:04:05.000Z');
    expect(await mongoDateCodec.decode(d, {})).toBe(d);
  });

  it('encodes Date through identity', async () => {
    const d = new Date('2024-01-02T03:04:05.000Z');
    expect(await mongoDateCodec.encode(d, {})).toBe(d);
  });

  it('encodeJson serialises to ISO string', () => {
    const d = new Date('2024-01-02T03:04:05.000Z');
    expect(mongoDateCodec.encodeJson(d)).toBe('2024-01-02T03:04:05.000Z');
  });

  it('decodeJson parses ISO string back to Date', () => {
    const result = mongoDateCodec.decodeJson('2024-01-02T03:04:05.000Z');
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe('2024-01-02T03:04:05.000Z');
  });

  it('decodeJson throws on non-string input', () => {
    expect(() => mongoDateCodec.decodeJson(123 as unknown as string)).toThrow(
      'mongo/date@1 JSON value must be a date and time in UTC as Date.toISOString writes it',
    );
  });

  it('decodeJson throws RUNTIME.DECODE_FAILED on non-string input', () => {
    let caught: unknown;
    try {
      mongoDateCodec.decodeJson(123 as unknown as string);
    } catch (err) {
      caught = err;
    }
    expect(isStructuredError(caught)).toBe(true);
    if (!isStructuredError(caught)) return;
    expect(caught.code).toBe('RUNTIME.DECODE_FAILED');
  });
});

describe('mongo vector descriptor renderOutputType', () => {
  // The descriptor list is heterogeneous (`CodecDescriptor` with default `P = void`); the per-codec `P` for vector is `Record<string, unknown>` — narrow back here to invoke the renderer with concrete typeParams.
  const renderVector = mongoDescriptorById(mongoVectorCodec.id)?.renderOutputType as
    | ((typeParams: Record<string, unknown>) => string | undefined)
    | undefined;

  it('renders Vector<length> when length is present', () => {
    expect(renderVector?.({ length: 1536 })).toBe('Vector<1536>');
  });

  it('renders Vector<length> with small dimension', () => {
    expect(renderVector?.({ length: 3 })).toBe('Vector<3>');
  });

  it('returns undefined when length is absent', () => {
    expect(renderVector?.({})).toBeUndefined();
  });

  it('throws on NaN length', () => {
    expect(() => renderVector?.({ length: Number.NaN })).toThrow(
      /expected positive integer "length"/,
    );
  });

  it('throws on non-integer length', () => {
    expect(() => renderVector?.({ length: 3.5 })).toThrow(/expected positive integer "length"/);
  });

  it('throws on zero length', () => {
    expect(() => renderVector?.({ length: 0 })).toThrow(/expected positive integer "length"/);
  });

  it('throws on negative length', () => {
    expect(() => renderVector?.({ length: -1 })).toThrow(/expected positive integer "length"/);
  });

  it('throws RUNTIME.TYPE_PARAMS_INVALID on invalid length', () => {
    let caught: unknown;
    try {
      renderVector?.({ length: -1 });
    } catch (err) {
      caught = err;
    }
    expect(isStructuredError(caught)).toBe(true);
    if (!isStructuredError(caught)) return;
    expect(caught.code).toBe('RUNTIME.TYPE_PARAMS_INVALID');
  });
});

describe('mongo descriptor factory', () => {
  it('descriptor.factory()(ctx) returns the underlying MongoCodec', () => {
    const descriptor = mongoDescriptorById(mongoStringCodec.id);
    expect(descriptor).toBeDefined();
    if (!descriptor) return;
    const make = (descriptor.factory as () => () => unknown)();
    const codec = make();
    expect(codec).toBe(mongoStringCodec);
  });

  it('every standard mongo codec descriptor materializes its codec via factory', () => {
    for (const descriptor of [
      mongoDescriptorById(mongoObjectIdCodec.id),
      mongoDescriptorById(mongoVectorCodec.id),
      mongoDescriptorById(mongoDateCodec.id),
    ]) {
      expect(descriptor).toBeDefined();
      if (!descriptor) continue;
      const make = (descriptor.factory as () => () => unknown)();
      expect(typeof make).toBe('function');
      expect(make()).toBeDefined();
    }
  });
});
