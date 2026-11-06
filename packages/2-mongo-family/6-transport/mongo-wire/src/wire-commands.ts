import type {
  CollModOptions,
  CreateCollectionOptions as CreateCollectionCommandOptions,
  CreateIndexOptions,
  MongoIndexKeyDirection,
} from '@internal/mongo-query-ast/control';
import type { Document, RawPipeline } from '@internal/mongo-value';
import type {
  CollationOptions,
  CreateCollectionOptions,
  CreateIndexesOptions,
} from '@internal/mongo-value/mongodb-types';

abstract class MongoWireCommand {
  abstract readonly kind: string;
  readonly collection: string;

  protected constructor(collection: string) {
    this.collection = collection;
  }

  protected freeze(): void {
    Object.freeze(this);
  }
}

export class InsertOneWireCommand extends MongoWireCommand {
  readonly kind = 'insertOne' as const;
  readonly document: Document;

  constructor(collection: string, document: Document) {
    super(collection);
    this.document = document;
    this.freeze();
  }
}

export class UpdateOneWireCommand extends MongoWireCommand {
  readonly kind = 'updateOne' as const;
  readonly filter: Document;
  readonly update: Document | ReadonlyArray<Document>;
  readonly upsert: boolean;

  constructor(
    collection: string,
    filter: Document,
    update: Document | ReadonlyArray<Document>,
    upsert = false,
  ) {
    super(collection);
    this.filter = filter;
    this.update = update;
    this.upsert = upsert;
    this.freeze();
  }
}

export class DeleteOneWireCommand extends MongoWireCommand {
  readonly kind = 'deleteOne' as const;
  readonly filter: Document;

  constructor(collection: string, filter: Document) {
    super(collection);
    this.filter = filter;
    this.freeze();
  }
}

export class InsertManyWireCommand extends MongoWireCommand {
  readonly kind = 'insertMany' as const;
  readonly documents: ReadonlyArray<Document>;

  constructor(collection: string, documents: ReadonlyArray<Document>) {
    super(collection);
    this.documents = documents;
    this.freeze();
  }
}

export class UpdateManyWireCommand extends MongoWireCommand {
  readonly kind = 'updateMany' as const;
  readonly filter: Document;
  readonly update: Document | ReadonlyArray<Document>;
  readonly upsert: boolean;
  readonly bypassDocumentValidation: boolean;

  constructor(
    collection: string,
    filter: Document,
    update: Document | ReadonlyArray<Document>,
    upsert = false,
    bypassDocumentValidation = false,
  ) {
    super(collection);
    this.filter = filter;
    this.update = update;
    this.upsert = upsert;
    this.bypassDocumentValidation = bypassDocumentValidation;
    this.freeze();
  }
}

export class DeleteManyWireCommand extends MongoWireCommand {
  readonly kind = 'deleteMany' as const;
  readonly filter: Document;

  constructor(collection: string, filter: Document) {
    super(collection);
    this.filter = filter;
    this.freeze();
  }
}

export class FindOneAndUpdateWireCommand extends MongoWireCommand {
  readonly kind = 'findOneAndUpdate' as const;
  readonly filter: Document;
  readonly update: Document | ReadonlyArray<Document>;
  readonly upsert: boolean;
  readonly sort: Record<string, 1 | -1> | undefined;
  /**
   * When `undefined`, the option is omitted from the underlying driver
   * call so Mongo's documented default (pre-image document) applies.
   */
  readonly returnDocument: 'before' | 'after' | undefined;

  constructor(
    collection: string,
    filter: Document,
    update: Document | ReadonlyArray<Document>,
    upsert = false,
    sort?: Record<string, 1 | -1>,
    returnDocument?: 'before' | 'after',
  ) {
    super(collection);
    this.filter = filter;
    this.update = update;
    this.upsert = upsert;
    this.sort = sort;
    this.returnDocument = returnDocument;
    this.freeze();
  }
}

export class FindOneAndDeleteWireCommand extends MongoWireCommand {
  readonly kind = 'findOneAndDelete' as const;
  readonly filter: Document;
  readonly sort: Record<string, 1 | -1> | undefined;

  constructor(collection: string, filter: Document, sort?: Record<string, 1 | -1>) {
    super(collection);
    this.filter = filter;
    this.sort = sort;
    this.freeze();
  }
}

export class AggregateWireCommand extends MongoWireCommand {
  readonly kind = 'aggregate' as const;
  readonly pipeline: RawPipeline;

  constructor(collection: string, pipeline: RawPipeline) {
    super(collection);
    this.pipeline = pipeline;
    this.freeze();
  }
}

