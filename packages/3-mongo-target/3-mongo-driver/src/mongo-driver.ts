import type { MongoDriver } from '@internal/mongo-lowering';
import type {
  AggregateWireCommand,
  AnyMongoDdlWireCommand,
  AnyMongoDmlWireCommand,
  CollModWireCommand,
  CreateCollectionWireCommand,
  CreateIndexWireCommand,
  DeleteManyResult,
  DeleteManyWireCommand,
  DeleteOneResult,
  DeleteOneWireCommand,
  DropCollectionWireCommand,
  DropIndexWireCommand,
  FindOneAndDeleteWireCommand,
  FindOneAndUpdateWireCommand,
  InsertManyResult,
  InsertManyWireCommand,
  InsertOneResult,
  InsertOneWireCommand,
  UpdateManyResult,
  UpdateManyWireCommand,
  UpdateOneResult,
  UpdateOneWireCommand,
} from '@internal/mongo-wire';
import { assertNever } from '@internal/utils/internal-error';
import { BSON, type Db, type Document, MongoClient } from 'mongodb';
import { DRIVER_INFO } from './core/driver-info';

/* v8 ignore start */
function unreachableKind(value: never): string {
  const candidate: unknown = value;
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    'kind' in candidate &&
    typeof candidate.kind === 'string'
  ) {
    return candidate.kind;
  }
  return 'unknown';
}
/* v8 ignore stop */

export class MongoDriverImpl implements MongoDriver {
  protected readonly db: Db;
  protected readonly client: MongoClient | undefined;

  protected constructor(db: Db, client: MongoClient | undefined) {
    this.db = db;
    this.client = client;
  }

  static async fromConnection(uri: string, dbName: string): Promise<MongoDriverImpl> {
    const client = new MongoClient(uri, { driverInfo: DRIVER_INFO });
    await client.connect();
    return new MongoDriverImpl(client.db(dbName), client);
  }

  static fromDb(db: Db): MongoDriverImpl {
    return new MongoDriverImpl(db, undefined);
  }

  execute<Row = Record<string, unknown>>(wireCommand: AnyMongoDmlWireCommand): AsyncIterable<Row> {
    switch (wireCommand.kind) {
      case 'insertOne':
        return this.executeInsertOneCommand(wireCommand) as AsyncIterable<Row>;
      case 'updateOne':
        return this.executeUpdateOneCommand(wireCommand) as AsyncIterable<Row>;
      case 'insertMany':
        return this.executeInsertManyCommand(wireCommand) as AsyncIterable<Row>;
      case 'updateMany':
        return this.executeUpdateManyCommand(wireCommand) as AsyncIterable<Row>;
      case 'deleteOne':
        return this.executeDeleteOneCommand(wireCommand) as AsyncIterable<Row>;
      case 'deleteMany':
        return this.executeDeleteManyCommand(wireCommand) as AsyncIterable<Row>;
      case 'findOneAndUpdate':
        return this.executeFindOneAndUpdateCommand(wireCommand) as AsyncIterable<Row>;
      case 'findOneAndDelete':
        return this.executeFindOneAndDeleteCommand(wireCommand) as AsyncIterable<Row>;
      case 'aggregate':
        return this.executeAggregateCommand<Row>(wireCommand);
      // v8 ignore next 4
      default:
        return assertNever(
          wireCommand,
          `Unknown wire command kind: ${unreachableKind(wireCommand)}`,
        );
    }
  }

  async run(wireCommand: AnyMongoDdlWireCommand): Promise<void> {
    switch (wireCommand.kind) {
      case 'createCollection':
        return this.executeCreateCollectionCommand(wireCommand);
      case 'createIndex':
        return this.executeCreateIndexCommand(wireCommand);
      case 'dropCollection':
        return this.executeDropCollectionCommand(wireCommand);
      case 'dropIndex':
        return this.executeDropIndexCommand(wireCommand);
      case 'collMod':
        return this.executeCollModCommand(wireCommand);
      // v8 ignore next 4
      default:
        return assertNever(
          wireCommand,
          `Unknown DDL wire command kind: ${unreachableKind(wireCommand)}`,
        );
    }
  }

  async close(): Promise<void> {
    await this.client?.close();
  }

  protected async *executeInsertOneCommand(
    cmd: InsertOneWireCommand,
  ): AsyncIterable<InsertOneResult> {
    const collection = this.db.collection(cmd.collection);
    const result = await collection.insertOne(cmd.document);
    yield {
      insertedId: result.insertedId,
      document: this.asRead({ _id: result.insertedId, ...cmd.document }),
    };
  }

  /**
   * The server stores an inserted document as the driver wrote it, apart from moving `_id` first, so writing it to BSON and reading it back with the client's options gives what a read returns, without a query.
   */
  protected asRead(document: Document): Document {
    const { raw: _raw, ...options } = this.db.bsonOptions;
    return BSON.deserialize(BSON.serialize(document, options), options);
  }

  protected async *executeUpdateOneCommand(
    cmd: UpdateOneWireCommand,
  ): AsyncIterable<UpdateOneResult> {
    const collection = this.db.collection(cmd.collection);
    const result = await collection.updateOne(cmd.filter, cmd.update, { upsert: cmd.upsert });
    yield {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedCount: result.upsertedCount,
      upsertedId: result.upsertedId ?? undefined,
    };
  }

  protected async *executeInsertManyCommand(
    cmd: InsertManyWireCommand,
  ): AsyncIterable<InsertManyResult> {
    const collection = this.db.collection(cmd.collection);
    const result = await collection.insertMany(cmd.documents as Record<string, unknown>[]);
    const insertedIds = Object.values(result.insertedIds);
    yield {
      insertedIds,
      insertedCount: result.insertedCount,
      documents: cmd.documents.map((document, index) =>
        this.asRead({ _id: insertedIds[index], ...document }),
      ),
    };
  }

