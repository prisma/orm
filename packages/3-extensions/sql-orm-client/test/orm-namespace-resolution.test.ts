import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import {
  getModelColumnFields,
  getOwnFieldColumns,
  resolveModelTableName,
} from '../src/collection-contract';
import { createMockRuntime, getEmptyAggregates } from './helpers';

function model(table: string, fieldColumns: Record<string, string>) {
  const fields: Record<string, { type: { kind: string; codecId: string } }> = {};
  const storageFields: Record<string, { column: string }> = {};
  for (const [field, column] of Object.entries(fieldColumns)) {
    fields[field] = { type: { kind: 'scalar', codecId: 'pg/text@1' } };
    storageFields[field] = { column };
  }
  return { fields, relations: {}, storage: { table, fields: storageFields } };
}

function storageTable(columns: string[]) {
  const cols: Record<string, { codecId: string; dataType: string; nullable: boolean }> = {};
  for (const column of columns) {
    cols[column] = { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false };
  }
  return {
    columns: cols,
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
}

// Same bare model name (`User`) in two namespaces, with distinct field→column
// maps and distinct backing tables, so metadata resolution must discriminate
// by namespace coordinate rather than fall back to the default/first-match.
const twoNamespaceContract = blindCast<Contract<SqlStorage>, 'hand-built multi-namespace fixture'>({
  target: 'postgres',
  targetFamily: 'sql',
  capabilities: {},
  domain: {
    namespaces: {
      public: { models: { User: model('users', { id: 'id', email: 'email_addr' }) } },
      auth: { models: { User: model('auth_users', { id: 'id', token: 'token_col' }) } },
    },
  },
  storage: {
    storageHash: 'stub',
    namespaces: {
      public: { id: 'public', entries: { table: { users: storageTable(['id', 'email_addr']) } } },
      auth: { id: 'auth', entries: { table: { auth_users: storageTable(['id', 'token_col']) } } },
    },
  },
});

describe('namespace-scoped metadata resolution', () => {
  it('resolves field→column maps within the named namespace, discriminating per namespace', () => {
    expect(getOwnFieldColumns(twoNamespaceContract, 'public', 'User')).toEqual({
      id: 'id',
      email: 'email_addr',
    });
    expect(getOwnFieldColumns(twoNamespaceContract, 'auth', 'User')).toEqual({
      id: 'id',
      token: 'token_col',
    });
  });

  it('resolves column→field maps within the named namespace', () => {
    expect(getModelColumnFields(twoNamespaceContract, 'public', 'User')).toEqual({
      id: 'id',
      email_addr: 'email',
    });
    expect(getModelColumnFields(twoNamespaceContract, 'auth', 'User')).toEqual({
      id: 'id',
      token_col: 'token',
    });
  });

  it('resolves the storage table within the named namespace', () => {
    expect(resolveModelTableName(twoNamespaceContract, 'public', 'User')).toBe('users');
    expect(resolveModelTableName(twoNamespaceContract, 'auth', 'User')).toBe('auth_users');
  });

  it('throws when the named namespace is not present on the contract', () => {
    expect(() => getOwnFieldColumns(twoNamespaceContract, 'missing', 'User')).toThrow(
      /namespace "missing" is not present/,
    );
  });

  it('a collection constructed with a namespace resolves its own table within that namespace', () => {
    const ctx = {
      runtime: createMockRuntime(),
      context: blindCast<
        ExecutionContext<Contract<SqlStorage>>,
        'stub execution context for metadata resolution'
      >({
        contract: twoNamespaceContract,
        aggregateDescriptors: getEmptyAggregates(),
      }),
    };
    const publicUsers = new Collection(ctx, 'User', { namespaceId: 'public' });
    const authUsers = new Collection(ctx, 'User', { namespaceId: 'auth' });
    expect(publicUsers.tableName).toBe('users');
    expect(authUsers.tableName).toBe('auth_users');
  });
});
