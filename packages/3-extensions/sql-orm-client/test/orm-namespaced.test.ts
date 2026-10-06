import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { orm } from '../src/orm';
import { createMockRuntime, getEmptyAggregates, type TestContract } from './helpers';

function model(table: string) {
  return {
    fields: {
      id: { many: false, nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
    },
    relations: {},
    storage: { table, fields: { id: { column: 'id' } } },
  };
}

function storageTable() {
  return {
    columns: { id: { many: false, codecId: 'pg/int4@1', nativeType: 'int4', nullable: false } },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
}

// Two namespaces that declare the same bare model name (`User`) backed by
// different tables, plus a model unique to each namespace, so resolution must
// discriminate by namespace coordinate rather than fall back to the flat scan.
const twoNamespaceContract = {
  target: 'postgres',
  targetFamily: 'sql',
  capabilities: {},
  domain: {
    namespaces: {
      public: { models: { User: model('users'), Post: model('posts') } },
      auth: { models: { User: model('auth_users'), Session: model('sessions') } },
    },
  },
  storage: {
    storageHash: 'stub',
    namespaces: {
      public: {
        id: 'public',
        entries: { table: { users: storageTable(), posts: storageTable() } },
      },
      auth: {
        id: 'auth',
        entries: { table: { auth_users: storageTable(), sessions: storageTable() } },
      },
    },
  },
};

type Accessor = { readonly modelName: string; readonly tableName: string };
type TwoNamespaceOrm = {
  public: { User: Accessor; Post: Accessor; Session: undefined };
  auth: { User: Accessor; Session: Accessor };
};

function db() {
  return orm({
    runtime: createMockRuntime(),
    context: {
      contract: twoNamespaceContract,
      aggregateDescriptors: getEmptyAggregates(),
    } as unknown as ExecutionContext<TestContract>,
  }) as unknown as TwoNamespaceOrm;
}

describe('namespaced orm accessor', () => {
  it('resolves the same bare model name to the distinct table in each namespace', () => {
    expect(db().public.User.tableName).toBe('users');
    expect(db().public.User.modelName).toBe('User');
    expect(db().auth.User.tableName).toBe('auth_users');
    expect(db().auth.User.modelName).toBe('User');
  });

  it('scopes model lookup to the named namespace rather than the flat model set', () => {
    // `Session` exists only in `auth`, so resolving it under `public` must
    // return undefined rather than the `auth` model.
    expect(db().public.Session).toBeUndefined();
    expect(db().auth.Session.tableName).toBe('sessions');
  });
});
