import type { JsonValue } from '@internal/contract/types';

export type Vector<N extends number = number> = readonly number[] & {
  readonly __vectorLength?: N;
};

export type CodecTypes = {
  readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
  readonly 'mongo/double@1': { readonly input: number; readonly output: number };
  readonly 'mongo/int32@1': { readonly input: number; readonly output: number };
  readonly 'mongo/bool@1': { readonly input: boolean; readonly output: boolean };
  readonly 'mongo/date@1': { readonly input: Date; readonly output: Date };
  readonly 'mongo/vector@1': {
    readonly input: readonly number[];
    readonly output: readonly number[];
  };
  readonly 'mongo/int64@1': { readonly input: bigint; readonly output: bigint };
  readonly 'mongo/decimal128@1': { readonly input: string; readonly output: string };
  readonly 'mongo/binary@1': { readonly input: Uint8Array; readonly output: Uint8Array };
  readonly 'mongo/json@1': { readonly input: JsonValue; readonly output: JsonValue };
};
