import type { JsonValue } from '@internal/contract/types';
import type {
  Codec as BaseCodec,
  CodecCallContext,
  CodecTrait,
} from '@internal/framework-components/codec';

export type MongoCodecTrait = CodecTrait;

/**
 * A codec for the Mongo target. Translates between an application value and the BSON-shaped wire form the Mongo driver exchanges, and between an application value and the JSON form stored in contract artifacts.
 *
 * Same shape as the framework codec base — see `Codec` in `@internal/framework-components/codec` for the contract — except that `decode` returns `TOutput`, which defaults to `TInput`, so a codec can read back a narrower type than it accepts on write. Codec-id-keyed static metadata (`traits`, `targetTypes`, `renderOutputType`) lives on the unified {@link import('@internal/framework-components/codec').CodecDescriptor}; Mongo's full migration to descriptor-side registration is tracked under TML-2324.
 */
export interface MongoCodec<
  Id extends string = string,
  TTraits extends readonly MongoCodecTrait[] = readonly MongoCodecTrait[],
  TWire = unknown,
  TInput = unknown,
  TOutput = TInput,
> extends Omit<BaseCodec<Id, TTraits, TWire, TInput>, 'decode'> {
  decode(wire: TWire, ctx: CodecCallContext): Promise<TOutput>;
}

/**
 * Conditional bundle for `encodeJson`/`decodeJson`: when `TInput` is structurally assignable to `JsonValue` the identity defaults are sound and both fields are optional; otherwise both fields are required so an author cannot silently produce a non-JSON-safe contract artifact.
 */
type JsonRoundTripConfig<TInput> = [TInput] extends [JsonValue]
  ? {
      encodeJson?: (value: TInput) => JsonValue;
      decodeJson?: (json: JsonValue) => TInput;
    }
  : {
      encodeJson: (value: TInput) => JsonValue;
      decodeJson: (json: JsonValue) => TInput;
    };

/**
 * Construct a Mongo codec from author functions.
 *
 * Author `encode` and `decode` as sync or async functions; the factory produces a {@link MongoCodec} whose query-time methods follow the boundary contract documented on the framework {@link BaseCodec}. Authors receive a second `ctx` options argument carrying the per-call context; ignore it if you don't need it.
 *
 * Both `encode` and `decode` are required so `TInput` and `TWire` are always covered by an explicit author function — the factory installs no identity fallback. `encodeJson` and `decodeJson` default to identity **only when `TInput` is assignable to `JsonValue`**; otherwise both are required so the contract artifact stays JSON-safe.
 *
 * Codec-id-keyed static metadata (`traits`, `targetTypes`, `renderOutputType`) lives on the unified `CodecDescriptor` rather than on the codec instance itself (TML-2357).
 */
export function mongoCodec<
  Id extends string,
  const TTraits extends readonly MongoCodecTrait[] = readonly [],
  TWire = unknown,
  TInput = unknown,
>(
  config: {
    typeId: Id;
    encode: (value: TInput, ctx: CodecCallContext) => TWire | Promise<TWire>;
    decode: (wire: TWire, ctx: CodecCallContext) => TInput | Promise<TInput>;
  } & JsonRoundTripConfig<TInput>,
): MongoCodec<Id, TTraits, TWire, TInput>;
/**
 * Construct a Mongo codec whose `decode` returns `TOutput`, a type narrower than the `TInput` its `encode` takes. Pass all five type arguments.
 */
export function mongoCodec<
  Id extends string,
  const TTraits extends readonly MongoCodecTrait[],
  TWire,
  TInput,
  TOutput extends TInput,
>(
  config: {
    typeId: Id;
    encode: (value: TInput, ctx: CodecCallContext) => TWire | Promise<TWire>;
    decode: (wire: TWire, ctx: CodecCallContext) => TOutput | Promise<TOutput>;
  } & JsonRoundTripConfig<TInput>,
): MongoCodec<Id, TTraits, TWire, TInput, TOutput>;
export function mongoCodec<
  Id extends string,
  const TTraits extends readonly MongoCodecTrait[],
  TWire,
  TInput,
  TOutput extends TInput,
>(
  config: {
    typeId: Id;
    encode: (value: TInput, ctx: CodecCallContext) => TWire | Promise<TWire>;
    decode: (wire: TWire, ctx: CodecCallContext) => TOutput | Promise<TOutput>;
  } & JsonRoundTripConfig<TInput>,
): MongoCodec<Id, TTraits, TWire, TInput, TOutput> {
  const identity = (v: unknown) => v;
  // The runtime allocates one `CodecCallContext` per `runtime.query()` or `runtime.execute()` call (no caller-supplied `signal` produces `{}` instead of `undefined`) and threads it as a non-optional reference to every codec call. The author surface keeps the second parameter optional so single-arg `(value) => …` authors continue to satisfy the signature via TypeScript's bivariance for trailing parameters.
  const userEncode = config.encode;
  const userDecode = config.decode;
  const widenedConfig = config as {
    encodeJson?: (value: TInput) => JsonValue;
    decodeJson?: (json: JsonValue) => TInput;
  };
  return {
    id: config.typeId,
    encode: (value, ctx) => {
      try {
        return Promise.resolve(userEncode(value, ctx));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    decode: (wire, ctx) => {
      try {
        return Promise.resolve(userDecode(wire, ctx));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    encodeJson: (widenedConfig.encodeJson ?? identity) as (value: TInput) => JsonValue,
    decodeJson: (widenedConfig.decodeJson ?? identity) as (json: JsonValue) => TInput,
  };
}

/** Extract the JS application type a Mongo codec's `encode` takes. `decode` returns the same type unless the codec declares a separate `TOutput`. */
export type MongoCodecInput<T> =
  T extends MongoCodec<string, readonly MongoCodecTrait[], unknown, infer TInput, unknown>
    ? TInput
    : never;
