import type {
  CollModCommand,
  CreateCollectionCommand,
  CreateIndexCommand,
  DropCollectionCommand,
  DropIndexCommand,
  RenameCollectionCommand,
} from './ddl-commands';
import type { ListCollectionsCommand, ListIndexesCommand } from './inspection-commands';

export interface MongoDdlCommandVisitor<R> {
  createIndex(command: CreateIndexCommand): R;
  dropIndex(command: DropIndexCommand): R;
  createCollection(command: CreateCollectionCommand): R;
  dropCollection(command: DropCollectionCommand): R;
  renameCollection(command: RenameCollectionCommand): R;
  collMod(command: CollModCommand): R;
}

export interface MongoInspectionCommandVisitor<R> {
  listIndexes(command: ListIndexesCommand): R;
  listCollections(command: ListCollectionsCommand): R;
}
