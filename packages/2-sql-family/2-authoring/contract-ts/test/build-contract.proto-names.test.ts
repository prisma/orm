import type { Contract } from '@internal/contract/types';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import type { SqlNamespace, SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { defineContract, field, model } from '../src/contract-builder';
import { enumType, member } from '../src/enum-type';

const pgText = { codecId: 'pg/text@1' } as const;

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'sql'>;

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
} as const satisfies TargetPackRef<'sql', 'postgres'>;

function tableOf(contract: Contract<SqlStorage>, namespaceId: string, tableName: string): unknown {
  const ns = (contract.storage.namespaces as Record<string, SqlNamespace>)[namespaceId];
  return ns !== undefined ? ns.entries.table?.[tableName] : undefined;
}

function buildUserInNamespace(namespaceId: string) {
  return defineContract({
    ...testTypeLookups,
    family: sqlFamilyPack,
    target: postgresTargetPack,
    namespaces: ['public', namespaceId],
    createNamespace: createTestSqlNamespace,
    models: {
      User: model('User', {
        namespace: namespaceId,
        fields: { id: field.column(pgText).id() },
      }),
    },
  }) as Contract<SqlStorage>;
}

describe('inherited names as namespace and table names', () => {
  it('keeps a table in a `constructor` namespace in the contract without touching the global Object', () => {
    const contract = buildUserInNamespace('constructor');

    expect(tableOf(contract, 'constructor', 'User')).toBeDefined();
    expect((Object as unknown as Record<string, unknown>)['User']).toBeUndefined();
    expect(Object.hasOwn(Object.prototype, 'User')).toBe(false);
    expect(({} as Record<string, unknown>)['User']).toBeUndefined();

    // The contract round-trips through JSON with the namespace intact.
    const roundTripped = JSON.parse(JSON.stringify(contract)) as {
      storage: { namespaces: Record<string, { entries: { table?: Record<string, unknown> } }> };
    };
    expect(roundTripped.storage.namespaces['constructor']?.entries.table?.['User']).toBeDefined();
  });

  it('keeps a table in a `toString` namespace in the contract without touching the builtin toString', () => {
    const contract = buildUserInNamespace('toString');

    expect(tableOf(contract, 'toString', 'User')).toBeDefined();
    expect(Object.hasOwn(Object.prototype.toString, 'User')).toBe(false);
    expect({}.toString).toBe(Object.prototype.toString);
  });

  it('keeps a table named `toString` in the contract', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: {
        User: model('User', { fields: { id: field.column(pgText).id() } }).sql({
          table: 'toString',
        }),
      },
    }) as Contract<SqlStorage>;

    expect(tableOf(contract, 'public', 'toString')).toBeDefined();
    expect({}.toString).toBe(Object.prototype.toString);
  });

  it('keeps a table named `constructor` in the contract', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: {
        User: model('User', { fields: { id: field.column(pgText).id() } }).sql({
          table: 'constructor',
        }),
      },
    }) as Contract<SqlStorage>;

    expect(tableOf(contract, 'public', 'constructor')).toBeDefined();
    expect((Object as unknown as Record<string, unknown>)['User']).toBeUndefined();
  });
});

describe('`__proto__` names are refused', () => {
  it('refuses `__proto__` as a namespace name', () => {
    expect(() => buildUserInNamespace('__proto__')).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_PROTO',
        message: expect.stringContaining('__proto__'),
      }),
    );
    expect(Object.hasOwn(Object.prototype, 'User')).toBe(false);
    expect(({} as Record<string, unknown>)['User']).toBeUndefined();
  });

  it('refuses `__proto__` as a table name', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: {
          User: model('User', { fields: { id: field.column(pgText).id() } }).sql({
            table: '__proto__',
          }),
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_PROTO',
        message: expect.stringContaining('__proto__'),
      }),
    );
    expect(Object.hasOwn(Object.prototype, 'User')).toBe(false);
  });

  it('refuses `__proto__` as a field and column name', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: {
          User: model('User', {
            fields: {
              id: field.column(pgText).id(),
              ['__proto__']: field.column(pgText),
            },
          }),
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_PROTO',
        message: expect.stringContaining('__proto__'),
      }),
    );
  });

  it('refuses `__proto__` as a model name', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: {
          ['__proto__']: model('__proto__', {
            fields: { id: field.column(pgText).id() },
          }),
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_PROTO',
        message: expect.stringContaining('__proto__'),
      }),
    );
  });

  it('refuses `__proto__` as an enum name', () => {
    const Proto = enumType('__proto__', pgText, member('On', 'on'));
    expect(() =>
      defineContract(
        {
          ...testTypeLookups,
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
          enums: { ['__proto__']: Proto },
        },
        ({ field: f, model: m }) => ({
          models: {
            User: m('User', { fields: { id: f.column(pgText).id() } }),
          },
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_PROTO',
        message: expect.stringContaining('__proto__'),
      }),
    );
  });
});
