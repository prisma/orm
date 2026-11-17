import { computeStorageHash } from '@internal/contract/hashing';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { buildMongoStorage } from '../src/build-mongo-storage';
import { mongoContractCanonicalizationHooks } from '../src/canonicalization-hooks';
import { MongoIndex } from '../src/ir/mongo-index';
import { MongoStorage } from '../src/ir/mongo-storage';

const userIndex = new MongoIndex({
  name: 'email_1',
  keys: [{ field: 'email', direction: 1 }],
  unique: true,
});

describe('buildMongoStorage', () => {
  it('builds the unbound namespace from collections and value sets', () => {
    const storage = buildMongoStorage({
      namespaceId: UNBOUND_NAMESPACE_ID,
      collections: { users: { indexes: [userIndex] }, posts: {} },
      valueSets: { Role: { kind: 'valueSet', values: ['admin'] } },
    });
    expect(storage).toBeInstanceOf(MongoStorage);
    const entries = storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries;
    expect(Object.keys(entries?.['collection'] ?? {})).toEqual(['users', 'posts']);
    expect(Object.keys(entries?.['valueSet'] ?? {})).toEqual(['Role']);
  });

  it('leaves out the value set entry when there are no value sets', () => {
    const storage = buildMongoStorage({
      namespaceId: UNBOUND_NAMESPACE_ID,
      collections: { posts: {} },
      valueSets: {},
    });
    expect(storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries).not.toHaveProperty('valueSet');
  });

  it('hashes the constructed entries with the Mongo canonicalization hooks', () => {
    const storage = buildMongoStorage({
      namespaceId: UNBOUND_NAMESPACE_ID,
      collections: { users: { indexes: [userIndex] } },
      valueSets: { Role: { kind: 'valueSet', values: ['admin'] } },
    });
    const entries = storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries;
    expect(storage.storageHash).toBe(
      computeStorageHash({
        target: 'mongo',
        targetFamily: 'mongo',
        storage: {
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: {
              id: UNBOUND_NAMESPACE_ID,
              entries: { collection: entries?.['collection'], valueSet: entries?.['valueSet'] },
            },
          },
        },
        ...mongoContractCanonicalizationHooks,
      }),
    );
  });

  it('gives a different hash when an index changes', () => {
    const withIndex = buildMongoStorage({
      namespaceId: UNBOUND_NAMESPACE_ID,
      collections: { users: { indexes: [userIndex] } },
      valueSets: {},
    });
    const withoutIndex = buildMongoStorage({
      namespaceId: UNBOUND_NAMESPACE_ID,
      collections: { users: {} },
      valueSets: {},
    });
    expect(withIndex.storageHash).not.toBe(withoutIndex.storageHash);
  });
});
