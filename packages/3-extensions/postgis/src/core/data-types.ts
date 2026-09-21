/** The data type this extension owns. A geometry is written as text, which it takes unchanged. ADR 254. */

import { type DataType, dataType } from '@internal/framework-components/codec';
import { pgText } from '@internal/target-postgres/data-types';

export const postgisGeometry: DataType = dataType('postgis/geometry', {
  casts: { [pgText.id]: (value) => value },
});

export const postgisDataTypes: readonly DataType[] = [postgisGeometry];
