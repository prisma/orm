import { describe, expect, it } from 'vitest';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';
import { PostgresContractView } from '../src/core/postgres-contract-view';
import type { Contract } from './fixtures/namespaced-contract.d';
import contractJson from './fixtures/namespaced-contract.json' with { type: 'json' };

const contract = new PostgresContractSerializer().deserializeContract<Contract>(contractJson);

describe('PostgresContractView', () => {
  it('the view is a superset of the contract (contract fields present)', () => {
    const view = PostgresContractView.from(contract);
    expect(view.storage).toBe(contract.storage);
    expect(view.domain).toBe(contract.domain);
    expect(view.roots).toBe(contract.roots);
  });

  it('keys each schema separately under view.namespace with its own tables', () => {
    const view = PostgresContractView.from(contract);
    expect(view.namespace.public.table.users).toBeDefined();
    expect(view.namespace.auth.table.users).toBeDefined();
    expect(Object.keys(view.namespace.public.table.users.columns).sort()).toEqual(['email', 'id']);
    expect(Object.keys(view.namespace.auth.table.users.columns).sort()).toEqual(['id', 'token']);
  });

  it('view.namespace.<id>.table.<name> returns the same entity object as the raw contract', () => {
    const view = PostgresContractView.from(contract);
    expect(view.namespace.public.table.users).toBe(
      contract.storage.namespaces['public']?.entries.table?.users,
    );
    expect(view.namespace.auth.table.users).toBe(
      contract.storage.namespaces['auth']?.entries.table?.users,
    );
  });

  it('schema names are NOT promoted to the contract root', () => {
    const view = PostgresContractView.from(contract);
    expect((view as unknown as Record<string, unknown>)['public']).toBeUndefined();
    expect((view as unknown as Record<string, unknown>)['auth']).toBeUndefined();
  });

  it('view.namespace.<id>.valueSet is present and empty (no value sets emitted)', () => {
    const view = PostgresContractView.from(contract);
    expect(view.namespace.public.valueSet).toEqual({});
    expect(view.namespace.auth.valueSet).toEqual({});
  });

  it('view.namespace.<id>.entries excludes the built-in table and valueSet keys', () => {
    const view = PostgresContractView.from(contract);
    expect(Object.keys(view.namespace.public.entries)).not.toContain('table');
    expect(Object.keys(view.namespace.public.entries)).not.toContain('valueSet');
  });

  it('fromJson() deserializes and wraps in one call', () => {
    const view = PostgresContractView.fromJson<Contract>(contractJson);
    expect(view.namespace.public.table.users).toBeDefined();
    expect(view.namespace.auth.table.users).toBeDefined();
    expect(view.storage.storageHash).toBe(contract.storage.storageHash);
  });

  it('the default __unbound__ schema is keyed by its raw id under view.namespace', () => {
    // Mirror the facade's keying: the default schema is reachable under its raw
    // `__unbound__` id. Hand-built since the committed namespaced fixture uses
    // only named schemas.
    const withDefault = {
      ...contract,
      storage: {
        ...contract.storage,
        namespaces: {
          ...contract.storage.namespaces,
          __unbound__: {
            id: '__unbound__',
            kind: 'postgres-schema',
            entries: { table: { widgets: { columns: {} } } },
          },
        },
      },
    } as unknown as Contract;

    const view = PostgresContractView.from(withDefault);
    expect(
      (view.namespace as Record<string, { table: Record<string, unknown> }>)['__unbound__']?.table[
        'widgets'
      ],
    ).toBeDefined();
  });

  it('view.namespace.<id>.entries exposes pack-contributed kinds', () => {
    // RLS `policy` isn't in a committed fixture yet, so hand-build a contract
    // with a pack-contributed `policy` kind under the public schema.
    const fakePolicy = { name: 'read_all' };
    const withPolicy = {
      ...contract,
      storage: {
        ...contract.storage,
        namespaces: {
          ...contract.storage.namespaces,
          public: {
            ...contract.storage.namespaces['public'],
            entries: {
              ...contract.storage.namespaces['public']?.entries,
              policy: { readAll: fakePolicy },
            },
          },
        },
      },
    } as unknown as Contract;

    const view = PostgresContractView.from(withPolicy);
    expect((view.namespace.public.entries as Record<string, unknown>)['policy']).toEqual({
      readAll: fakePolicy,
    });
  });
});
