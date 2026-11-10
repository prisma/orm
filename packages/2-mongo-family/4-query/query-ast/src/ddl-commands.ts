import type { MongoIndexKey } from '@internal/mongo-contract';
import type {
  CollationOptions,
  CreateIndexesOptions,
  CreateCollectionOptions as MongoCreateCollectionOptions,
} from '@internal/mongo-value/mongodb-types';
import { MongoAstNode } from './ast-node';
import type { MongoDdlCommandVisitor } from './ddl-visitors';

export interface CreateIndexOptions {
  readonly unique?: boolean;
  readonly sparse?: boolean;
  readonly expireAfterSeconds?: number;
  readonly partialFilterExpression?: Record<string, unknown>;
  readonly name?: string;
  readonly wildcardProjection?: Record<string, 0 | 1>;
  readonly collation?: CollationOptions;
  readonly weights?: Record<string, number>;
  readonly default_language?: string;
  readonly language_override?: string;
}

export class CreateIndexCommand extends MongoAstNode implements CreateIndexesOptions {
  readonly kind = 'createIndex' as const;
  readonly collection: string;
  readonly keys: ReadonlyArray<MongoIndexKey>;
  declare readonly unique?: boolean;
  declare readonly sparse?: boolean;
  declare readonly expireAfterSeconds?: number;
  declare readonly partialFilterExpression?: Record<string, unknown>;
  declare readonly name?: string;
  declare readonly wildcardProjection?: Record<string, 0 | 1>;
  declare readonly collation?: CollationOptions;
  declare readonly weights?: Record<string, number>;
  declare readonly default_language?: string;
  declare readonly language_override?: string;

  constructor(
    collection: string,
    keys: ReadonlyArray<MongoIndexKey>,
    options?: CreateIndexOptions,
  ) {
    super();
    this.collection = collection;
    this.keys = keys;
    if (options?.unique !== undefined) this.unique = options.unique;
    if (options?.sparse !== undefined) this.sparse = options.sparse;
    if (options?.expireAfterSeconds !== undefined)
      this.expireAfterSeconds = options.expireAfterSeconds;
    if (options?.partialFilterExpression !== undefined)
      this.partialFilterExpression = options.partialFilterExpression;
    if (options?.name !== undefined) this.name = options.name;
    if (options?.wildcardProjection !== undefined)
      this.wildcardProjection = options.wildcardProjection;
    if (options?.collation !== undefined) this.collation = options.collation;
    if (options?.weights !== undefined) this.weights = options.weights;
    if (options?.default_language !== undefined) this.default_language = options.default_language;
    if (options?.language_override !== undefined)
      this.language_override = options.language_override;
    this.freeze();
  }

  accept<R>(visitor: MongoDdlCommandVisitor<R>): R {
    return visitor.createIndex(this);
  }
}

export class DropIndexCommand extends MongoAstNode {
  readonly kind = 'dropIndex' as const;
  readonly collection: string;
  readonly name: string;

  constructor(collection: string, name: string) {
    super();
    this.collection = collection;
    this.name = name;
    this.freeze();
  }

  accept<R>(visitor: MongoDdlCommandVisitor<R>): R {
    return visitor.dropIndex(this);
  }
}

export interface CreateCollectionOptions {
  readonly validator?: Record<string, unknown>;
  readonly validationLevel?: 'strict' | 'moderate';
  readonly validationAction?: 'error' | 'warn';
  readonly capped?: boolean;
  readonly size?: number;
  readonly max?: number;
  readonly timeseries?: {
    timeField: string;
    metaField?: string;
    granularity?: 'seconds' | 'minutes' | 'hours';
  };
  readonly collation?: CollationOptions;
  readonly changeStreamPreAndPostImages?: { enabled: boolean };
  readonly clusteredIndex?: {
    key: Record<string, number>;
    unique: boolean;
    name?: string;
  };
}

