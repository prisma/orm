import type { EnumMemberCodecFor } from '@internal/contract/enum-accessor';
import { type MutationDefaults, runtimeError } from '@internal/framework-components/runtime';
import type { MongoCodec } from '@internal/mongo-codec';
import type { MongoContract } from '@internal/mongo-contract';

/**
 * Read-only view of the codec registry exposed on `MongoExecutionContext`.
 *
 * Hides `register()` and the iterator from public surface — users do not mutate the per-execution codec registry.
 */
export interface MongoCodecLookup {
  get(id: string): MongoCodec<string> | undefined;
  has(id: string): boolean;
}

/** The codec lookup `buildNamespacedEnums` reads enum members through: each enum's codec in `codecs`, refusing an enum whose codec `codecs` lacks with `RUNTIME.CODEC_DESCRIPTOR_MISSING`. */
export function enumMemberCodecFor(codecs: MongoCodecLookup): EnumMemberCodecFor {
  return (codecId) => {
    const codec = codecs.get(codecId);
    if (codec === undefined) {
      throw runtimeError(
        'RUNTIME.CODEC_DESCRIPTOR_MISSING',
        `No codec is registered for codecId '${codecId}', which a domain enum in the contract uses.`,
        { codecId },
      );
    }
    return codec;
  };
}

/**
 * The context the query lanes build against: the user's contract, a read-only lookup over the codec registry composed from every stack contributor, and `applyMutationDefaults`, which fills the contract's execution defaults from the composed generators. The runtime creates it with `createMongoExecutionContext`.
 *
 * Mirrors SQL's `ExecutionContext`: it holds no runtime concerns such as the adapter or the stack; the runtime receives the adapter as its own option.
 */
export interface MongoExecutionContext<TContract extends MongoContract = MongoContract>
  extends MutationDefaults {
  readonly contract: TContract;
  readonly codecs: MongoCodecLookup;
}
