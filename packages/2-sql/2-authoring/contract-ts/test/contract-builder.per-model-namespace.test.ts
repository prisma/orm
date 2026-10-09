import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import type { SqlNamespace } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { defineContract, field, model } from '../src/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';

const sqlFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

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

const int4Column = columnDescriptor('pg/int4@1');

const userModelArgs = {
  fields: {
    id: field.column(int4Column).id(),
  },
} as const;

describe('per-model `namespace` field (TS builder)', () => {
  it('lowers `model(name, { namespace, fields })` to `StorageTable.namespaceId`', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: postgresTargetPack,
      namespaces: ['public', 'auth'],
      createNamespace: createTestSqlNamespace,
      models: {
        User: model('User', { namespace: 'auth', ...userModelArgs }),
      },
    });

    // The type-level `tables` for a declared namespace is `{}` to keep
    // `keyof` as `never` (preventing `Db<C>` from collapsing to a string
    // index signature). The runtime value is correct; cast to verify it.
    const authNs = (contract.storage.namespaces as Record<string, SqlNamespace>)['auth'];
    expect(authNs !== undefined ? authNs.entries.table?.['User'] : undefined).toBeDefined();
  });

  it('omits `namespaceId` for models that do not set `namespace` — the late-bound default stays implicit', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: postgresTargetPack,
      namespaces: ['public', 'auth'],
      createNamespace: createTestSqlNamespace,
      models: {
        User: model('User', userModelArgs),
      },
    });

    const publicNs = (contract.storage.namespaces as Record<string, SqlNamespace>)['public'];
    expect(publicNs !== undefined ? publicNs.entries.table?.['User'] : undefined).toBeDefined();
  });

  it('rejects per-model `namespace` that does not appear in the declared list', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['public'],
        createNamespace: createTestSqlNamespace,
        models: {
          User: model('User', { namespace: 'auth', ...userModelArgs }),
        },
      }),
    ).toThrow(/User.*auth.*does not appear/);

    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['public'],
        createNamespace: createTestSqlNamespace,
        models: {
          User: model('User', { namespace: 'auth', ...userModelArgs }),
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.NAMESPACE_UNKNOWN' }));
  });

  it('rejects per-model `namespace` when no namespaces are declared at all', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: {
          User: model('User', { namespace: 'auth', ...userModelArgs }),
        },
      }),
    ).toThrow(/User.*auth.*does not declare any namespaces/);
  });

  it('rejects per-model `namespace: "__unbound__"` — the IR sentinel is reserved on every target', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: {
          User: model('User', { namespace: '__unbound__', ...userModelArgs }),
        },
      }),
    ).toThrow(/__unbound__.*reserved/);
  });

  it('rejects per-model `namespace: "__unspecified__"` — the parser sentinel is reserved on every target', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: {
          User: model('User', { namespace: '__unspecified__', ...userModelArgs }),
        },
      }),
    ).toThrow(/__unspecified__.*reserved/);
  });

  it('rejects per-model `namespace: "unbound"` on Postgres — points to the PSL block', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: {
          User: model('User', { namespace: 'unbound', ...userModelArgs }),
        },
      }),
    ).toThrow(/unbound.*Postgres.*namespace unbound/);
  });

  it('rejects per-model `namespace` on SQLite outright — SQLite has no schema concept', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: sqliteTargetPack,
        createNamespace: createTestSqlNamespace,
        models: {
          User: model('User', { namespace: 'auth', ...userModelArgs }),
        },
      }),
    ).toThrow(/SQLite/);

    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: sqliteTargetPack,
        createNamespace: createTestSqlNamespace,
        models: {
          User: model('User', { namespace: 'auth', ...userModelArgs }),
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.NAMESPACE_UNSUPPORTED' }));
  });
});
