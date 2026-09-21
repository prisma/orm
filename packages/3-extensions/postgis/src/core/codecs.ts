/**
 * Geometry codec for the PostGIS extension.
 *
 * Mirrors the descriptor + class pattern used by other codec-shipping
 * packages (e.g. pgvector). Three artefacts:
 *
 * 1. `PostgisGeometryCodec` extends {@link CodecImpl} with the runtime
 *    encode/decode conversions. Wire formats:
 *    - encode: EWKT (`'SRID=4326;POINT(...)'`) — PostgreSQL parses
 *      this when cast to `::geometry`.
 *    - decode: hex EWKB — the default representation `node-postgres`
 *      hands back for `geometry` columns. We parse it into a
 *      GeoJSON-shaped object so callers see structured data, not
 *      opaque hex.
 * 2. `PostgisGeometryDescriptor` extends {@link PostgresCodecDescriptor}
 *    with the codec id, traits, target types, params schema
 *    (`{ srid?: number }`, preserving unparameterized geometry while validating supplied SRIDs), explicit target behavior, and
 *    the emit-path `renderOutputType` producing `Geometry<${srid}>` /
 *    `Geometry` when no SRID is supplied.
 * 3. `pgGeometryColumn({ srid })` per-codec column helper invoking
 *    `descriptor.factory({ srid })` and passing the bare
 *    `nativeType: 'geometry'`. The family-layer `expandNativeType`
 *    hook renders the parameterised form
 *    (`geometry(Geometry,${srid})`) at emit/verify time from
 *    `nativeType` + `typeParams`.
 *
 * The geometry codec's encode/decode is parameter-independent — the
 * wire format already carries SRID inside the EWKT/EWKB payload, so the
 * resolved codec for every `(srid)` instance is the same shared codec
 * today. The factory threads the closure for future per-instance state
 * (e.g. SRID cross-checks) without rewriting the constructor.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type AnyCodecDescriptor,
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
} from '@internal/framework-components/codec';
import type { ExtractCodecTypes, ProjectionExpr } from '@internal/sql-relational-core/ast';
import {
  definePostgresCodecs,
  PostgresCodecDescriptor,
} from '@internal/target-postgres/codec-descriptor';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { type as arktype } from 'arktype';
import { POSTGIS_GEOMETRY_CODEC_ID } from './constants';
import { postgisGeometry } from './data-types';
import { postgisError } from './errors';
import { decodeEWKBHex, encodeEWKBHex, encodeEWKT } from './ewkb';
import type { Geometry } from './geojson';

type GeometryParams = { readonly srid?: number };

const geometryParamsSchema = arktype({
  'srid?': 'number',
}).narrow((params, ctx) => {
  const { srid } = params;
  if (srid === undefined) {
    return true;
  }
  if (!Number.isInteger(srid)) {
    return ctx.mustBe('an integer');
  }
  if (srid < 0) {
    return ctx.mustBe('a non-negative integer');
  }
  return true;
}) satisfies StandardSchemaV1<GeometryParams>;

const POSTGIS_GEOMETRY_NATIVE_TYPE = 'geometry';

const allowedGeometryTypes = new Set([
  'Point',
  'LineString',
  'Polygon',
  'MultiPoint',
  'MultiLineString',
  'MultiPolygon',
]);

function assertGeometry(value: unknown): asserts value is Geometry {
  if (!value || typeof value !== 'object') {
    throw postgisError('RUNTIME.ENCODE_FAILED', 'Geometry value must be a GeoJSON-shaped object', {
      meta: { codecId: POSTGIS_GEOMETRY_CODEC_ID },
    });
  }
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string' || !allowedGeometryTypes.has(type)) {
    throw postgisError(
      'RUNTIME.ENCODE_FAILED',
      `Geometry value: unsupported type "${String(type)}" (expected Point, LineString, Polygon, MultiPoint, MultiLineString, or MultiPolygon)`,
      { meta: { codecId: POSTGIS_GEOMETRY_CODEC_ID } },
    );
  }
  if (!Array.isArray((value as { coordinates?: unknown }).coordinates)) {
    throw postgisError('RUNTIME.ENCODE_FAILED', 'Geometry value: "coordinates" must be an array', {
      meta: { codecId: POSTGIS_GEOMETRY_CODEC_ID },
    });
  }
}

export class PostgisGeometryCodec extends CodecImpl<
  typeof POSTGIS_GEOMETRY_CODEC_ID,
  readonly ['equality'],
  string,
  Geometry
> {
  constructor(descriptor: AnyCodecDescriptor) {
    super(descriptor);
  }

  async encode(value: Geometry, _ctx: CodecCallContext): Promise<string> {
    assertGeometry(value);
    return encodeEWKT(value);
  }

  async decode(wire: string, _ctx: CodecCallContext): Promise<Geometry> {
    if (typeof wire !== 'string') {
      throw postgisError('RUNTIME.DECODE_FAILED', 'Geometry wire value must be a string', {
        meta: { codecId: POSTGIS_GEOMETRY_CODEC_ID },
      });
    }
    return decodeEWKBHex(wire);
  }

  encodeJson(value: Geometry): JsonValue {
    assertGeometry(value);
    return encodeEWKBHex(value);
  }

  decodeJson(json: JsonValue): Geometry {
    if (typeof json !== 'string') {
      throw postgisError(
        'RUNTIME.DECODE_FAILED',
        'Geometry database JSON value must be a HEXEWKB string',
        { meta: { codecId: POSTGIS_GEOMETRY_CODEC_ID } },
      );
    }
    return decodeEWKBHex(json);
  }
}

export class PostgisGeometryDescriptor extends PostgresCodecDescriptor<GeometryParams> {
  protected override nativeType(): string {
    return POSTGIS_GEOMETRY_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = postgisGeometry.id;
  override readonly codecId = POSTGIS_GEOMETRY_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['geometry'] as const;
  override readonly paramsSchema: StandardSchemaV1<GeometryParams> = geometryParamsSchema;
  override renderOutputType(params: GeometryParams): string {
    const { srid } = params;
    if (srid === undefined) return 'Geometry';
    return `Geometry<${srid}>`;
  }
  /**
   * Runtime materialization uses an empty parameter object for the
   * existing unparameterized `geometryColumn` variant and `{ srid }` for
   * constrained columns. Both resolve to the same SRID-agnostic codec:
   * the wire format already carries SRID inside the EWKT/EWKB payload,
   * so codec behavior is parameter-independent.
   */
  override factory(_params: GeometryParams): (ctx: CodecInstanceContext) => PostgisGeometryCodec {
    return () => new PostgisGeometryCodec(this);
  }
}

