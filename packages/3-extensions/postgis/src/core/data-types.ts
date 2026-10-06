/** The data type this extension owns. A geometry is written as text, which it takes unchanged. ADR 254. */

import type { DataType } from '@internal/framework-components/codec';
import { sqlDataType } from '@internal/sql-contract/data-type';
import { pgText } from '@internal/target-postgres/data-types';
import { type as arktype } from 'arktype';

export const postgisGeometryParams = arktype({ 'srid?': 'number.integer >= 1' });

export const postgisGeometry = sqlDataType('postgis/geometry', {
  params: postgisGeometryParams,
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
