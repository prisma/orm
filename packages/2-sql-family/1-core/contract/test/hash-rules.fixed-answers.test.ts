import { readFileSync } from 'node:fs';
import { assertContractHashes } from '@internal/contract/hashing';
import { describe, expect, it } from 'vitest';
import {
  sqlContractCanonicalizationHooks,
  sqlProfileHashCapabilities,
} from '../src/canonicalization-hooks';

const savedContract = (name: string) =>
  JSON.parse(readFileSync(new URL(`fixtures/hash-rules/${name}.json`, import.meta.url), 'utf8'));

describe('SQL contract hashes', () => {
  it('do not change within a major', () => {
    expect(() =>
      assertContractHashes({
        contracts: [
          {
            name: 'postgres, with an execution section and namespace kinds',
            contract: savedContract('postgres'),
            storageHash: 'b04c6ddd6cd4e9fa7c5c263e514b75b0cdea82923b4c9ae5a3e2765af6155dce',
            profileHash: 'ae77f23935a24b8a63c81ef26bb0f186581670a56e603cef8314a629414e2632',
            executionHash: 'b0582e3d20e49c8f911cbc589a31579d66ced2b8afc9353b6f3b199c0a5a2a35',
          },
          {
            name: 'mysql',
            contract: savedContract('mysql'),
            storageHash: '73a74ebec7b2307f44dddf78f7d8932c27656351f9769f15254ecbfd91112607',
            profileHash: 'a76864aec3e51292e5212754c5fa96988ddc2ce190204c23855cf9c5e5c5f5fa',
          },
          {
            name: 'sqlite',
            contract: savedContract('sqlite'),
            storageHash: 'ef001a917572669b81f16c13aac6f54c3c173afc38511f1fb9a57315c5ee075e',
            profileHash: '595b5c7dd6da0c70556bef798d80d453ba856772e83382b1b62238623cbd8790',
          },
        ],
        ...sqlContractCanonicalizationHooks,
        profileHashCapabilities: sqlProfileHashCapabilities,
      }),
    ).not.toThrow();
  });
});
