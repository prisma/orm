import { readFileSync } from 'node:fs';
import { assertContractHashes } from '@internal/contract/hashing';
import { describe, expect, it } from 'vitest';
import { normalizeSqlStorage } from '../src/normal-form';

const savedContract = (name: string) =>
  JSON.parse(readFileSync(new URL(`fixtures/hash-rules/${name}.json`, import.meta.url), 'utf8'));

describe('SQL contract hashes', () => {
  it('do not change within a major', () => {
    expect(() =>
      assertContractHashes({
        contracts: [
          {
            name: 'postgres, with an execution section, namespace kinds and two capability namespaces',
            contract: savedContract('postgres'),
            storageHash: 'b04c6ddd6cd4e9fa7c5c263e514b75b0cdea82923b4c9ae5a3e2765af6155dce',
            profileHash: '833bc812933db0423c719a4f649ef81d804884470e61736e4e3bc8eb4acda174',
            executionHash: 'b0582e3d20e49c8f911cbc589a31579d66ced2b8afc9353b6f3b199c0a5a2a35',
          },
          {
            name: 'mysql',
            contract: savedContract('mysql'),
            storageHash: '73a74ebec7b2307f44dddf78f7d8932c27656351f9769f15254ecbfd91112607',
            profileHash: 'bbed4a8a3ca809c6b70154a0eccd13351c38e39386cf820a33c7fbca88a16c42',
          },
          {
            name: 'sqlite',
            contract: savedContract('sqlite'),
            storageHash: 'ef001a917572669b81f16c13aac6f54c3c173afc38511f1fb9a57315c5ee075e',
            profileHash: '0f0eba589e341f164b3bab67df828ca46ed7d829e29febd6c6082c7efc2a259d',
          },
          {
            name: 'postgres, with every default the family leaves out written out and its ordered lists out of order',
            contract: savedContract('postgres-every-default-written'),
            storageHash: '103bfcd5ba155e67f0ddeda73386902ed2d02739e50a86f46ce85f94ebafbb7b',
            profileHash: 'ae77f23935a24b8a63c81ef26bb0f186581670a56e603cef8314a629414e2632',
          },
          {
            name: 'postgres, with every default the family leaves out absent and its ordered lists in order',
            contract: savedContract('postgres-every-default-absent'),
            storageHash: '103bfcd5ba155e67f0ddeda73386902ed2d02739e50a86f46ce85f94ebafbb7b',
            profileHash: 'ae77f23935a24b8a63c81ef26bb0f186581670a56e603cef8314a629414e2632',
          },
        ],
        normalizeStorage: normalizeSqlStorage,
      }),
    ).not.toThrow();
  });

  it('write a contract with every default written out as the contract with them absent', () => {
    expect(normalizeSqlStorage(savedContract('postgres-every-default-written').storage)).toEqual(
      savedContract('postgres-every-default-absent').storage,
    );
  });
});
