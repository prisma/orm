import { describe, expect, it } from 'vitest';
import { postgisGeometry } from '../src/core/data-types';
import { encodeEWKBHex } from '../src/core/ewkb';
import { point } from '../src/core/geojson';

describe('a geometry column with an SRID holds only geometries in that SRID', () => {
  it('reads a geometry in the column SRID', () => {
    const hex = encodeEWKBHex(point(1, 2, 4326));
    expect(postgisGeometry.fromContract(hex, { srid: 4326 }).value).toBe(hex);
  });

  it.each([
    ['another SRID', encodeEWKBHex(point(1, 2, 3857))],
    ['no SRID', encodeEWKBHex(point(1, 2))],
  ])('refuses a geometry with %s', (_case, hex) => {
    expect(() => postgisGeometry.fromContract(hex, { srid: 4326 })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message:
          'postgis/geometry JSON value must be a HEXEWKB string of a geometry with SRID 4326',
      }),
    );
  });

  it('reads a geometry in any SRID when the column names none', () => {
    const hex = encodeEWKBHex(point(1, 2, 3857));
    expect(postgisGeometry.fromContract(hex, {}).value).toBe(hex);
  });

  it('refuses hex that is not EWKB, naming the data type', () => {
    expect(() => postgisGeometry.fromContract('00', { srid: 4326 })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message:
          'postgis/geometry JSON value must be a HEXEWKB string of a geometry with SRID 4326',
        meta: { dataType: 'postgis/geometry', received: '"00"' },
      }),
    );
  });
});
