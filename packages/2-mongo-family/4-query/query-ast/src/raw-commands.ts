import type { Document } from '@internal/mongo-value';
import { MongoAstNode } from './ast-node';

export class RawAggregateCommand extends MongoAstNode {
  readonly kind = 'rawAggregate' as const;
  readonly collection: string;
  readonly pipeline: ReadonlyArray<Document>;

  constructor(collection: string, pipeline: ReadonlyArray<Document>) {
    super();
    this.collection = collection;
    this.pipeline = pipeline;
    this.freeze();
  }
}

export class RawInsertOneCommand extends MongoAstNode {
  readonly kind = 'rawInsertOne' as const;
  readonly collection: string;
  readonly document: Document;

  constructor(collection: string, document: Document) {
    super();
    this.collection = collection;
    this.document = document;
    this.freeze();
  }
}

export class RawInsertManyCommand extends MongoAstNode {
  readonly kind = 'rawInsertMany' as const;
  readonly collection: string;
  readonly documents: ReadonlyArray<Document>;

  constructor(collection: string, documents: ReadonlyArray<Document>) {
    super();
    this.collection = collection;
    this.documents = documents;
    this.freeze();
  }
}

export class RawUpdateOneCommand extends MongoAstNode {
  readonly kind = 'rawUpdateOne' as const;
  readonly collection: string;
  readonly filter: Document;
  readonly update: Document | ReadonlyArray<Document>;

  constructor(collection: string, filter: Document, update: Document | ReadonlyArray<Document>) {
    super();
    this.collection = collection;
    this.filter = filter;
    this.update = update;
    this.freeze();
  }
}

export interface RawUpdateManyOptions {
  readonly bypassDocumentValidation?: boolean;
}

export class RawUpdateManyCommand extends MongoAstNode {
  readonly kind = 'rawUpdateMany' as const;
  readonly collection: string;
  readonly filter: Document;
  readonly update: Document | ReadonlyArray<Document>;
  declare readonly bypassDocumentValidation?: boolean;

  constructor(
    collection: string,
    filter: Document,
    update: Document | ReadonlyArray<Document>,
    options?: RawUpdateManyOptions,
  ) {
    super();
    this.collection = collection;
    this.filter = filter;
    this.update = update;
    if (options?.bypassDocumentValidation !== undefined)
      this.bypassDocumentValidation = options.bypassDocumentValidation;
    this.freeze();
  }
}

export class RawDeleteOneCommand extends MongoAstNode {
  readonly kind = 'rawDeleteOne' as const;
  readonly collection: string;
  readonly filter: Document;

  constructor(collection: string, filter: Document) {
    super();
    this.collection = collection;
    this.filter = filter;
    this.freeze();
  }
}

export class RawDeleteManyCommand extends MongoAstNode {
  readonly kind = 'rawDeleteMany' as const;
  readonly collection: string;
  readonly filter: Document;

  constructor(collection: string, filter: Document) {
    super();
    this.collection = collection;
    this.filter = filter;
    this.freeze();
  }
}

export class RawFindOneAndUpdateCommand extends MongoAstNode {
  readonly kind = 'rawFindOneAndUpdate' as const;
  readonly collection: string;
  readonly filter: Document;
  readonly update: Document | ReadonlyArray<Document>;
  readonly upsert: boolean;
  readonly sort: Record<string, 1 | -1> | undefined;
  /**
   * When `undefined`, the option is omitted from the wire command and the
   * MongoDB driver applies its documented default (return the pre-image
   * document). Set explicitly to `'before'` or `'after'` to override.
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
    super();
    this.collection = collection;
    this.filter = filter;
    this.update = update;
    this.upsert = upsert;
    this.sort = sort;
    this.returnDocument = returnDocument;
    this.freeze();
  }
}

export class RawFindOneAndDeleteCommand extends MongoAstNode {
  readonly kind = 'rawFindOneAndDelete' as const;
  readonly collection: string;
  readonly filter: Document;
  readonly sort: Record<string, 1 | -1> | undefined;

  constructor(collection: string, filter: Document, sort?: Record<string, 1 | -1>) {
    super();
    this.collection = collection;
    this.filter = filter;
    this.sort = sort;
    this.freeze();
  }
}

export type RawMongoCommand =
  | RawAggregateCommand
  | RawInsertOneCommand
  | RawInsertManyCommand
  | RawUpdateOneCommand
  | RawUpdateManyCommand
  | RawDeleteOneCommand
  | RawDeleteManyCommand
  | RawFindOneAndUpdateCommand
  | RawFindOneAndDeleteCommand;
