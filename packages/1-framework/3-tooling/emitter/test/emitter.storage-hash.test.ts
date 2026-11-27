import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { createMockSpi } from './mock-spi';
import { createTestContract, emit } from './utils';

const storageWithUnorderedIndexes = {
  namespaces: {
    [UNBOUND_NAMESPACE_ID]: {
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {
          user: {
            columns: { id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false } },
            uniques: [],
            indexes: [
              { columns: ['id'], name: 'user_b_idx' },
              { columns: ['id'], name: 'user_a_idx' },
            ],
            foreignKeys: [],
          },
        },
      },
    },
  },
};

describe('emit storage hash', () => {
  it('writes a storage section that hashes to the contract storage hash', async () => {
    const contract = createTestContract({ storage: { namespaces: {} } });

    await expect(emit(contract, { codecTypeImports: [] }, createMockSpi())).resolves.toMatchObject({
      storageHash: contract.storage.storageHash,
    });
  });

  it('refuses a contract whose storage hash was computed with another normal form of storage', async () => {
    const contract = createTestContract({ storage: storageWithUnorderedIndexes });

    await expect(emit(contract, { codecTypeImports: [] }, createMockSpi())).rejects.toThrow(
      `but the contract's storage hash is ${contract.storage.storageHash}`,
    );
  });
});
