/**
 * Codec type definitions for the PostGIS extension.
 *
 * Re-export from types module for public API. The GeoJSON union a `geometry` column reads as is exported here too, as `GeometryValue`: an application that exports such a row names it through this entry, which its `contract.d.ts` already imports.
 */

export type { Geometry as GeometryValue } from '../core/geojson';
export type { CodecTypes, Geometry } from '../types/codec-types';
