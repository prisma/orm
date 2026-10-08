/** The data type this extension owns. A geometry is written as text, which it takes unchanged, and stored as HEXEWKB. ADR 254. */

import {
  type DataType,
  type DataTypeReader,
  readJsonMatching,
  refuseJsonValue,
} from '@internal/framework-components/codec';
import { sqlDataType } from '@internal/sql-contract/data-type';
import { pgText } from '@internal/target-postgres/data-types';
import { isInternalError } from '@internal/utils/internal-error';
import { type as arktype } from 'arktype';
import { decodeEWKBHex } from './ewkb';

export const postgisGeometryParams = arktype({ 'srid?': 'number.integer >= 1' });

const HEX_TEXT = /^(?:[0-9A-Fa-f]{2})*$/;

/** The SRID HEXEWKB carries, or `undefined` when it carries none or is not EWKB. */
function sridOf(hex: string): number | undefined {
  try {
    return decodeEWKBHex(hex).srid;
  } catch (error) {
    if (isInternalError(error)) throw error;
    return undefined;
  }
}

/** A column with an SRID holds only geometries in that SRID, as PostGIS refuses any other. */
const readGeometry: DataTypeReader = (json, params) => {
  const hex = readJsonMatching('postgis/geometry', json, HEX_TEXT, 'a HEXEWKB string');
  const srid = params['srid'];
  if (typeof srid !== 'number' || sridOf(hex) === srid) return json;
  return refuseJsonValue(
    'postgis/geometry',
    `a HEXEWKB string of a geometry with SRID ${srid}`,
    json,
  );
};

export const postgisGeometry = sqlDataType('postgis/geometry', {
  params: postgisGeometryParams,
  read: readGeometry,
  texts: [
    { text: 'geometry', written: true, catalog: true },
    {
      text: 'geometry(geometry,{srid})',
      written: true,
      catalog: true,
      display: 'geometry(Geometry,{srid})',
    },
  ],
  casts: { [pgText.id]: (value) => value },
});

export const postgisDataTypes: readonly DataType[] = [postgisGeometry];
