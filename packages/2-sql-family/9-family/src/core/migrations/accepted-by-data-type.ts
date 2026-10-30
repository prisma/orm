import type { JsonValue } from '@internal/contract/types';
import {
  type CodecRef,
  dataTypeParams,
  type TypeLookups,
} from '@internal/framework-components/codec';
import { isStructuredError } from '@internal/utils/structured-error';
import type { JsonPath } from './json-path';

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

/** The codec of the field a `fillStoredKey` call fills, with the stack's codecs and data types to check its value against. */
export interface StoredKeyFillCodec {
  readonly codecRef: CodecRef;
  readonly types: TypeLookups;
}

/** Why `value` cannot fill the key at `path`, or `undefined` when there is no codec or its data type accepts the value. */
export function fillValueProblem(
  value: JsonValue,
  path: JsonPath,
  codec: StoredKeyFillCodec | undefined,
): string | undefined {
  if (codec === undefined || acceptedByDataType(value, codec.codecRef, codec.types)) {
    return undefined;
  }
  return `value ${JSON.stringify(value)} at path ${JSON.stringify(path.text)} is not one the data type of codec ${JSON.stringify(codec.codecRef.codecId)} accepts`;
}
