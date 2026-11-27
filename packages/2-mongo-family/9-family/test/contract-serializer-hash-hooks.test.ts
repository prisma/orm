import { normalizeMongoStorage } from '@internal/mongo-contract/canonicalization-hooks';
import { describe, expect, it } from 'vitest';
import { MongoContractSerializer } from '../src/core/ir/mongo-contract-serializer';

describe('MongoContractSerializer normal form of storage', () => {
  it("is the MongoDB family's, and snapshots are read without content verification", () => {
    expect(new MongoContractSerializer()).toMatchObject({
      normalizeStorage: normalizeMongoStorage,
      skipsSnapshotContentVerification: true,
    });
  });
});
