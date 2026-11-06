import { describe, expect, it } from 'vitest';
import { defineContract, field, index, model } from '../src/contract-builder';
import { mongoFamilyPack, mongoTargetPack } from './mongo-test-packs';

// Pins the storageHash computed for a representative authored contract.
// The hash fingerprints the constructed storage body the builder feeds
// into computeStorageHash; a builder-internal refactor that drifts that
// input (key shape, normalization, canonicalization hooks) fails here
// instead of surfacing later as a fixtures:check diff.
describe('mongo builder storageHash pin', () => {
  it('computes the pinned hash for a representative contract', () => {
    const User = model('User', {
      collection: 'users',
      fields: {
        _id: field.objectId(),
        email: field.string(),
      },
      indexes: [index({ email: 1 }, { unique: true })],
    });

    const Post = model('Post', {
      collection: 'posts',
      fields: {
        _id: field.objectId(),
        authorId: field.objectId(),
        title: field.string(),
      },
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { User, Post },
    });

    expect(String(contract.storage.storageHash)).toBe(
      'fa0d1f7630ce87eb9bd3f7250d2ed8fd2322ef400c0b8727cb56ec046fd26e54',
    );
  });
});
