import { computeStorageHash } from '@internal/contract/hashing';
import { mongoContractCanonicalizationHooks } from './canonicalization-hooks';
import { buildMongoNamespace } from './ir/build-mongo-namespace';
import type { MongoCollectionInput } from './ir/mongo-collection';
import { MongoStorage } from './ir/mongo-storage';
import type { MongoValueObjectInput } from './ir/mongo-value-object';
import type { MongoValueSetInput } from './ir/mongo-value-set';

/**
 * Builds a Mongo contract's storage: the namespace `namespaceId` holding the collections, value sets and value objects, and the storage hash that `db sign` and `db verify` compare. Every Mongo contract source calls this, so they hash storage the same way.
 */
export function buildMongoStorage(input: {
  readonly namespaceId: string;
  readonly collections: Readonly<Record<string, MongoCollectionInput>>;
  readonly valueSets: Readonly<Record<string, MongoValueSetInput>>;
  readonly valueObjects?: Readonly<Record<string, MongoValueObjectInput>>;
}): MongoStorage {
  const hasValueSets = Object.keys(input.valueSets).length > 0;
  const valueObjects = input.valueObjects ?? {};
  const namespace = buildMongoNamespace({
    id: input.namespaceId,
    entries: {
      collection: input.collections,
      ...(hasValueSets ? { valueSet: input.valueSets } : {}),
      ...(Object.keys(valueObjects).length > 0 ? { valueObject: valueObjects } : {}),
    },
  });
  const storageHash = computeStorageHash({
    target: 'mongo',
    targetFamily: 'mongo',
    storage: {
      namespaces: {
        [input.namespaceId]: {
          id: input.namespaceId,
          entries: {
            collection: namespace.entries.collection,
            ...(namespace.entries.valueSet !== undefined
              ? { valueSet: namespace.entries.valueSet }
              : {}),
            ...(namespace.entries.valueObject !== undefined
              ? { valueObject: namespace.entries.valueObject }
              : {}),
          },
        },
      },
    },
    ...mongoContractCanonicalizationHooks,
  });
  return new MongoStorage({ storageHash, namespaces: { [input.namespaceId]: namespace } });
}
