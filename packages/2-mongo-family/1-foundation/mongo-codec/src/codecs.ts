import type { JsonValue } from '@internal/contract/types';
import type {
  Codec as BaseCodec,
  CodecCallContext,
  CodecTrait,
  DataType,
  DataTypeParams,
  DataTypeValue,
} from '@internal/framework-components/codec';
import { dataTypeValueFor } from '@internal/framework-components/codec';
import { blindCast } from '@internal/utils/casts';

export type MongoCodecTrait = CodecTrait;

/**
 * A codec for the Mongo target. Converts a value of its data type to the application value, and the application value to and from the BSON-shaped wire form the Mongo driver exchanges.
 *
 * Same shape as the framework codec base — see `Codec` in `@internal/framework-components/codec` for the contract — except that `fromWire` returns `TOutput`, which defaults to `TInput`, so a codec can read back a narrower type than it accepts on write. Codec-id-keyed static metadata (`traits`, `renderOutputType`) lives on the unified {@link import('@internal/framework-components/codec').CodecDescriptor}; Mongo's full migration to descriptor-side registration is tracked under TML-2324.
 */
export interface MongoCodec<
  Id extends string = string,
  TTraits extends readonly MongoCodecTrait[] = readonly MongoCodecTrait[],
  TWire = unknown,
  TInput = unknown,
  TOutput = TInput,
> extends Omit<BaseCodec<Id, TTraits, TWire, TInput>, 'fromWire'> {
  fromWire(wire: TWire, ctx: CodecCallContext): Promise<TOutput>;
}

/**
 * The author functions for a codec's values. `toDataTypeValue` returns the JSON of the value, and the factory constructs the value through the codec's data type with its parameters; `fromDataTypeValue` receives a value the data type has read. Returning the value's JSON unchanged is sound whenever `TInput` is a JSON type, and returning a value's JSON as the application value is sound only when `TInput` is exactly `JsonValue`. So both are optional for `JsonValue`, `fromDataTypeValue` is required for a narrower JSON type such as `string`, and both are required for a type that is not JSON.
 */
type DataTypeValueConfig<TInput> = [TInput] extends [JsonValue]
  ? [JsonValue] extends [TInput]
    ? {
        toDataTypeValue?(value: TInput): JsonValue;
        fromDataTypeValue?(value: DataTypeValue): TInput;
      }
    : {
        toDataTypeValue?(value: TInput): JsonValue;
        fromDataTypeValue(value: DataTypeValue): TInput;
      }
  : {
      toDataTypeValue(value: TInput): JsonValue;
      fromDataTypeValue(value: DataTypeValue): TInput;
    };

interface MongoCodecConfig<Id extends string, TWire, TInput, TOutput> {
  typeId: Id;
  /** The data type whose values the codec converts. */
  dataType: DataType;
  /** The column's parameters of `dataType`; none when omitted. */
  params?: DataTypeParams;
  toWire: (value: TInput, ctx: CodecCallContext) => TWire | Promise<TWire>;
  fromWire: (wire: TWire, ctx: CodecCallContext) => TOutput | Promise<TOutput>;
}

/**
 * Construct a Mongo codec from author functions.
 *
 * Author `toWire` and `fromWire` as sync or async functions; the factory produces a {@link MongoCodec} whose wire methods follow the boundary contract documented on the framework {@link BaseCodec}. Authors receive a second `ctx` options argument carrying the per-call context; ignore it if you don't need it.
 *
 * Both wire functions are required so `TInput` and `TWire` are always covered by an explicit author function. The value functions follow {@link DataTypeValueConfig}.
 *
 * Codec-id-keyed static metadata (`traits`, `renderOutputType`) lives on the unified `CodecDescriptor` rather than on the codec instance itself (TML-2357).
 */
export function mongoCodec<
  Id extends string,
  const TTraits extends readonly MongoCodecTrait[] = readonly [],
  TWire = unknown,
  TInput = unknown,
>(
  config: MongoCodecConfig<Id, TWire, TInput, TInput> & DataTypeValueConfig<TInput>,
): MongoCodec<Id, TTraits, TWire, TInput>;
/**
 * Construct a Mongo codec whose `fromWire` returns `TOutput`, a type narrower than the `TInput` its `toWire` takes. Pass all five type arguments.
 */
export function mongoCodec<
  Id extends string,
  const TTraits extends readonly MongoCodecTrait[],
  TWire,
  TInput,
  TOutput extends TInput,
>(
  config: MongoCodecConfig<Id, TWire, TInput, TOutput> & DataTypeValueConfig<TInput>,
): MongoCodec<Id, TTraits, TWire, TInput, TOutput>;
export function mongoCodec<
  Id extends string,
  const TTraits extends readonly MongoCodecTrait[],
  TWire,
  TInput,
  TOutput extends TInput,
>(
  config: MongoCodecConfig<Id, TWire, TInput, TOutput> & DataTypeValueConfig<TInput>,
): MongoCodec<Id, TTraits, TWire, TInput, TOutput> {
  // The runtime allocates one `CodecCallContext` per `runtime.query()` or `runtime.execute()` call (no caller-supplied `signal` produces `{}` instead of `undefined`) and threads it as a non-optional reference to every codec call. The author surface keeps the second parameter optional so single-arg `(value) => …` authors continue to satisfy the signature via TypeScript's bivariance for trailing parameters.
  const { dataType, toWire, fromWire } = config;
  const params = config.params ?? {};
  const values: {
    toDataTypeValue?(value: TInput): JsonValue;
    fromDataTypeValue?(value: DataTypeValue): TInput;
  } = config;
  const toJson =
    values.toDataTypeValue ??
    ((value: TInput) =>
      blindCast<
        JsonValue,
        'DataTypeValueConfig makes this optional only when TInput is a JSON type'
      >(value));
  const fromValue =
    values.fromDataTypeValue ??
    ((value: DataTypeValue) =>
      blindCast<TInput, 'DataTypeValueConfig makes this optional only when TInput is JsonValue'>(
        value.value,
      ));
  return {
    id: config.typeId,
    dataType,
    toWire: (value, ctx) => {
      try {
        return Promise.resolve(toWire(value, ctx));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    fromWire: (wire, ctx) => {
      try {
        return Promise.resolve(fromWire(wire, ctx));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    toDataTypeValue: (value) => dataTypeValueFor(dataType, params, toJson(value)),
    fromDataTypeValue: fromValue,
  };
}

/** Extract the JS application type a Mongo codec's `toWire` takes. `fromWire` returns the same type unless the codec declares a separate `TOutput`. */
export type MongoCodecInput<T> =
  T extends MongoCodec<string, readonly MongoCodecTrait[], unknown, infer TInput, unknown>
    ? TInput
    : never;
