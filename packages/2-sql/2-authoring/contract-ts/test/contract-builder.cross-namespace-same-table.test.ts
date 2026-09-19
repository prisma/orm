import type { TargetPackRef } from '@internal/framework-components/components';
import type { ForeignKey, SqlStorage } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { buildSqlContractFromDefinition } from '../src/contract-builder';
import type { ModelNode } from '../src/contract-definition';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const sqliteTargetPack: TargetPackRef<'sql', 'sqlite'> = {
  kind: 'target',
  id: 'sqlite',
  familyId: 'sql',
  targetId: 'sqlite',
  version: '0.0.1',
  defaultNamespaceId: '__unbound__',
};

const idDescriptor = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;
const textDescriptor = { codecId: 'pg/text@1', nativeType: 'text' } as const;

const publicUser: ModelNode = {
  modelName: 'User',
  tableName: 'users',
  namespaceId: 'public',
  fields: [
    { fieldName: 'id', columnName: 'id', descriptor: idDescriptor, nullable: false },
    { fieldName: 'email', columnName: 'email', descriptor: textDescriptor, nullable: false },
  ],
  id: { columns: ['id'] },
};

const authUser: ModelNode = {
  modelName: 'User',
  tableName: 'users',
  namespaceId: 'auth',
  fields: [
    { fieldName: 'id', columnName: 'id', descriptor: idDescriptor, nullable: false },
    { fieldName: 'token', columnName: 'token', descriptor: textDescriptor, nullable: false },
  ],
  id: { columns: ['id'] },
};

const profile: ModelNode = {
  modelName: 'Profile',
  tableName: 'profile',
  namespaceId: 'public',
  fields: [
    { fieldName: 'id', columnName: 'id', descriptor: idDescriptor, nullable: false },
    { fieldName: 'userId', columnName: 'userId', descriptor: idDescriptor, nullable: false },
  ],
  id: { columns: ['id'] },
  foreignKeys: [
    {
      columns: ['userId'],
      references: { model: 'User', table: 'users', columns: ['id'], namespaceId: 'auth' },
    },
  ],
  relations: [
    {
      fieldName: 'user',
      toModel: 'User',
      toTable: 'users',
      toNamespaceId: 'auth',
      cardinality: 'N:1',
      nullable: false,
      on: {
        parentTable: 'profile',
        parentColumns: ['userId'],
        childTable: 'users',
        childColumns: ['id'],
      },
    },
  ],
};

describe('same bare table name across namespaces with a cross-namespace FK', () => {
  const contract = buildSqlContractFromDefinition({
    warnings: undefined,
    target: postgresTargetPack,
    namespaces: ['public', 'auth'],
    createNamespace: createTestSqlNamespace,
    models: [publicUser, profile, authUser],
  });
  const storage = contract.storage as SqlStorage;

  it('lowers both same-named tables into their own namespace with differing columns', () => {
    const publicUsers = storage.namespaces['public']!.entries.table?.['users'];
    const authUsers = storage.namespaces['auth']!.entries.table?.['users'];
    expect(publicUsers).toBeDefined();
    expect(authUsers).toBeDefined();

    expect(Object.keys(publicUsers!.columns).sort()).toEqual(['email', 'id']);
    expect(Object.keys(authUsers!.columns).sort()).toEqual(['id', 'token']);
  });

  it('lowers the cross-namespace FK with a target coordinate pointing at the other namespace', () => {
    const fks: readonly ForeignKey[] =
      storage.namespaces['public']!.entries.table?.['profile']?.foreignKeys ?? [];
    expect(fks.length).toBe(1);
    expect(fks[0]).toMatchObject({
      target: { namespaceId: 'auth', tableName: 'users', columns: ['id'] },
    });
  });

  it('resolves the domain relation to the explicit cross-namespace coordinate', () => {
    const profileModel = contract.domain.namespaces['public']?.models['Profile'];
    expect(profileModel?.relations?.['user']?.to).toEqual({ namespace: 'auth', model: 'User' });
  });

  it('keeps every same-named model an aggregate root', () => {
    const rootValues = Object.values(contract.roots);
    expect(rootValues).toContainEqual({ namespace: 'public', model: 'User' });
    expect(rootValues).toContainEqual({ namespace: 'auth', model: 'User' });
    expect(rootValues).toContainEqual({ namespace: 'public', model: 'Profile' });
  });

  it('round-trips through JSON and validates without error', () => {
    const json: unknown = JSON.parse(JSON.stringify(contract));
    expect(() => validateSqlContractFully(json)).not.toThrow();
  });
});

describe('same bare table name across non-Postgres default and explicit namespace', () => {
  const unboundUser: ModelNode = {
    modelName: publicUser.modelName,
    tableName: publicUser.tableName,
    fields: publicUser.fields,
    id: { columns: ['id'] },
  };
  const publicUserWithSameTable: ModelNode = {
    ...authUser,
    namespaceId: 'public',
  };

  const contract = buildSqlContractFromDefinition({
    warnings: undefined,
    target: sqliteTargetPack,
    namespaces: ['public'],
    models: [unboundUser, publicUserWithSameTable],
    createNamespace: createTestSqlNamespace,
  });
  const storage = contract.storage as SqlStorage;

  it('keeps the unbound default coordinate distinct from public', () => {
    expect(storage.namespaces['__unbound__']!.entries.table?.['users']).toBeDefined();
    expect(storage.namespaces['public']!.entries.table?.['users']).toBeDefined();
  });
});
