import type { NamespacedEnums } from '@internal/contract/enum-accessor';
import type { MutationDefaults } from '@internal/framework-components/runtime';
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

/**
 * The context the query lanes build against: the user's contract, a read-only lookup over the codec registry composed from every stack contributor, the contract's enum accessors built once through that lookup, and `applyMutationDefaults`, which fills the contract's execution defaults from the composed generators. The runtime creates it with `createMongoExecutionContext`.
 *
 * Mirrors SQL's `ExecutionContext`: it holds no runtime concerns such as the adapter or the stack; the runtime receives the adapter as its own option.
 */
export interface MongoExecutionContext<TContract extends MongoContract = MongoContract>
  extends MutationDefaults {
  readonly contract: TContract;
  readonly codecs: MongoCodecLookup;
  /** The contract's enum accessors by namespace, built once for this context: what `db.enums` holds and what the ORM checks a written enum value against. */
  readonly enums: NamespacedEnums<TContract>;
}
