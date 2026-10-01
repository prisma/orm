import type { TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { buildSqlContractFromDefinition } from '../src/contract-builder';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const minimalModelArgs = {
  modelName: 'User',
  tableName: 'app_user',
  fields: [
    {
      fieldName: 'id',
      columnName: 'id',
      descriptor: {
        codecId: 'pg/int4@1',
        nativeType: 'int4',
      },
      nullable: false,
      many: false,
    },
  ],
  id: {
    columns: ['id'],
  },
} as const;

describe('SqlStorage.namespaces population', () => {
  it('materialises the public namespace with lowered tables when models use the postgres default coordinate', () => {
    const contract = buildSqlContractFromDefinition({
      warnings: undefined,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: [minimalModelArgs],
    });
    expect(Object.keys(contract.storage.namespaces).sort()).toEqual(['public']);
    const publicNamespace = contract.storage.namespaces['public']!;
    expect(publicNamespace.id).toBe('public');
    expect(publicNamespace.entries.table?.['app_user']).toBeDefined();
    expect(contract.storage.namespaces['__unbound__']).toBeUndefined(); // TML-2916
  });

  it('creates declared namespace slots (initially empty tables) alongside the public default coordinate', () => {
    const contract = buildSqlContractFromDefinition({
      warnings: undefined,
      target: postgresTargetPack,
      namespaces: ['public', 'auth'],
      createNamespace: createTestSqlNamespace,
      models: [minimalModelArgs],
    });
    const namespaceIds = Object.keys(contract.storage.namespaces).sort();
    expect(namespaceIds).toEqual(['auth', 'public']);
    expect(Object.keys(contract.storage.namespaces['auth']!.entries.table ?? {})).toHaveLength(0);
    expect(contract.storage.namespaces['public']!.entries.table?.['app_user']).toBeDefined();
  });

  it('places tables in the namespace referenced by the model coordinate', () => {
    const contract = buildSqlContractFromDefinition({
      warnings: undefined,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: [
        { ...minimalModelArgs, namespaceId: 'auth' },
        { ...minimalModelArgs, modelName: 'Post', tableName: 'blog_post' },
      ],
    });
    const namespaceIds = Object.keys(contract.storage.namespaces).sort();
    expect(namespaceIds).toEqual(['auth', 'public']);
    expect(contract.storage.namespaces['auth']!.entries.table?.['app_user']).toBeDefined();
    expect(contract.storage.namespaces['public']!.entries.table?.['blog_post']).toBeDefined();
  });

  it('materialises an empty public namespace when no models are declared', () => {
    const contract = buildSqlContractFromDefinition({
      warnings: undefined,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: [],
    });
    expect(Object.keys(contract.storage.namespaces).sort()).toEqual(['public']);
    expect(contract.storage.namespaces['public']!.id).toBe('public');
    expect(Object.keys(contract.storage.namespaces['public']!.entries.table ?? {})).toHaveLength(0);
    expect(contract.storage.namespaces['__unbound__']).toBeUndefined(); // TML-2916
  });

  it('accepts declared namespaces with a createNamespace factory', () => {
    expect(() =>
      buildSqlContractFromDefinition({
        warnings: undefined,
        target: postgresTargetPack,
        namespaces: ['auth'],
        createNamespace: createTestSqlNamespace,
        models: [minimalModelArgs],
      }),
    ).not.toThrow();
  });

  it('deduplicates declared and table-referenced namespace ids — no slot is built twice', () => {
    const contract = buildSqlContractFromDefinition({
      warnings: undefined,
      target: postgresTargetPack,
      namespaces: ['auth'],
      createNamespace: createTestSqlNamespace,
      models: [{ ...minimalModelArgs, namespaceId: 'auth' }],
    });
    const namespaceIds = Object.keys(contract.storage.namespaces).sort();
    expect(namespaceIds).toEqual(['auth', 'public']);
    expect(contract.storage.namespaces['auth']!.entries.table?.['app_user']).toBeDefined();
  });
});
