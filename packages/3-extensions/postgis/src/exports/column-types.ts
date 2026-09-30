/**
 * Column type descriptors for the PostGIS extension.
 *
 * Use `geometryColumn` for an untyped `geometry` column, or
 * `geometry({ srid })` to declare an SRID-constrained column whose DDL
 * comes out as `geometry(Geometry, <srid>)`.
 */

import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import { POSTGIS_GEOMETRY_CODEC_ID } from '../core/constants';
import { postgisError } from '../core/errors';

export const geometryColumn = {
  codecId: POSTGIS_GEOMETRY_CODEC_ID,
  nativeType: 'geometry',
} as const satisfies ColumnTypeDescriptor;

/**
 * Build an SRID-constrained geometry column descriptor.
 *
 * @example
 *   .column('location', { type: geometry({ srid: 4326 }), nullable: false })
 *   // Produces: nativeType: 'geometry', typeParams: { srid: 4326 }
 *
 * @throws If `srid` is not a non-negative integer
 * (structured `CONTRACT.ARGUMENT_INVALID`).
 */
export function geometry<S extends number>(options: {
  readonly srid: S;
}): ColumnTypeDescriptor<typeof POSTGIS_GEOMETRY_CODEC_ID> & {
  readonly typeParams: { readonly srid: S };
} {
  const { srid } = options;
  if (!Number.isInteger(srid) || srid < 0) {
    throw postgisError(
      'CONTRACT.ARGUMENT_INVALID',
      `postgis: srid must be a non-negative integer, got ${srid}`,
      { meta: { helperPath: 'geometry', expected: 'non-negative integer', received: srid } },
    );
  }
  return {
    codecId: POSTGIS_GEOMETRY_CODEC_ID,
    nativeType: 'geometry',
    typeParams: { srid },
  } as const;
}