  protected async *executeUpdateManyCommand(
    cmd: UpdateManyWireCommand,
  ): AsyncIterable<UpdateManyResult> {
    const collection = this.db.collection(cmd.collection);
    const result = await collection.updateMany(cmd.filter, cmd.update, { upsert: cmd.upsert });
    yield {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedCount: result.upsertedCount,
      upsertedId: result.upsertedId ?? undefined,
    };
  }

  protected async *executeDeleteOneCommand(
    cmd: DeleteOneWireCommand,
  ): AsyncIterable<DeleteOneResult> {
    const collection = this.db.collection(cmd.collection);
    const result = await collection.deleteOne(cmd.filter);
    yield { deletedCount: result.deletedCount };
  }

  protected async *executeDeleteManyCommand(
    cmd: DeleteManyWireCommand,
  ): AsyncIterable<DeleteManyResult> {
    const collection = this.db.collection(cmd.collection);
    const result = await collection.deleteMany(cmd.filter);
    yield { deletedCount: result.deletedCount };
  }

  protected async *executeFindOneAndUpdateCommand(
    cmd: FindOneAndUpdateWireCommand,
  ): AsyncIterable<Record<string, unknown>> {
    const collection = this.db.collection(cmd.collection);
    const result = await collection.findOneAndUpdate(cmd.filter, cmd.update, {
      upsert: cmd.upsert,
      ...(cmd.returnDocument != null ? { returnDocument: cmd.returnDocument } : {}),
      ...(cmd.sort != null ? { sort: cmd.sort } : {}),
    });
    if (result) {
      yield result as Record<string, unknown>;
    }
  }

  protected async *executeFindOneAndDeleteCommand(
    cmd: FindOneAndDeleteWireCommand,
  ): AsyncIterable<Record<string, unknown>> {
    const collection = this.db.collection(cmd.collection);
    const result = await collection.findOneAndDelete(cmd.filter, {
      ...(cmd.sort != null ? { sort: cmd.sort } : {}),
    });
    if (result) {
      yield result as Record<string, unknown>;
    }
  }

  protected async *executeAggregateCommand<Row>(cmd: AggregateWireCommand): AsyncIterable<Row> {
    const collection = this.db.collection(cmd.collection);
    const cursor = collection.aggregate(cmd.pipeline as Record<string, unknown>[]);
    yield* cursor as AsyncIterable<Row>;
  }

  protected async executeCreateCollectionCommand(cmd: CreateCollectionWireCommand): Promise<void> {
    const {
      validator,
      validationLevel,
      validationAction,
      capped,
      size,
      max,
      timeseries,
      collation,
      changeStreamPreAndPostImages,
      clusteredIndex,
    } = cmd;
    await this.db.createCollection(cmd.collection, {
      ...(validator !== undefined ? { validator } : {}),
      ...(validationLevel !== undefined ? { validationLevel } : {}),
      ...(validationAction !== undefined ? { validationAction } : {}),
      ...(capped !== undefined ? { capped } : {}),
      ...(size !== undefined ? { size } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(timeseries !== undefined ? { timeseries } : {}),
      ...(collation !== undefined ? { collation } : {}),
      ...(changeStreamPreAndPostImages !== undefined ? { changeStreamPreAndPostImages } : {}),
      ...(clusteredIndex !== undefined ? { clusteredIndex } : {}),
    });
  }

  protected async executeCreateIndexCommand(cmd: CreateIndexWireCommand): Promise<void> {
    const {
      unique,
      sparse,
      expireAfterSeconds,
      partialFilterExpression,
      name,
      wildcardProjection,
      collation,
      weights,
      default_language,
      language_override,
    } = cmd;
    await this.db.collection(cmd.collection).createIndex(cmd.key, {
      ...(unique !== undefined ? { unique } : {}),
      ...(sparse !== undefined ? { sparse } : {}),
      ...(expireAfterSeconds !== undefined ? { expireAfterSeconds } : {}),
      ...(partialFilterExpression !== undefined ? { partialFilterExpression } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(wildcardProjection !== undefined ? { wildcardProjection } : {}),
      ...(collation !== undefined ? { collation } : {}),
      ...(weights !== undefined ? { weights } : {}),
      ...(default_language !== undefined ? { default_language } : {}),
      ...(language_override !== undefined ? { language_override } : {}),
    });
  }

  protected async executeDropCollectionCommand(cmd: DropCollectionWireCommand): Promise<void> {
    await this.db.collection(cmd.collection).drop();
  }

  protected async executeDropIndexCommand(cmd: DropIndexWireCommand): Promise<void> {
    await this.db.collection(cmd.collection).dropIndex(cmd.name);
  }

  protected async executeCollModCommand(cmd: CollModWireCommand): Promise<void> {
    const { validator, validationLevel, validationAction, changeStreamPreAndPostImages } = cmd;
    await this.db.command({
      collMod: cmd.collection,
      ...(validator !== undefined ? { validator } : {}),
      ...(validationLevel !== undefined ? { validationLevel } : {}),
      ...(validationAction !== undefined ? { validationAction } : {}),
      ...(changeStreamPreAndPostImages !== undefined ? { changeStreamPreAndPostImages } : {}),
    });
  }
}

export async function createMongoDriver(uri: string, dbName: string): Promise<MongoDriver> {
  return MongoDriverImpl.fromConnection(uri, dbName);
}
