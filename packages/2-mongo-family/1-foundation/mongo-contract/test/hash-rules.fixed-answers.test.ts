import { readFileSync } from 'node:fs';
import { assertContractHashes } from '@internal/contract/hashing';
import { describe, expect, it } from 'vitest';
import { normalizeMongoStorage } from '../src/canonicalization-hooks';

const savedContract = (name: string) =>
  JSON.parse(readFileSync(new URL(`fixtures/hash-rules/${name}.json`, import.meta.url), 'utf8'));

describe('Mongo contract hashes', () => {
  it('do not change within a major', () => {
    expect(() =>
      assertContractHashes({
        contracts: [
          {
            name: 'mongo, with an execution section and namespace kinds',
            contract: savedContract('mongo'),
            storageHash: '7fac2a713339efe2193dd603dfe74dd065ad95ef487e35312267118e7e356bad',
            profileHash: '8fe2b3350db5a83e2473520e59e52262982215115e17bb22a76239170eee6e69',
            executionHash: 'a47600af698523af2871083263fccc3d428dd16b41bac0b431619ba9ad8887b7',
          },
          {
            name: 'mongo, with every default the family leaves out written out and its ordered lists out of order',
            contract: savedContract('mongo-every-default-written'),
            storageHash: '0a7a968a58bbd1bab72a504c43c77f9154385d85d3de45da2d666e13fb299b14',
            profileHash: '8fe2b3350db5a83e2473520e59e52262982215115e17bb22a76239170eee6e69',
          },
          {
            name: 'mongo, with every default the family leaves out absent and its ordered lists in order',
            contract: savedContract('mongo-every-default-absent'),
            storageHash: '0a7a968a58bbd1bab72a504c43c77f9154385d85d3de45da2d666e13fb299b14',
            profileHash: '8fe2b3350db5a83e2473520e59e52262982215115e17bb22a76239170eee6e69',
          },
        ],
        normalizeStorage: normalizeMongoStorage,
      }),
    ).not.toThrow();
  });

  it('write a contract with every default written out as the contract with them absent', () => {
    expect(normalizeMongoStorage(savedContract('mongo-every-default-written').storage)).toEqual(
      savedContract('mongo-every-default-absent').storage,
    );
  });
});
