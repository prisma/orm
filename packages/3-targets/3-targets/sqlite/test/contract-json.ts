import type { JsonValue } from '@internal/contract/types';
import { type Codec, readContractValue } from '@internal/framework-components/codec';

type CodecOf<TInput, Method extends keyof Codec> = Pick<
  Codec<string, never, unknown, TInput>,
  'dataType' | Method
>;

export function toContractJson<TInput>(
  codec: CodecOf<TInput, 'toDataTypeValue'>,
  input: TInput,
): JsonValue {
  return codec.dataType.toContract(codec.toDataTypeValue(input));
}

export function fromContractJson<TInput>(
  codec: CodecOf<TInput, 'fromDataTypeValue'>,
  json: JsonValue,
  typeParams: unknown = {},
): TInput {
  return readContractValue(codec, json, typeParams) as TInput;
}
