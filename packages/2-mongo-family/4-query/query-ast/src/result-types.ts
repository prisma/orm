/**
 * Canonical command result types for the MongoDB primitive language.
 *
 * These interfaces describe the shape of the result document yielded by
 * each write command. They live in the query layer (co-located with
 * command AST nodes) because they are part of the language definition —
 * transport layers (wire, HTTP, etc.) satisfy these interfaces, they do
 * not define them.
 */

export interface InsertOneResult {
  readonly insertedId: unknown;
  /** The inserted document with its `_id`, as a read of it returns it: written to BSON and read back locally with the client's BSON options. */
  readonly document: unknown;
}

export interface InsertManyResult {
  readonly insertedIds: ReadonlyArray<unknown>;
  readonly insertedCount: number;
  /** The inserted documents in input order, each as `InsertOneResult.document` describes. */
  readonly documents: ReadonlyArray<unknown>;
}

/**
 * Shared result shape for `updateOne`, `updateMany`, and `upsertOne`
 * commands. The `upsertedCount` / `upsertedId` fields are present only
 * when the command was issued with `upsert: true` and a new document
 * was inserted.
 */
export interface UpdateResult {
  readonly matchedCount: number;
  readonly modifiedCount: number;
  readonly upsertedCount?: number;
  readonly upsertedId?: unknown;
}

/** Alias — `updateOne` yields the same shape as `updateMany`. */
export type UpdateOneResult = UpdateResult;

/** Alias — `updateMany` yields the same shape as `updateOne`. */
export type UpdateManyResult = UpdateResult;

/**
 * Shared result shape for `deleteOne` and `deleteMany` commands.
 */
export interface DeleteResult {
  readonly deletedCount: number;
}

/** Alias — `deleteOne` yields the same shape as `deleteMany`. */
export type DeleteOneResult = DeleteResult;

/** Alias — `deleteMany` yields the same shape as `deleteOne`. */
export type DeleteManyResult = DeleteResult;
