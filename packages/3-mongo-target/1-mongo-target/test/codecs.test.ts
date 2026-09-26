import { isStructuredError } from '@internal/utils/structured-error';
import { ObjectId } from 'bson';
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
});

describe('mongoDoubleCodec', () => {
  it('round-trips floating-point number values', async () => {
    expect(await mongoDoubleCodec.decode(42.5, {})).toBe(42.5);
    expect(await mongoDoubleCodec.encode(42.5, {})).toBe(42.5);
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
      'expected ISO date string',
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
