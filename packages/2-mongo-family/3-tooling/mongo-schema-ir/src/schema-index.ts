import { freezeNode } from '@internal/framework-components/ir';
import type { MongoIndexKey } from '@internal/mongo-contract';
import type { CollationOptions } from '@internal/mongo-value/mongodb-types';
import { MongoSchemaIRNode } from './schema-node';
import type { MongoSchemaVisitor } from './visitor';

export interface MongoSchemaIndexOptions {
  readonly name: string;
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly unique?: boolean | undefined;
  readonly sparse?: boolean | undefined;
  readonly expireAfterSeconds?: number | undefined;
  readonly partialFilterExpression?: Record<string, unknown> | undefined;
  readonly wildcardProjection?: Record<string, 0 | 1> | undefined;
  readonly collation?: CollationOptions | undefined;
  readonly weights?: Record<string, number> | undefined;
  readonly default_language?: string | undefined;
  readonly language_override?: string | undefined;
}

export class MongoSchemaIndex extends MongoSchemaIRNode {
  readonly nodeKind = 'index' as const;
  /** The index name, which MongoDB keeps unique within a collection. */
  readonly id: string;
  readonly name: string;
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly unique: boolean;
  readonly sparse?: boolean | undefined;
  readonly expireAfterSeconds?: number | undefined;
  readonly partialFilterExpression?: Record<string, unknown> | undefined;
  readonly wildcardProjection?: Record<string, 0 | 1> | undefined;
  readonly collation?: CollationOptions | undefined;
  readonly weights?: Record<string, number> | undefined;
  readonly default_language?: string | undefined;
  readonly language_override?: string | undefined;

  constructor(options: MongoSchemaIndexOptions) {
    super();
    this.id = options.name;
    this.name = options.name;
    this.keys = options.keys;
    this.unique = options.unique ?? false;
    this.sparse = options.sparse;
    this.expireAfterSeconds = options.expireAfterSeconds;
    this.partialFilterExpression = options.partialFilterExpression;
    this.wildcardProjection = options.wildcardProjection;
    this.collation = options.collation;
    this.weights = options.weights;
    this.default_language = options.default_language;
    this.language_override = options.language_override;
    freezeNode(this);
  }

  accept<R>(visitor: MongoSchemaVisitor<R>): R {
    return visitor.index(this);
  }
}
