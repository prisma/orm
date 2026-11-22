import { describe, expect, it } from 'vitest';
import { createStorageSort } from '../src/canonicalization-storage-sort';
import { computeStorageHash } from '../src/hashing';

function storageWithProtoCollection(payload: Record<string, unknown>) {
  return {
    namespaces: Object.fromEntries([
      [
        '__proto__',
        {
          id: '__proto__',
          entries: { collection: Object.fromEntries([['__proto__', payload]]) },
        },
      ],
    ]),
  };
}

function hashOf(storage: Record<string, unknown>, sortStorage = createStorageSort([])) {
  return computeStorageHash({ target: 'mongo', targetFamily: 'mongo', storage, sortStorage });
}

describe('storage hash of names every object has as a property', () => {
  it('hashes what a namespace and an entity named __proto__ hold', () => {
    expect(hashOf(storageWithProtoCollection({ a: 1 }))).not.toBe(
      hashOf(storageWithProtoCollection({ b: 2 })),
    );
  });

  it('hashes what they hold through a storage sort that walks every entry', () => {
    const sortStorage = createStorageSort([
      { path: ['namespaces', '*', 'entries', 'collection', '*'], arrayKeys: ['indexes'] },
    ]);
    expect(hashOf(storageWithProtoCollection({ a: 1 }), sortStorage)).not.toBe(
      hashOf(storageWithProtoCollection({ b: 2 }), sortStorage),
    );
  });
});
