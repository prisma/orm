import type { PlanMeta } from '@internal/contract/types';
import {
  defaultMongoDomainNamespaceId,
  type MongoContract,
  mongoModelsOf,
} from '@internal/mongo-contract';
import type { MongoExecutionContext } from '@internal/mongo-query-ast/execution';
import { ormError } from './orm-errors';
import { createRawMongoCollection, type RawMongoCollection } from './raw-collection';

export interface MongoRawClient<TContract extends MongoContract> {
  collection<K extends keyof TContract['roots'] & string>(rootName: K): RawMongoCollection;
}

export function mongoRaw<TContract extends MongoContract>(options: {
  readonly context: MongoExecutionContext<TContract>;
}): MongoRawClient<TContract> {
  const { contract } = options.context;

  return {
    collection<K extends keyof TContract['roots'] & string>(rootName: K): RawMongoCollection {
      const modelName = contract.roots[rootName]?.model;
      const models = mongoModelsOf(contract.domain, defaultMongoDomainNamespaceId);
      if (!modelName || !Object.hasOwn(models, modelName)) {
        throw ormError(
          'ORM.MODEL_UNKNOWN',
          `Unknown model "${modelName ?? ''}" for root "${rootName}"`,
          { meta: { model: modelName ?? '', root: rootName } },
        );
      }
      const collectionName = models[modelName]?.storage.collection ?? modelName;

      const meta: PlanMeta = {
        target: 'mongo',
        storageHash: contract.storage.storageHash,
        lane: 'mongo-raw',
      };

      return createRawMongoCollection(collectionName, meta);
    },
  };
}
