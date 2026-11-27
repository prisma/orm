import { describe, expect, it } from 'vitest';
import { defineContract, field, index, model } from '../src/contract-builder';
import { mongoFamilyPack, mongoTargetPack, type } from './mongo-test-packs';

// Pins the storageHash computed for a representative authored contract.
// The hash fingerprints the constructed storage body the builder feeds
// into computeStorageHash; a builder-internal refactor that drifts that
// input (key shape, the family's normal form of storage) fails here
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
      '0649f34f90e230bf31989b95f8072535cd9040579b833160813a2c30dde65267',
    );
  });
});
