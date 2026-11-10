import type { MongoContract, MongoStorage } from '@internal/mongo-contract';

/**
 * Mongo target contract envelope: the result of
 * `descriptor.contractSerializer.deserializeContract(json)`.
 *
 * Structurally `MongoContract` with the storage envelope promoted to
 * the family-layer `MongoStorage` class instance — the class carries
 * `namespaces` and gives the rest of the framework a stable surface to
 * reach for. The leaf collection / index shapes inside
 * `storage.collections` are family-layer `MongoCollection` instances.
 */
export type MongoTargetContract = Omit<MongoContract, 'storage'> & {
  readonly storage: MongoStorage;
};