export class CreateCollectionWireCommand
  extends MongoWireCommand
  implements CreateCollectionOptions
{
  readonly kind = 'createCollection' as const;
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

  constructor(collection: string, options: CreateCollectionCommandOptions) {
    super(collection);
    if (options.validator !== undefined) this.validator = options.validator;
    if (options.validationLevel !== undefined) this.validationLevel = options.validationLevel;
    if (options.validationAction !== undefined) this.validationAction = options.validationAction;
    if (options.capped !== undefined) this.capped = options.capped;
    if (options.size !== undefined) this.size = options.size;
    if (options.max !== undefined) this.max = options.max;
    if (options.timeseries !== undefined) this.timeseries = options.timeseries;
    if (options.collation !== undefined) this.collation = options.collation;
    if (options.changeStreamPreAndPostImages !== undefined)
      this.changeStreamPreAndPostImages = options.changeStreamPreAndPostImages;
    if (options.clusteredIndex !== undefined) this.clusteredIndex = options.clusteredIndex;
    this.freeze();
  }
}

export class CreateIndexWireCommand extends MongoWireCommand implements CreateIndexesOptions {
  readonly kind = 'createIndex' as const;
  readonly key: Record<string, MongoIndexKeyDirection>;
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
    key: Record<string, MongoIndexKeyDirection>,
    options: CreateIndexOptions,
  ) {
    super(collection);
    this.key = key;
    if (options.unique !== undefined) this.unique = options.unique;
    if (options.sparse !== undefined) this.sparse = options.sparse;
    if (options.expireAfterSeconds !== undefined)
      this.expireAfterSeconds = options.expireAfterSeconds;
    if (options.partialFilterExpression !== undefined)
      this.partialFilterExpression = options.partialFilterExpression;
    if (options.name !== undefined) this.name = options.name;
    if (options.wildcardProjection !== undefined)
      this.wildcardProjection = options.wildcardProjection;
    if (options.collation !== undefined) this.collation = options.collation;
    if (options.weights !== undefined) this.weights = options.weights;
    if (options.default_language !== undefined) this.default_language = options.default_language;
    if (options.language_override !== undefined) this.language_override = options.language_override;
    this.freeze();
  }
}

export class DropCollectionWireCommand extends MongoWireCommand {
  readonly kind = 'dropCollection' as const;

  constructor(collection: string) {
    super(collection);
    this.freeze();
  }
}

export class RenameCollectionWireCommand extends MongoWireCommand {
  readonly kind = 'renameCollection' as const;
  readonly to: string;

  constructor(collection: string, to: string) {
    super(collection);
    this.to = to;
    this.freeze();
  }
}

export class DropIndexWireCommand extends MongoWireCommand {
  readonly kind = 'dropIndex' as const;
  readonly name: string;

  constructor(collection: string, name: string) {
    super(collection);
    this.name = name;
    this.freeze();
  }
}

export class CollModWireCommand extends MongoWireCommand {
  readonly kind = 'collMod' as const;
  declare readonly validator?: Record<string, unknown>;
  declare readonly validationLevel?: 'strict' | 'moderate';
  declare readonly validationAction?: 'error' | 'warn';
  declare readonly changeStreamPreAndPostImages?: { enabled: boolean };

  constructor(collection: string, options: CollModOptions) {
    super(collection);
    if (options.validator !== undefined) this.validator = options.validator;
    if (options.validationLevel !== undefined) this.validationLevel = options.validationLevel;
    if (options.validationAction !== undefined) this.validationAction = options.validationAction;
    if (options.changeStreamPreAndPostImages !== undefined)
      this.changeStreamPreAndPostImages = options.changeStreamPreAndPostImages;
    this.freeze();
  }
}

export type AnyMongoDmlWireCommand =
  | InsertOneWireCommand
  | InsertManyWireCommand
  | UpdateOneWireCommand
  | UpdateManyWireCommand
  | DeleteOneWireCommand
  | DeleteManyWireCommand
  | FindOneAndUpdateWireCommand
  | FindOneAndDeleteWireCommand
  | AggregateWireCommand;

export type AnyMongoDdlWireCommand =
  | CreateCollectionWireCommand
  | CreateIndexWireCommand
  | DropCollectionWireCommand
  | RenameCollectionWireCommand
  | DropIndexWireCommand
  | CollModWireCommand;

export type AnyMongoWireCommand = AnyMongoDmlWireCommand | AnyMongoDdlWireCommand;

const DDL_KINDS: ReadonlySet<string> = new Set([
  'createCollection',
  'createIndex',
  'dropCollection',
  'renameCollection',
  'dropIndex',
  'collMod',
]);

export function isDdlWireCommand(cmd: AnyMongoWireCommand): cmd is AnyMongoDdlWireCommand {
  return DDL_KINDS.has(cmd.kind);
}
