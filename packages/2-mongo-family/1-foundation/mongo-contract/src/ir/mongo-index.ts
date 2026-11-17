import { freezeNode, IRNodeBase } from '@internal/framework-components/ir';
import type { CollationOptions } from '@internal/mongo-value/mongodb-types';
import type { MongoIndexKey } from '../contract-types';

/**
 * Hydration / construction input shape for {@link MongoIndex}. Mirrors
 * the on-disk storage JSON envelope exactly so the family-base
 * serializer's hydration walker can hand an arktype-validated literal
 * straight to `new`.
 */
export interface MongoIndexInput {
  readonly name: string;
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly unique?: boolean;
  readonly sparse?: boolean;
  readonly expireAfterSeconds?: number;
  readonly partialFilterExpression?: Record<string, unknown>;
  readonly wildcardProjection?: Record<string, 0 | 1>;
  readonly collation?: CollationOptions;
  readonly weights?: Record<string, number>;
  readonly default_language?: string;
  readonly language_override?: string;
}

/**
 * Mongo Contract IR node for a single collection index entry (one
 * element of `MongoCollection.indexes`). Lifted from the
 * pre-M2R2 `MongoStorageIndex` storage interface to a class extending
 * `IRNodeBase` per FR18.
 *
 * Single concrete family-layer class (no target subclass). The spec's
 * `MongoTargetIndex extends MongoIndex` pattern remains additive — a
 * future Mongo target with target-specific index extensions is free to
 * subclass; for the single Mongo target shipped today a concrete
 * family-layer class is enough and avoids a target-import layering
 * violation from the contract-ts builder.
 */
export class MongoIndex extends IRNodeBase {
  readonly kind = 'mongo-index' as const;
  /** The name MongoDB stores the index under. */
  readonly name: string;
  readonly keys: ReadonlyArray<MongoIndexKey>;
  declare readonly unique?: boolean;
  declare readonly sparse?: boolean;
  declare readonly expireAfterSeconds?: number;
  declare readonly partialFilterExpression?: Record<string, unknown>;
  declare readonly wildcardProjection?: Record<string, 0 | 1>;
  declare readonly collation?: CollationOptions;
  declare readonly weights?: Record<string, number>;
  declare readonly default_language?: string;
  declare readonly language_override?: string;

  constructor(input: MongoIndexInput) {
    super();
    this.name = input.name;
    this.keys = input.keys;
    if (input.unique !== undefined) this.unique = input.unique;
    if (input.sparse !== undefined) this.sparse = input.sparse;
    if (input.expireAfterSeconds !== undefined) this.expireAfterSeconds = input.expireAfterSeconds;
    if (input.partialFilterExpression !== undefined)
      this.partialFilterExpression = input.partialFilterExpression;
    if (input.wildcardProjection !== undefined) this.wildcardProjection = input.wildcardProjection;
    if (input.collation !== undefined) this.collation = input.collation;
    if (input.weights !== undefined) this.weights = input.weights;
    if (input.default_language !== undefined) this.default_language = input.default_language;
    if (input.language_override !== undefined) this.language_override = input.language_override;
    freezeNode(this);
  }
}
