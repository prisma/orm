import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { SqliteContractSerializer } from '../src/core/sqlite-contract-serializer';
import { SqliteContractView } from '../src/core/sqlite-contract-view';
import type { Contract } from './fixtures/sqlite-contract.d';
import contractJson from './fixtures/sqlite-contract.json' with { type: 'json' };

const contract = new SqliteContractSerializer().deserializeContract<Contract>(contractJson);

describe('SqliteContractView', () => {
  it('the view is a superset of the contract (contract fields present)', () => {
    const view = SqliteContractView.from(contract);
    expect(view.storage).toBe(contract.storage);
    expect(view.domain).toBe(contract.domain);
    expect(view.roots).toBe(contract.roots);
  });

  it('view.table exposes tables from the default namespace', () => {
    const view = SqliteContractView.from(contract);
    expect(view.table.users).toBeDefined();
    expect(view.table.posts).toBeDefined();
  });

  it('view.table.<name> returns the same entity object as the raw contract', () => {
    const view = SqliteContractView.from(contract);
    const rawTables = contract.storage.namespaces[UNBOUND_NAMESPACE_ID].entries.table;
    expect(view.table.users).toBe(rawTables?.users);
  });

  it('view.namespace.__unbound__ reaches the default namespace by id', () => {
    const view = SqliteContractView.from(contract);
    expect(view.namespace[UNBOUND_NAMESPACE_ID].table.users).toBe(view.table.users);
  });

  it('view.valueSet is present and empty (SQLite emits no value sets)', () => {
    const view = SqliteContractView.from(contract);
    expect(view.valueSet).toEqual({});
  });

  it('view.entries does not contain the built-in table or valueSet keys', () => {
    const view = SqliteContractView.from(contract);
    expect(Object.keys(view.entries)).not.toContain('table');
    expect(Object.keys(view.entries)).not.toContain('valueSet');
  });

  it('fromJson() deserializes and wraps in one call', () => {
    const view = SqliteContractView.fromJson<Contract>(contractJson);
    expect(view.table.users).toBeDefined();
    // Substitutable for Contract: storage hash matches the serializer's output.
    expect(view.storage.storageHash).toBe(contract.storage.storageHash);
  });

  it('view.entries exposes pack-contributed kinds', () => {
    // SQLite emits only the built-in `table` kind, so this hand-builds a
    // contract with an extra pack-contributed `policy` kind to prove non-built-in
    // kinds land under `.entries`.
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

    const view = SqliteContractView.from(contractWithPackKind);
    expect((view.entries as Record<string, unknown>)['policy']).toEqual({ readPolicy: fakeEntry });
  });
});
