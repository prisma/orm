import type {
  ListCollectionsCommand,
  ListIndexesCommand,
  MongoInspectionCommandVisitor,
} from '@internal/mongo-query-ast/control';
import { type Db, type Document, MongoServerError } from 'mongodb';

/**
 * Executes the read-only catalog inspections (`listCollections` / `listIndexes`)
 * that migration prechecks/postchecks and operation preview evaluate, directly
 * against `db`. Routing these checks through the adapter's lowering seam is
 * deferred to the `typed-migration-verification-queries` slice.
 */
export class MongoInspectionExecutor implements MongoInspectionCommandVisitor<Promise<Document[]>> {
  constructor(private readonly db: Db) {}

  async listIndexes(cmd: ListIndexesCommand): Promise<Document[]> {
    try {
      return await this.db.collection(cmd.collection).listIndexes().toArray();
    } catch (error: unknown) {
      if (error instanceof MongoServerError && error.code === 26) {
        return [];
      }
      throw error;
    }
  }

  async listCollections(_cmd: ListCollectionsCommand): Promise<Document[]> {
    return this.db.listCollections().toArray();
  }
}
