import { describe, expect, it } from 'vitest';
import { asNamespaceId } from '../src/namespace-id';

function crossRef(model: string, namespace = 'default') {
  return { namespace: asNamespaceId(namespace), model };
}

import { createContract, createSqlContract } from './support/contract-factories';

describe('createContract', () => {
  it('creates a contract with defaults', () => {
    const contract = createContract();
    expect(contract.target).toBe('postgres');
    expect(contract.targetFamily).toBe('sql');
    expect(contract.roots).toEqual({});
    expect(contract.domain.namespaces['__unbound__']?.models).toEqual({});
    expect(contract.capabilities).toEqual({});
    expect(contract.extensions).toEqual({});
    expect(contract.meta).toEqual({});
    expect(contract.storage.storageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(contract.profileHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('respects overrides', () => {
    const contract = createContract({
      target: 'mysql',
      targetFamily: 'sql',
      capabilities: { mysql: { json: true } },
      roots: { users: crossRef('User') },
    });
    expect(contract.target).toBe('mysql');
    expect(contract.capabilities).toEqual({ mysql: { json: true } });
    expect(contract.roots).toEqual({ users: crossRef('User') });
  });

  it('computes executionHash when execution is provided', () => {
    const contract = createContract({
      execution: {
        mutations: {
          defaults: [
            {
              ref: { namespace: 'public', table: 'user', column: 'id' },
              onCreate: { kind: 'generator', id: 'uuidv4' },
            },
          ],
        },
      },
    });
    expect(contract.execution).toBeDefined();
    expect(contract.execution!.executionHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('computes different storageHash for different storage', () => {
    const c1 = createContract({ storage: { namespaces: {} } });
    const c2 = createSqlContract({
      storage: {
        namespaces: {
          public: { id: 'public', entries: { table: { user: { columns: {} } } } },
        },
      },
    });
    expect(c1.storage.storageHash).not.toBe(c2.storage.storageHash);
  });
});

describe('createContract with named namespaces', () => {
  it('places each namespace payload under domain.namespaces as given', () => {
    const contract = createContract({
      namespaces: {
        auth: { models: { User: { fields: {}, relations: {}, storage: {} } } },
        public: { models: {} },
      },
    });
    expect(Object.keys(contract.domain.namespaces)).toEqual(['auth', 'public']);
    expect(contract.domain.namespaces['auth']?.models['User']).toBeDefined();
  });
});

describe('createSqlContract with per-namespace tables', () => {
  it('builds one storage namespace per table map', () => {
    const contract = createSqlContract({
      tables: { auth: { user: { columns: {} } }, public: { post: { columns: {} } } },
    });
    expect(contract.storage.namespaces).toEqual({
      auth: { id: 'auth', entries: { table: { user: { columns: {} } } } },
      public: { id: 'public', entries: { table: { post: { columns: {} } } } },
    });
    expect(contract.storage.storageHash).not.toEqual(createSqlContract().storage.storageHash);
  });
});

describe('createSqlContract', () => {
  it('defaults to postgres/sql', () => {
    const contract = createSqlContract();
    expect(contract.target).toBe('postgres');
    expect(contract.targetFamily).toBe('sql');
  });

  it('includes storage with tables', () => {
    const contract = createSqlContract({
      storage: {
        namespaces: {
          __unbound__: {
            id: '__unbound__',
            entries: {
              table: {
                user: {
                  columns: {
                    id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                  },
                },
              },
            },
          },
        },
      },
    });
    const unbound = contract.storage.namespaces['__unbound__'];
    expect(unbound).toBeDefined();
    const tables = unbound!.entries['table'] as Record<string, unknown>;
    expect(tables).toHaveProperty('user');
    expect(contract.storage.storageHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