export class CreateCollectionCommand extends MongoAstNode implements MongoCreateCollectionOptions {
  readonly kind = 'createCollection' as const;
  readonly collection: string;
  declare readonly validator?: Record<string, unknown>;
  declare readonly validationLevel?: 'strict' | 'moderate';
  declare readonly validationAction?: 'error' | 'warn';
  declare readonly capped?: boolean;
  declare readonly size?: number;
  declare readonly max?: number;
  declare readonly timeseries?: {
    timeField: string;
    metaField?: string;
    granularity?: 'seconds' | 'minutes' | 'hours';
  };
  declare readonly collation?: CollationOptions;
  declare readonly changeStreamPreAndPostImages?: { enabled: boolean };
  declare readonly clusteredIndex?: {
    key: Record<string, number>;
    unique: boolean;
    name?: string;
  };

  constructor(collection: string, options?: CreateCollectionOptions) {
    super();
    this.collection = collection;
    if (options?.validator !== undefined) this.validator = options.validator;
    if (options?.validationLevel !== undefined) this.validationLevel = options.validationLevel;
    if (options?.validationAction !== undefined) this.validationAction = options.validationAction;
    if (options?.capped !== undefined) this.capped = options.capped;
    if (options?.size !== undefined) this.size = options.size;
    if (options?.max !== undefined) this.max = options.max;
    if (options?.timeseries !== undefined) this.timeseries = options.timeseries;
    if (options?.collation !== undefined) this.collation = options.collation;
    if (options?.changeStreamPreAndPostImages !== undefined)
      this.changeStreamPreAndPostImages = options.changeStreamPreAndPostImages;
    if (options?.clusteredIndex !== undefined) this.clusteredIndex = options.clusteredIndex;
    this.freeze();
  }

  accept<R>(visitor: MongoDdlCommandVisitor<R>): R {
    return visitor.createCollection(this);
  }
}

export class DropCollectionCommand extends MongoAstNode {
  readonly kind = 'dropCollection' as const;
  readonly collection: string;

  constructor(collection: string) {
    super();
    this.collection = collection;
    this.freeze();
  }

  accept<R>(visitor: MongoDdlCommandVisitor<R>): R {
    return visitor.dropCollection(this);
  }
}

export class RenameCollectionCommand extends MongoAstNode {
  readonly kind = 'renameCollection' as const;
  readonly collection: string;
  readonly to: string;

  constructor(collection: string, to: string) {
    super();
    this.collection = collection;
    this.to = to;
    this.freeze();
  }

  accept<R>(visitor: MongoDdlCommandVisitor<R>): R {
    return visitor.renameCollection(this);
  }
}

export interface CollModOptions {
  readonly validator?: Record<string, unknown>;
  readonly validationLevel?: 'strict' | 'moderate';
  readonly validationAction?: 'error' | 'warn';
  readonly changeStreamPreAndPostImages?: { enabled: boolean };
}

export class CollModCommand extends MongoAstNode {
  readonly kind = 'collMod' as const;
  readonly collection: string;
  declare readonly validator?: Record<string, unknown>;
  declare readonly validationLevel?: 'strict' | 'moderate';
  declare readonly validationAction?: 'error' | 'warn';
  declare readonly changeStreamPreAndPostImages?: { enabled: boolean };

  constructor(collection: string, options: CollModOptions) {
    super();
    this.collection = collection;
    if (options.validator !== undefined) this.validator = options.validator;
    if (options.validationLevel !== undefined) this.validationLevel = options.validationLevel;
    if (options.validationAction !== undefined) this.validationAction = options.validationAction;
    if (options.changeStreamPreAndPostImages !== undefined)
      this.changeStreamPreAndPostImages = options.changeStreamPreAndPostImages;
    this.freeze();
  }

  accept<R>(visitor: MongoDdlCommandVisitor<R>): R {
    return visitor.collMod(this);
  }
}

export type AnyMongoDdlCommand =
  | CreateIndexCommand
  | DropIndexCommand
  | CreateCollectionCommand
  | DropCollectionCommand
  | RenameCollectionCommand
  | CollModCommand;
