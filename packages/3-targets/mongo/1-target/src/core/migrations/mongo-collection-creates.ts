import type { ContractWithDomain } from '@internal/contract/types';
import { contractToMongoSchemaIR } from '@internal/family-mongo/control';
import type { MongoContract } from '@internal/mongo-contract';
import type { MongoSchemaCollection } from '@internal/mongo-schema-ir';
import { hasCollection } from './mongo-model-coordinates';

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

/** Whether a plan from `fromContract` to `contract` creates collection `name` with `createCollection`. */
export function planCreatesCollection(
  fromContract: ContractWithDomain,
  contract: MongoContract,
  name: string,
): boolean {
  return (
    !hasCollection(fromContract, name) &&
    writesCollectionCreate(contractToMongoSchemaIR(contract).collection(name))
  );
}
