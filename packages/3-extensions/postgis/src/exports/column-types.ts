/**
 * Column type descriptors for the PostGIS extension.
 *
 * Use `geometryColumn` for an untyped `geometry` column, or
 * `geometry({ srid })` to declare an SRID-constrained column whose DDL
 * comes out as `geometry(Geometry, <srid>)`.
 */

import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import { POSTGIS_GEOMETRY_CODEC_ID } from '../core/constants';

export const geometryColumn = {
  codecId: POSTGIS_GEOMETRY_CODEC_ID,
} as const satisfies ColumnTypeDescriptor;

/**
 * Build an SRID-constrained geometry column descriptor.
 *
 * @example
 *   .column('location', { type: geometry({ srid: 4326 }), nullable: false })
 *   // Produces: codecId: 'pg/geometry@1', typeParams: { srid: 4326 }
 */
export function geometry<S extends number>(options: {
  readonly srid: S;
}): ColumnTypeDescriptor<typeof POSTGIS_GEOMETRY_CODEC_ID> & {
  readonly typeParams: { readonly srid: S };
} {
  const { srid } = options;
  return {
    codecId: POSTGIS_GEOMETRY_CODEC_ID,
    typeParams: { srid },
  } as const;
}
