import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { pgGeometryColumn, postgisGeometryDescriptor } from '../src/core/codecs';
import type { Geometry } from '../src/core/geojson';
import { geometry } from '../src/exports/column-types';
import { bboxPolygon, point, polygon } from '../src/exports/geojson';

type AsyncGeometryCodec = {
  readonly encode: (value: Geometry) => Promise<string>;
  readonly decode: (wire: string) => Promise<Geometry>;
  readonly encodeJson: (value: Geometry) => unknown;
  readonly decodeJson: (json: unknown) => Geometry;
};

function codec(): AsyncGeometryCodec {
  return postgisGeometryDescriptor.factory({ srid: 4326 })({
    name: 'test',
  }) as unknown as AsyncGeometryCodec;
}

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

async function captureAsync(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to reject');
}

describe('geometry helpers raise POSTGIS.GEOMETRY_INVALID', () => {
  it('point with non-finite coordinates', () => {
    const error = capture(() => point(Number.NaN, 0));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'POSTGIS.GEOMETRY_INVALID',
      message: 'point: coordinates must be finite numbers',
      meta: { helper: 'point', reason: 'non-finite coordinates' },
    });
  });

  it('polygon ring under 3 positions', () => {
    const error = capture(() =>
      polygon([
        [0, 0],
        [1, 1],
      ]),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'POSTGIS.GEOMETRY_INVALID',
      message: 'polygon: ring must contain at least 3 positions',
    });
  });

  it('polygon ring under 3 distinct positions', () => {
    const error = capture(() =>
      polygon([
        [0, 0],
        [1, 1],
        [0, 0],
        [1, 1],
      ]),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'POSTGIS.GEOMETRY_INVALID',
      message: 'polygon: ring must contain at least 3 distinct positions',
    });
  });

  it('bboxPolygon inverted bbox', () => {
    const error = capture(() => bboxPolygon([10, 0, 0, 10]));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'POSTGIS.GEOMETRY_INVALID',
      message: 'bboxPolygon: inverted bbox [10, 0, 0, 10] (expected minX <= maxX and minY <= maxY)',
      meta: { helper: 'bboxPolygon', reason: 'inverted bbox' },
    });
  });
});

describe('column helpers raise CONTRACT.ARGUMENT_INVALID', () => {
  it('geometry() with a negative srid', () => {
    const error = capture(() => geometry({ srid: -1 }));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message: 'postgis: srid must be a non-negative integer, got -1',
      meta: { helperPath: 'geometry', expected: 'non-negative integer', received: -1 },
    });
  });

  it('pgGeometryColumn() with a non-integer srid', () => {
    const error = capture(() => pgGeometryColumn({ srid: 1.5 }));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message: 'postgis: srid must be a non-negative integer, got 1.5',
      meta: { helperPath: 'pgGeometryColumn' },
    });
  });
});

describe('codec encode raises RUNTIME.ENCODE_FAILED', () => {
  it('non-GeoJSON value', async () => {
    const error = await captureAsync(() => codec().encode(null as unknown as Geometry));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: 'Geometry value must be a GeoJSON-shaped object',
      meta: { codecId: 'pg/geometry@1' },
    });
  });

  it('non-finite coordinates in EWKT rendering', async () => {
    const error = await captureAsync(() =>
      codec().encode({ type: 'Point', coordinates: [Number.NaN, 0] }),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: 'Geometry encode: coordinates must be finite numbers',
    });
  });

  it('non-finite coordinates in EWKB rendering (encodeJson)', () => {
    const error = capture(() =>
      codec().encodeJson({ type: 'Point', coordinates: [Number.NaN, 0] }),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: 'Geometry encode: coordinates must be finite numbers',
    });
  });
});

describe('codec decode raises RUNTIME.DECODE_FAILED', () => {
  it('non-string wire value', async () => {
    const error = await captureAsync(() => codec().decode(123 as unknown as string));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: 'Geometry wire value must be a string',
      meta: { codecId: 'pg/geometry@1' },
    });
  });

  it('invalid hex in wire value', async () => {
    const error = await captureAsync(() => codec().decode('ZZ'));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: 'Geometry wire value: invalid hex byte at offset 0',
      meta: { wirePreview: 'ZZ' },
    });
  });

  it('non-string JSON value', () => {
    const error = capture(() => codec().decodeJson(42));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: 'pg/geometry@1 JSON value must be a HEXEWKB string',
    });
  });
});
