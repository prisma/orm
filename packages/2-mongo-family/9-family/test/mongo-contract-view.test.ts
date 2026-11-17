import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { MongoContractSerializer } from '../src/core/ir/mongo-contract-serializer';
import { MongoContractView } from '../src/core/ir/mongo-contract-view';
import type { Contract } from './fixtures/orm-contract.d';
import contractJson from './fixtures/orm-contract.json' with { type: 'json' };

const contract = new MongoContractSerializer().deserializeContract<Contract>(contractJson);

describe('MongoContractView', () => {
  it('the view is a superset of the contract (contract fields present)', () => {
    const view = MongoContractView.from(contract);
    expect(view.storage).toBe(contract.storage);
    expect(view.domain).toBe(contract.domain);
    expect(view.roots).toBe(contract.roots);
  });

  it('view.collection exposes collections from the default namespace', () => {
    const view = MongoContractView.from(contract);
    expect(view.collection.tasks).toBeDefined();
    expect(view.collection.users).toBeDefined();
  });

  it('view.collection.<name> returns the same entity object as the raw contract', () => {
    const view = MongoContractView.from(contract);
    const rawCollections = contract.storage.namespaces[UNBOUND_NAMESPACE_ID].entries['collection'];
    expect(view.collection.tasks).toBe(rawCollections['tasks']);
    expect(view.collection.users).toBe(rawCollections['users']);
  });

  it('view.namespace.__unbound__ reaches the default namespace by id', () => {
    const view = MongoContractView.from(contract);
    expect(view.namespace[UNBOUND_NAMESPACE_ID].collection.tasks).toBe(view.collection.tasks);
  });

  it('view.entries does not contain the collection key', () => {
    const view = MongoContractView.from(contract);
    expect(Object.keys(view.entries)).not.toContain('collection');
  });

  it('fromJson() deserializes and wraps in one call', () => {
    const view = MongoContractView.fromJson<Contract>(contractJson);
    expect(view.collection.tasks).toBeDefined();
    expect(view.storage.storageHash).toBe(contract.storage.storageHash);
  });

  it('view.entries exposes pack-contributed kinds', () => {
    // The fixture carries only the built-in `collection` kind, so this
    // hand-builds a contract with an extra pack-contributed `policy` kind to
    // prove non-built-in kinds land under `.entries`.
    const fakeEntry = { name: 'test-pack-entity' };
    const contractWithPackKind = {
      ...contract,
      storage: {
        ...contract.storage,
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            ...contract.storage.namespaces[UNBOUND_NAMESPACE_ID],
            entries: {
              ...contract.storage.namespaces[UNBOUND_NAMESPACE_ID].entries,
              policy: { readPolicy: fakeEntry },
            },
          },
        },
      },
    } as unknown as Contract;

    const view = MongoContractView.from(contractWithPackKind);
    expect((view.entries as Record<string, unknown>)['policy']).toEqual({ readPolicy: fakeEntry });
  });
});
