import type { ControlDriverInstance } from '@internal/framework-components/control';
import type { AnyMongoDdlWireCommand, AnyMongoDmlWireCommand } from '@internal/mongo-wire';
import type { Db } from 'mongodb';

export interface MongoQueryable {
  execute<Row>(wireCommand: AnyMongoDmlWireCommand): AsyncIterable<Row>;
  run(wireCommand: AnyMongoDdlWireCommand): Promise<void>;
}

export interface MongoDriver<TBinding = void> extends MongoQueryable {
  connect(binding: TBinding): Promise<void>;
  close(): Promise<void>;
}

export interface MongoControlDriverInstance
  extends ControlDriverInstance<'mongo', 'mongo'>,
    MongoQueryable {
  readonly db: Db;
}
