/**
 * The data type this extension owns. It holds a JSON document that a schema validates, so it takes
 * a written JSON document unchanged and the codec instance validates it. ADR 254.
 */

import { type DataType, dataType } from '@internal/framework-components/codec';
import { pgJson } from '@internal/target-postgres/data-types';

export const arktypeJson: DataType = dataType('arktype/json', {
  casts: { [pgJson.id]: (value) => value },
});

export const arktypeJsonDataTypes: readonly DataType[] = [arktypeJson];
