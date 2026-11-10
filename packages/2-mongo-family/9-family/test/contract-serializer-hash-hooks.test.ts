import { describe, expect, it } from 'vitest';
import { MongoContractSerializer } from '../src/core/ir/mongo-contract-serializer';

describe('MongoContractSerializer hash canonicalization hooks', () => {
  it('publishes no hash recompute hooks: the emit hash input is a storage projection, not the persisted shape', () => {
    const serializer = new MongoContractSerializer() as {
      readonly hashCanonicalizationHooks?: object;
    };
    expect(serializer.hashCanonicalizationHooks).toBeUndefined();
  });
});
