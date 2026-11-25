import type { MongoSchemaCollection } from '@internal/mongo-schema-ir';

export function collectionHasOptions(collection: MongoSchemaCollection): boolean {
  return !!(collection.options || collection.validator);
}

/**
 * Whether the plan writes a `createCollection` for a destination collection the origin lacks: when
 * it has options or a validator, or no index whose creation would bring it into being.
 */
export function writesCollectionCreate(collection: MongoSchemaCollection | undefined): boolean {
  return (
    collection !== undefined &&
    (collectionHasOptions(collection) || collection.indexes.length === 0)
  );
}
