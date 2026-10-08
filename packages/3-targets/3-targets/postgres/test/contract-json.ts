import type { JsonValue } from '@internal/contract/types';
import {
  type DataType,
  type DataTypeValue,
  dataTypeParamsOf,
} from '@internal/framework-components/codec';

interface ToContract<TInput> {
  readonly dataType: DataType;
  toDataTypeValue(input: TInput): DataTypeValue;
}

interface FromContract<TInput> {
  readonly dataType: DataType;
  fromDataTypeValue(value: DataTypeValue): TInput;
}

/** The JSON `contract.json` stores for `input`, written through the codec's data type. */
export function toContractJson<TInput>(codec: ToContract<TInput>, input: TInput): JsonValue {
  return codec.dataType.toContract(codec.toDataTypeValue(input));
}

/** The application value `codec` gives for stored `json`, read by its data type under `typeParams`. */
export function fromContractJson<TInput>(
  codec: FromContract<TInput>,
  json: JsonValue,
  typeParams: unknown = {},
): TInput {
  return codec.fromDataTypeValue(
    codec.dataType.fromContract(json, dataTypeParamsOf(codec.dataType, typeParams)),
  );
}
