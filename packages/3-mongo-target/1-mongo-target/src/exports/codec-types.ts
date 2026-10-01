import type { JsonValue } from '@internal/contract/types';
import type { BsonInputValue, BsonValue } from '@internal/mongo-value';

export type { BsonInputValue, BsonScalar, BsonValue } from '@internal/mongo-value';

export type Vector<N extends number = number> = readonly number[] & {
  readonly __vectorLength?: N;
};

export type CodecTypes = {
  readonly 'mongo/objectId@1': {
    readonly input: string;
    readonly output: string;
    readonly traits: 'equality';
  };
  readonly 'mongo/string@1': {
    readonly input: string;
    readonly output: string;
    readonly traits: 'equality' | 'order' | 'textual';
  };
  readonly 'mongo/double@1': {
    readonly input: number;
    readonly output: number;
    readonly traits: 'equality' | 'order' | 'numeric';
  };
  readonly 'mongo/int32@1': {
    readonly input: number;
    readonly output: number;
    readonly traits: 'equality' | 'order' | 'numeric';
  };
  readonly 'mongo/bool@1': {
    readonly input: boolean;
    readonly output: boolean;
    readonly traits: 'equality' | 'boolean';
  };
  readonly 'mongo/date@1': {
    readonly input: Date;
    readonly output: Date;
    readonly traits: 'equality' | 'order';
  };
  readonly 'mongo/vector@1': {
    readonly input: readonly number[];
    readonly output: readonly number[];
    readonly traits: 'equality';
  };
  readonly 'mongo/int64@1': {
    readonly input: bigint;
    readonly output: bigint;
    readonly traits: 'equality' | 'order' | 'numeric';
  };
  readonly 'mongo/int64Number@1': {
    readonly input: number;
    readonly output: number;
    readonly traits: 'equality' | 'order' | 'numeric';
  };
  readonly 'mongo/decimal128@1': {
    readonly input: string;
    readonly output: string;
    readonly traits: 'equality' | 'order' | 'numeric';
  };
  readonly 'mongo/binary@1': {
    readonly input: Uint8Array;
    readonly output: Uint8Array;
    readonly traits: 'equality';
  };
  readonly 'mongo/json@1': {
    readonly input: JsonValue;
    readonly output: JsonValue;
    readonly traits: never;
  };
  readonly 'mongo/bson@1': {
    readonly input: BsonInputValue;
    readonly output: BsonValue;
    readonly traits: never;
  };
};
