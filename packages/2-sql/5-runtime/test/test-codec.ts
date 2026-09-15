/**
 * Test-only helper that constructs a SQL-family `Codec` instance from author-side encode/decode functions. Replaces the legacy public `mkCodec()` factory (deleted under TML-2357); tests that need a stub codec for behavioural assertions instantiate one through this helper rather than going through `descriptor.factory(...)`.
 *
 * The body is identical in spirit to the retired `mkCodec`: promise-lift encoding and preserve synchronous decoding, default `encodeJson`/`decodeJson` to identity when `TInput` is JSON-safe, fail loudly otherwise.
 */
import type { JsonValue } from '@internal/contract/types';
import type { CodecTrait } from '@internal/framework-components/codec';
import type { Codec, SqlCodecCallContext } from '@internal/sql-relational-core/ast';

type JsonRoundTripConfig<TInput> = [TInput] extends [JsonValue]
  ? {
      encodeJson?: (value: TInput) => JsonValue;
      decodeJson?: (json: JsonValue) => TInput;
    }
  : {
      encodeJson: (value: TInput) => JsonValue;
      decodeJson: (json: JsonValue) => TInput;
    };

export function defineTestCodec<
  Id extends string,
  const TTraits extends readonly CodecTrait[] = readonly [],
  TWire = unknown,
  TInput = unknown,
>(
  config: {
    typeId: Id;
    targetTypes?: readonly string[];
    encode: (value: TInput, ctx: SqlCodecCallContext) => TWire | Promise<TWire>;
    decode: (wire: TWire, ctx: SqlCodecCallContext) => TInput;
    traits?: TTraits;
  } & JsonRoundTripConfig<TInput>,
): Codec<Id, TTraits, TWire, TInput> {
  const identity = (v: unknown) => v;
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
    decode: userDecode,
    encodeJson: (widenedConfig.encodeJson ?? identity) as (value: TInput) => JsonValue,
    decodeJson: (widenedConfig.decodeJson ?? identity) as (json: JsonValue) => TInput,
  } as Codec<Id, TTraits, TWire, TInput>;
}
