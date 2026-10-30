import { describe, expect, it } from 'vitest';
import { defineContract, field, index, model } from '../src/contract-builder';
import { mongoFamilyPack, mongoTargetPack, type } from './mongo-test-packs';

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
        _id: field.scalar(type.ObjectId()),
        email: field.scalar(type.String()),
      },
      indexes: [index({ email: 1 }, { unique: true })],
    });

    const Post = model('Post', {
      collection: 'posts',
      fields: {
        _id: field.scalar(type.ObjectId()),
        authorId: field.scalar(type.ObjectId()),
        title: field.scalar(type.String()),
      },
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { User, Post },
    });

    expect(String(contract.storage.storageHash)).toBe(
      '5d42e6d82387b059ecc9ffc13e1bf085b978380e0668fe85433f1c72df20df3d',
    );
  });
});
