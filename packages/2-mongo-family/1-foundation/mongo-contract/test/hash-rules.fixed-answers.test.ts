import { readFileSync } from 'node:fs';
import { assertContractHashes } from '@internal/contract/hashing';
import { describe, expect, it } from 'vitest';
import { mongoContractCanonicalizationHooks } from '../src/canonicalization-hooks';

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
        ],
        ...mongoContractCanonicalizationHooks,
      }),
    ).not.toThrow();
  });
});
