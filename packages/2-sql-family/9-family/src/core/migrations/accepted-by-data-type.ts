import type { JsonValue } from '@internal/contract/types';
import {
  type CodecRef,
  dataTypeParams,
  type TypeLookups,
} from '@internal/framework-components/codec';
import { isStructuredError } from '@internal/utils/structured-error';

/** Whether the data type of `codecRef`'s codec reads `json` as `contract.json` would; a codec the stack does not know accepts nothing. */
export function acceptedByDataType(
  json: JsonValue,
  codecRef: CodecRef,
  types: TypeLookups,
): boolean {
  const descriptor = types.codecLookup.descriptorFor(codecRef.codecId);
  const dataType =
    descriptor === undefined ? undefined : types.dataTypeLookup.get(descriptor.dataType);
  if (dataType === undefined) return false;
  try {
    dataType.fromContract(json, dataTypeParams(dataType, codecRef.typeParams));
    return true;
  } catch (error) {
    if (isStructuredError(error)) return false;
    throw error;
  }
}