export const postgisGeometryDescriptor = new PostgisGeometryDescriptor();

/**
 * Per-codec column helper for `pg/geometry@1` with an SRID constraint.
 *
 * Generic over `S extends number` so the column site preserves the
 * SRID literal in `typeParams` (e.g. `pgGeometryColumn({ srid: 4326 })`
 * packs `typeParams: { srid: 4326 }`).
 *
 * Passes the bare `nativeType: 'geometry'`; the family-layer
 * `expandNativeType` hook renders the parameterised form
 * (`geometry(Geometry,${srid})`) at emit/verify time from `nativeType`
 * + `typeParams`.
 *
 * @throws If `srid` is not a non-negative integer
 * (structured `CONTRACT.ARGUMENT_INVALID`).
 */
export const pgGeometryColumn = <S extends number>(options: { readonly srid: S }) => {
  const { srid } = options;
  if (!Number.isInteger(srid) || srid < 0) {
    throw postgisError(
      'CONTRACT.ARGUMENT_INVALID',
      `postgis: srid must be a non-negative integer, got ${srid}`,
      {
        meta: { helperPath: 'pgGeometryColumn', expected: 'non-negative integer', received: srid },
      },
    );
  }
  return column(
    postgisGeometryDescriptor.factory({ srid }),
    postgisGeometryDescriptor.codecId,
    { srid },
    'geometry',
  );
};

pgGeometryColumn satisfies ColumnHelperFor<PostgisGeometryDescriptor>;
pgGeometryColumn satisfies ColumnHelperForStrict<PostgisGeometryDescriptor>;

const codecDescriptorMap = {
  geometry: postgisGeometryDescriptor,
} as const;

export type CodecTypes = ExtractCodecTypes<typeof codecDescriptorMap>;

export const codecDescriptors = definePostgresCodecs(Object.values(codecDescriptorMap));
