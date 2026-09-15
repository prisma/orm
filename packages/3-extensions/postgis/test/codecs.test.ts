import type { JsonValue } from '@internal/contract/types';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { pgGeometryColumn, postgisGeometryDescriptor } from '../src/core/codecs';
import type { Geometry } from '../src/core/geojson';

type AsyncGeometryCodec = {
  readonly encode: (value: Geometry) => Promise<string>;
  readonly decode: (wire: string) => Geometry;
  readonly encodeJson: (value: Geometry) => JsonValue;
  readonly decodeJson: (json: JsonValue) => Geometry;
};

function asAsyncCodec(srid = 4326): AsyncGeometryCodec {
  return postgisGeometryDescriptor.factory({ srid })({
    name: 'test',
  }) as unknown as AsyncGeometryCodec;
}

describe('postgis codecs', () => {
  it(
    'has geometry descriptor registered',
    () => {
      expect(postgisGeometryDescriptor.codecId).toBe('pg/geometry@1');
      expect(postgisGeometryDescriptor.targetTypes).toEqual(['geometry']);
    },
    timeouts.default,
  );

  describe('encode (Geometry → EWKT)', () => {
    it('encodes a Point without SRID', async () => {
      const c = asAsyncCodec();
      expect(await c.encode({ type: 'Point', coordinates: [1, 2] })).toBe('POINT(1 2)');
    });

    it('encodes a Point with SRID prefix', async () => {
      const c = asAsyncCodec();
      expect(await c.encode({ type: 'Point', coordinates: [-122.4194, 37.7749], srid: 4326 })).toBe(
        'SRID=4326;POINT(-122.4194 37.7749)',
      );
    });

    it('encodes a LineString', async () => {
      const c = asAsyncCodec();
      expect(
        await c.encode({
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
            [2, 0],
          ],
          srid: 4326,
        }),
      ).toBe('SRID=4326;LINESTRING(0 0,1 1,2 0)');
    });

    it('encodes a Polygon with one ring', async () => {
      const c = asAsyncCodec();
      expect(
        await c.encode({
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
          srid: 4326,
        }),
      ).toBe('SRID=4326;POLYGON((0 0,1 0,1 1,0 1,0 0))');
    });

    it('encodes a MultiPoint', async () => {
      const c = asAsyncCodec();
      expect(
        await c.encode({
          type: 'MultiPoint',
          coordinates: [
            [1, 2],
            [3, 4],
          ],
        }),
      ).toBe('MULTIPOINT(1 2,3 4)');
    });

    it('rejects non-object input', async () => {
      const c = asAsyncCodec();
      await expect(c.encode(null as unknown as Geometry)).rejects.toThrow(
        'Geometry value must be a GeoJSON-shaped object',
      );
    });

    it('rejects an unsupported geometry type', async () => {
      const c = asAsyncCodec();
      await expect(
        c.encode({ type: 'Sphere', coordinates: [0, 0, 0] } as unknown as Geometry),
      ).rejects.toThrow(/unsupported type/);
    });

    it('rejects when coordinates is not an array', async () => {
      const c = asAsyncCodec();
      await expect(
        c.encode({ type: 'Point', coordinates: 'oops' } as unknown as Geometry),
      ).rejects.toThrow('Geometry value: "coordinates" must be an array');
    });

    it('rejects non-finite coordinate values', async () => {
      const c = asAsyncCodec();
      await expect(
        c.encode({ type: 'Point', coordinates: [Number.NaN, 0] } as Geometry),
      ).rejects.toThrow('coordinates must be finite numbers');
    });
  });

  describe('decode (EWKB hex → Geometry)', () => {
    it('decodes a Point without SRID (LE)', async () => {
      const c = asAsyncCodec();
      const hex = '0101000000000000000000F03F0000000000000040';
      expect(await c.decode(hex)).toEqual({ type: 'Point', coordinates: [1, 2] });
    });

    it('decodes a Point with SRID 4326 (LE)', async () => {
      const c = asAsyncCodec();
      const hex = '0101000020E6100000000000000000F03F0000000000000040';
      expect(await c.decode(hex)).toEqual({
        type: 'Point',
        coordinates: [1, 2],
        srid: 4326,
      });
    });

    it('rejects non-string wire input', async () => {
      const c = asAsyncCodec();
      expect(() => c.decode(123 as unknown as string)).toThrow(
        'Geometry wire value must be a string',
      );
    });

    it('rejects an odd-length hex string', async () => {
      const c = asAsyncCodec();
      expect(() => c.decode('0')).toThrow('odd-length hex string');
    });

    it('rejects malformed hex bytes', async () => {
      const c = asAsyncCodec();
      expect(() => c.decode('ZZ')).toThrow('invalid hex byte');
    });
  });

  describe('encodeJson / decodeJson', () => {
    it('round-trips the Postgres JSON HEXEWKB representation', () => {
      const c = asAsyncCodec();
      const value: Geometry = { type: 'Point', coordinates: [1, 2], srid: 4326 };
      const encoded = c.encodeJson(value);
      expect(encoded).toBe('0101000020E6100000000000000000F03F0000000000000040');
      expect(c.decodeJson(encoded)).toEqual(value);
    });

    it('encodeJson rejects non-Geometry input', () => {
      const c = asAsyncCodec();
      expect(() => c.encodeJson(null as unknown as Geometry)).toThrow(
        'Geometry value must be a GeoJSON-shaped object',
      );
    });

    it('decodeJson rejects malformed HEXEWKB', () => {
      const c = asAsyncCodec();
      expect(() => c.decodeJson('zz')).toThrow(/invalid hex byte/);
    });
  });

  describe('pgGeometryColumn helper', () => {
    it('produces a ColumnSpec with the codec id, geometry nativeType, and srid typeParams', () => {
      const spec = pgGeometryColumn({ srid: 4326 });
      expect(spec.codecId).toBe('pg/geometry@1');
      expect(spec.nativeType).toBe('geometry');
      expect(spec.typeParams).toEqual({ srid: 4326 });
    });

    it('rejects a non-integer srid', () => {
      expect(() => pgGeometryColumn({ srid: 1.5 })).toThrow('srid must be a non-negative integer');
    });

    it('rejects a negative srid', () => {
      expect(() => pgGeometryColumn({ srid: -1 })).toThrow('srid must be a non-negative integer');
    });
  });

  describe('paramsSchema', () => {
    const validate = (params: unknown) =>
      postgisGeometryDescriptor.paramsSchema['~standard'].validate(params);

    it('accepts a non-negative integer srid', () => {
      const result = validate({ srid: 4326 });
      expect('issues' in result ? result.issues : null).toBeFalsy();
    });

    it('rejects non-integer srid', () => {
      const result = validate({ srid: 1.5 });
      expect('issues' in result && result.issues).toBeTruthy();
    });

    it('rejects negative srid', () => {
      const result = validate({ srid: -1 });
      expect('issues' in result && result.issues).toBeTruthy();
    });
  });
});
