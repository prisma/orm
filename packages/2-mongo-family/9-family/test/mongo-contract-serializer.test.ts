import { isContractBuiltInMemory } from '@internal/contract/format-version';
import { MongoStorage } from '@internal/mongo-contract';
import { describe, expect, it } from 'vitest';
import { MongoContractSerializer } from '../src/core/ir/mongo-contract-serializer';
import { mongoContractJson } from './mongo-contract-json-fixture';

describe('MongoContractSerializer', () => {
  it('builds the storage of a contract it reads as a MongoStorage, so the contract is one built in memory', () => {
    const json = mongoContractJson({});
    const contract = new MongoContractSerializer().deserializeContract(json);

    expect(contract.storage).toBeInstanceOf(MongoStorage);
    expect(contract.storage.storageHash).toBe(json.storage.storageHash);
    expect(isContractBuiltInMemory(contract)).toBe(true);
  });

  it('leaves the namespaces of the document it read unfrozen', () => {
    const json = mongoContractJson({});
    new MongoContractSerializer().deserializeContract(json);

    expect(Object.isFrozen(json.storage.namespaces)).toBe(false);
  });

  it('reads back what it prints', () => {
    const serializer = new MongoContractSerializer();
    const contract = serializer.deserializeContract(mongoContractJson({}));

    expect(serializer.deserializeContract(serializer.serializeContract(contract))).toEqual(
      contract,
    );
  });
});
