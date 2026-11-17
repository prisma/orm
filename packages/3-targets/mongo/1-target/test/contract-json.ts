import type { JsonValue } from '@internal/contract/types';
import {
  type Codec,
  type DataTypeValue,
  readContractValue,
} from '@internal/framework-components/codec';

/** The JSON a contract stores for `value`, written through the codec's data type. */
export function toContractJson<TInput>(
  codec: Pick<Codec, 'dataType'> & { toDataTypeValue(input: TInput): DataTypeValue },
  value: TInput,
): JsonValue {
  return codec.dataType.toContract(codec.toDataTypeValue(value));
}

/** The application value the codec gives for `json`, a value a contract stores. */
export function fromContractJson<TInput>(
  codec: Pick<Codec, 'dataType'> & { fromDataTypeValue(value: DataTypeValue): TInput },
  json: JsonValue,
): TInput {
  return readContractValue(codec, json, undefined) as TInput;
}
