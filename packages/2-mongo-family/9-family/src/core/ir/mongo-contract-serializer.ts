import { type MongoContract, MongoStorage } from '@internal/mongo-contract';
import { blindCast } from '@internal/utils/casts';
import type { JsonObject } from '@internal/utils/json';
import { MongoContractSerializerBase } from './mongo-contract-serializer-base';

/**
 * Default Mongo family `ContractSerializer` concretion. Inherits the
 * Mongo-shared deserialization pipeline (structural validation +
 * collection-level hydration) and builds the validated storage as a
 * `MongoStorage`, as every contract Prisma builds has its storage. Family-level call sites
 * (family-instance methods, family-layer tests that don't reach into
 * a target descriptor) instantiate this directly; targets with their
 * own storage concretion (`target-mongo`'s `MongoTargetContractSerializer`)
 * override `constructTargetContract` to wrap the storage shape.
 */
export class MongoContractSerializer extends MongoContractSerializerBase<MongoContract> {
  protected constructTargetContract(validated: MongoContract): MongoContract {
    const { storage } = validated;
    return {
      ...validated,
      storage: new MongoStorage({
        storageHash: storage.storageHash,
        namespaces: { ...storage.namespaces },
      }),
    };
  }

  protected override printContractV1(contract: MongoContract): JsonObject {
    return blindCast<JsonObject, 'Mongo contract IR fields are JSON-clean by construction'>(
      JSON.parse(JSON.stringify(contract)),
    );
  }
}
