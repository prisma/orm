import type { JsonValue } from '@internal/contract/types';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { pgVectorColumn, pgVectorDescriptor } from '../src/core/codecs';
import { VECTOR_CODEC_ID, VECTOR_MAX_DIM } from '../src/core/constants';

type AsyncVectorCodec = {
  readonly encode: (value: number[]) => Promise<string>;
  readonly decode: (wire: string) => number[];
  readonly encodeJson: (value: number[]) => JsonValue;
  readonly decodeJson: (json: JsonValue) => number[];
};

function asAsyncCodec(length: number): AsyncVectorCodec {
  // pgvector's runtime codec enforces the declared dimension; tests instantiate the codec at the dimension matching their value array.
  return pgVectorDescriptor.factory({ length })({
    name: 'test',
  }) as unknown as AsyncVectorCodec;
}

describe('pgvector codecs', () => {
  it(
    'has vector codec registered',
    () => {
      expect(pgVectorDescriptor.codecId).toBe('pg/vector@1');
      expect(pgVectorDescriptor.targetTypes).toEqual(['vector']);
    },
    timeouts.default,
  );

  it('encodes number array to PostgreSQL vector format', async () => {
    const vectorCodec = asAsyncCodec(4);
    const value = [0.1, 0.2, 0.3, 0.4];
    const encoded = await vectorCodec.encode(value);
    expect(encoded).toBe('[0.1,0.2,0.3,0.4]');
    expect(typeof encoded).toBe('string');
  });

  it('decodes PostgreSQL vector format string', async () => {
    const vectorCodec = asAsyncCodec(4);
    const wire = '[0.1,0.2,0.3,0.4]';
    const decoded = await vectorCodec.decode(wire);
    expect(decoded).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('round-trip encode/decode preserves values', async () => {
    const vectorCodec = asAsyncCodec(5);
    const original = [0.1, 0.2, 0.3, 0.4, 0.5];
    const encoded = await vectorCodec.encode(original);
    expect(typeof encoded).toBe('string');
    expect(encoded).toBe('[0.1,0.2,0.3,0.4,0.5]');
    const decoded = await vectorCodec.decode(encoded);
    expect(decoded).toEqual(original);
  });

  it('handles empty vector', async () => {
    const vectorCodec = asAsyncCodec(0);
    const original: number[] = [];
    const encoded = await vectorCodec.encode(original);
    expect(encoded).toBe('[]');
    const decoded = await vectorCodec.decode(encoded);
    expect(decoded).toEqual([]);
  });

  it('rejects when encoding non-array', async () => {
    const vectorCodec = asAsyncCodec(4);
    await expect(vectorCodec.encode('not an array' as unknown as number[])).rejects.toThrow(
      'Vector value must be an array of numbers',
    );
  });

  it('rejects when encoding array with non-numbers', async () => {
    const vectorCodec = asAsyncCodec(3);
    await expect(vectorCodec.encode([1, 2, 'three'] as unknown as number[])).rejects.toThrow(
      'Vector value must contain only numbers',
    );
  });

  it('rejects non-finite values across wire and database JSON paths', async () => {
    const vectorCodec = asAsyncCodec(3);

    for (const nonFinite of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const value = [1, nonFinite, 3];
      const wire = `[1,${nonFinite},3]`;

      await expect(vectorCodec.encode(value)).rejects.toThrow(
        'Vector value must contain only finite numbers',
      );
      expect(() => vectorCodec.decode(wire)).toThrow(
        'Vector value must contain only finite numbers',
      );
      expect(() => vectorCodec.encodeJson(value)).toThrow(
        'Vector value must contain only finite numbers',
      );
      expect(() => vectorCodec.decodeJson(value)).toThrow(
        'Vector value must contain only finite numbers',
      );
    }
  });

  it('rejects when decoding invalid string format', async () => {
    const vectorCodec = asAsyncCodec(4);
    expect(() => vectorCodec.decode('not a vector format')).toThrow(
      'Invalid vector format: expected "[...]", got "not a vector format"',
    );
  });

  it('rejects when decoding non-string', async () => {
    const vectorCodec = asAsyncCodec(4);
    expect(() => vectorCodec.decode(123 as unknown as string)).toThrow(
      'Vector wire value must be a string',
    );
  });

  it('rejects encoding when value length mismatches declared dimension', async () => {
    const vectorCodec = asAsyncCodec(3);
    await expect(vectorCodec.encode([1, 2])).rejects.toThrow(
      'Vector length mismatch: expected 3, got 2',
    );
    await expect(vectorCodec.encode([1, 2, 3, 4])).rejects.toThrow(
      'Vector length mismatch: expected 3, got 4',
    );
  });

  it('rejects decoding when wire length mismatches declared dimension', async () => {
    const vectorCodec = asAsyncCodec(3);
    expect(() => vectorCodec.decode('[1,2]')).toThrow('Vector length mismatch: expected 3, got 2');
  });

  it('rejects decoding when the wire payload contains a non-number token', async () => {
    const vectorCodec = asAsyncCodec(3);
    expect(() => vectorCodec.decode('[1,foo,3]')).toThrow(
      /Invalid vector value: "foo" is not a number/,
    );
  });

  describe('encodeJson / decodeJson', () => {
    it('encodes to a JSON numeric array', () => {
      const codec = asAsyncCodec(3);
      expect(codec.encodeJson([0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
    });

    it('decodes a JSON numeric array', () => {
      const codec = asAsyncCodec(3);
      expect(codec.decodeJson([0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
    });

    it('rejects the text form, which reads back at the wrong precision', () => {
      const codec = asAsyncCodec(3);
      expect(() => codec.decodeJson('[0.1,0.2,0.3]')).toThrow(
        'Vector database JSON value must be an array',
      );
    });

    it('rejects encodeJson when the value is not an array', () => {
      const codec = asAsyncCodec(3);
      expect(() => codec.encodeJson('nope' as unknown as number[])).toThrow(
        'Vector value must be an array of numbers',
      );
    });

    it('rejects decodeJson when the array has the wrong length or bad elements', () => {
      const codec = asAsyncCodec(3);
      expect(() => codec.decodeJson([1, 2])).toThrow(/Vector length mismatch/);
      expect(() => codec.decodeJson([1, 'two', 3] as unknown as number[])).toThrow(
        /Vector value must contain only numbers/,
      );
    });
  });

  describe('pgVectorColumn helper', () => {
    it('produces a ColumnSpec with the codec id, vector nativeType, and length typeParams', () => {
      const spec = pgVectorColumn(1536);
      expect(spec.codecId).toBe(VECTOR_CODEC_ID);
      expect(spec.nativeType).toBe('vector');
      expect(spec.typeParams).toEqual({ length: 1536 });
    });

    it('produces a codec factory that materializes a working PgVectorCodec', async () => {
      const spec = pgVectorColumn(3);
      const codec = spec.codecFactory({
        name: 'embedding',
      }) as unknown as AsyncVectorCodec;
      expect(await codec.encode([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]');
    });
  });

  describe('paramsSchema', () => {
    const validate = (params: unknown) =>
      pgVectorDescriptor.paramsSchema['~standard'].validate(params);

    it('accepts a positive integer length within the allowed range', () => {
      const result = validate({ length: 1536 });
      expect('issues' in result ? result.issues : null).toBeFalsy();
    });

    it('rejects non-integer length values', () => {
      const result = validate({ length: 1.5 });
      expect('issues' in result && result.issues).toBeTruthy();
    });

    it('rejects length values below 1', () => {
      const result = validate({ length: 0 });
      expect('issues' in result && result.issues).toBeTruthy();
    });

    it('rejects length values above VECTOR_MAX_DIM', () => {
      const result = validate({ length: VECTOR_MAX_DIM + 1 });
      expect('issues' in result && result.issues).toBeTruthy();
    });
  });
});
