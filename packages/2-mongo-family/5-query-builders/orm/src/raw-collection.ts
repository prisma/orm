import type { PlanMeta } from '@internal/contract/types';
import type { MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import {
  RawAggregateCommand,
  RawDeleteManyCommand,
  RawDeleteOneCommand,
  RawFindOneAndDeleteCommand,
  RawFindOneAndUpdateCommand,
  RawInsertManyCommand,
  RawInsertOneCommand,
  RawUpdateManyCommand,
  RawUpdateOneCommand,
} from '@internal/mongo-query-ast/execution';
import type { Document } from '@internal/mongo-value';

interface Buildable<Row, Command extends MongoQueryPlan['command']> {
  build(): MongoQueryPlan<Row, Command>;
}

export interface RawMongoCollection {
  aggregate<Row = Record<string, unknown>>(
    pipeline: ReadonlyArray<Document>,
  ): Buildable<Row, RawAggregateCommand>;

  insertOne(document: Document): Buildable<unknown, RawInsertOneCommand>;
  insertMany(documents: ReadonlyArray<Document>): Buildable<unknown, RawInsertManyCommand>;

  updateOne(
    filter: Document,
    update: Document | ReadonlyArray<Document>,
  ): Buildable<unknown, RawUpdateOneCommand>;

  updateMany(
    filter: Document,
    update: Document | ReadonlyArray<Document>,
  ): Buildable<unknown, RawUpdateManyCommand>;

  deleteOne(filter: Document): Buildable<unknown, RawDeleteOneCommand>;
  deleteMany(filter: Document): Buildable<unknown, RawDeleteManyCommand>;

  findOneAndUpdate(
    filter: Document,
    update: Document | ReadonlyArray<Document>,
    options?: { upsert?: boolean },
  ): Buildable<unknown, RawFindOneAndUpdateCommand>;

  findOneAndDelete(filter: Document): Buildable<unknown, RawFindOneAndDeleteCommand>;
}

export function createRawMongoCollection(
  collectionName: string,
  meta: PlanMeta,
): RawMongoCollection {
  function buildable<Row, Command extends MongoQueryPlan['command']>(
    command: Command,
  ): Buildable<Row, Command> {
    return {
      build: () => ({ collection: collectionName, command, meta }),
    };
  }

  return {
    aggregate<Row = Record<string, unknown>>(pipeline: ReadonlyArray<Document>) {
      return buildable<Row, RawAggregateCommand>(new RawAggregateCommand(collectionName, pipeline));
    },

    insertOne(document: Document) {
      return buildable(new RawInsertOneCommand(collectionName, document));
    },

    insertMany(documents: ReadonlyArray<Document>) {
      return buildable(new RawInsertManyCommand(collectionName, documents));
    },

    updateOne(filter: Document, update: Document | ReadonlyArray<Document>) {
      return buildable(new RawUpdateOneCommand(collectionName, filter, update));
    },

    updateMany(filter: Document, update: Document | ReadonlyArray<Document>) {
      return buildable(new RawUpdateManyCommand(collectionName, filter, update));
    },

    deleteOne(filter: Document) {
      return buildable(new RawDeleteOneCommand(collectionName, filter));
    },

    deleteMany(filter: Document) {
      return buildable(new RawDeleteManyCommand(collectionName, filter));
    },

    findOneAndUpdate(
      filter: Document,
      update: Document | ReadonlyArray<Document>,
      options?: { upsert?: boolean },
    ) {
      return buildable(
        new RawFindOneAndUpdateCommand(collectionName, filter, update, options?.upsert ?? false),
      );
    },

    findOneAndDelete(filter: Document) {
      return buildable(new RawFindOneAndDeleteCommand(collectionName, filter));
    },
  };
}
