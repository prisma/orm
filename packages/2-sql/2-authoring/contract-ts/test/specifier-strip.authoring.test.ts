import { fileURLToPath } from 'node:url';
import type { ContractSourceContext } from '@internal/config/config-types';
import { type Contract, type ControlPolicy, coreHash, profileHash } from '@internal/contract/types';
import type { FamilyPackRef } from '@internal/framework-components/components';
import { type CheckConstraint, SqlStorage, type StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf, timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { typescriptContract, typescriptContractFromPath } from '../src/config-types';
import { defineContract } from '../src/contract-builder';
import { applySqlSpecifierControlPolicy } from '../src/derived-checks';
import { enumType, member } from '../src/enum-type';
import { renderCheckExpressions } from './fixtures/managed-user-contract';

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  authoring: {
    field: {
      text: {
        kind: 'fieldPreset',
        output: { codecId: 'pg/text@1', nativeType: 'text' },
      },
    },
  },
} as const satisfies FamilyPackRef<'sql'>;

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
  authoring: { field: {}, renderCheckExpressions },
} as const;

const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' } as const;
const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));

function buildUser(options?: { readonly control?: ControlPolicy }): Contract<SqlStorage> {
  return defineContract(
    {
      family: sqlFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      enums: { Role },
    },
    ({ field: f, model: m }) =>
      ({
        models: {
          User: m('User', {
            fields: { id: f.text().id(), role: f.namedType(Role), tags: f.text().many() },
          }).sql(options?.control === undefined ? {} : { control: options.control }),
        },
      }) as const,
  ) as Contract<SqlStorage>;
}

function buildMixedControl(): Contract<SqlStorage> {
  return defineContract(
    {
      family: sqlFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      enums: { Role },
    },
    ({ field: f, model: m }) =>
      ({
        models: {
          User: m('User', {
            fields: { id: f.text().id(), role: f.namedType(Role), tags: f.text().many() },
          }).sql({ control: 'managed' }),
          Item: m('Item', {
            fields: { id: f.text().id(), role: f.namedType(Role), tags: f.text().many() },
          }),
        },
      }) as const,
  ) as Contract<SqlStorage>;
}

function checksOf(contract: Contract, tableName = 'User'): readonly CheckConstraint[] {
  const storage = contract.storage as SqlStorage;
  const ns = storage.namespaces['public'];
  const table = ns !== undefined ? ns.entries.table?.[tableName] : undefined;
  return (table as StorageTable | undefined)?.checks ?? [];
}

const stubContext: ContractSourceContext = {
  composedExtensions: [],
  composedExtensionContracts: new Map(),
  authoringContributions: {
    field: {},
    type: {},
    entityTypes: {},
    pslBlockDescriptors: {},
    modelAttributes: {},
    attributeSpecs: { model: {}, field: {} },
  },
  codecLookup: {
    get: () => undefined,
    targetTypesFor: () => undefined,
    renderOutputTypeFor: () => undefined,
  },
  controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
  resolvedInputs: [],
  capabilities: {},
};

describe('applySqlSpecifierControlPolicy', () => {
  it('stamps the specifier default, strips derived checks, and rehashes the storage', () => {
    const built = buildUser();
    expect(checksOf(built)).toHaveLength(2);

    const applied = applySqlSpecifierControlPolicy(built, 'external', createTestSqlNamespace);

    expect(applied.defaultControlPolicy).toBe('external');
    expect(checksOf(applied)).toEqual([]);
    expect((applied.storage as SqlStorage).storageHash).not.toBe(built.storage.storageHash);
  });

  it('keeps derived checks on a table declaring managed under a specifier external default', () => {
    const built = buildUser({ control: 'managed' });
    expect(checksOf(built)).toHaveLength(2);

    const applied = applySqlSpecifierControlPolicy(built, 'external', createTestSqlNamespace);

    expect(applied.defaultControlPolicy).toBe('external');
    expect(checksOf(applied)).toHaveLength(2);
    expect((applied.storage as SqlStorage).storageHash).toBe(built.storage.storageHash);
  });

  it('strips only the tables not declaring managed under a specifier external default', () => {
    const built = buildMixedControl();
    expect(checksOf(built, 'User')).toHaveLength(2);
    expect(checksOf(built, 'Item')).toHaveLength(2);

    const applied = applySqlSpecifierControlPolicy(built, 'external', createTestSqlNamespace);

    expect(applied.defaultControlPolicy).toBe('external');
    expect(checksOf(applied, 'User')).toHaveLength(2);
    expect(checksOf(applied, 'Item')).toEqual([]);
    expect((applied.storage as SqlStorage).storageHash).not.toBe(built.storage.storageHash);
  });

  it('returns the contract by reference when the specifier stamps no policy', () => {
    const built = buildUser();
    expect(applySqlSpecifierControlPolicy(built, undefined, createTestSqlNamespace)).toBe(built);
  });

  it('throws rather than silently keeping every check when a table carries checks but its column map is empty', () => {
    const contract: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('column-map-invariant'),
      storage: new SqlStorage({
        storageHash: coreHash('column-map-invariant'),
        namespaces: {
          public: createTestSqlNamespace({
            id: 'public',
            entries: {
              table: {
                User: {
                  columns: {},
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                  checks: [{ name: 'legacy_check', expression: 'true' }],
                },
              },
            },
          }),
        },
      }),
      roots: {},
      domain: applicationDomainOf({ models: {} }),
      capabilities: {},
      extensions: {},
      meta: {},
    };

    expect(() =>
      applySqlSpecifierControlPolicy(contract, 'external', createTestSqlNamespace),
    ).toThrow(/column map is empty/);
  });
});

describe('typescriptContract under a specifier default policy', () => {
  it('a loaded contract carries no derived checks and a recomputed hash', async () => {
    const built = buildUser();
    expect(checksOf(built)).toHaveLength(2);

    const config = typescriptContract(built, undefined, {
      defaultControlPolicy: 'external',
      createNamespace: createTestSqlNamespace,
    });
    const result = await config.source.load(stubContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.defaultControlPolicy).toBe('external');
    expect(checksOf(result.value)).toEqual([]);
    expect((result.value.storage as SqlStorage).storageHash).not.toBe(built.storage.storageHash);
  });
});

describe('typescriptContractFromPath under a specifier default policy', () => {
  it(
    'a loaded contract carries no derived checks and a recomputed hash',
    async () => {
      const fixturePath = join(
        fileURLToPath(new URL('.', import.meta.url)),
        'fixtures/managed-user-contract.ts',
      );
      const config = typescriptContractFromPath('./fixtures/managed-user-contract.ts', undefined, {
        defaultControlPolicy: 'external',
        createNamespace: createTestSqlNamespace,
      });
      const result = await config.source.load({ ...stubContext, resolvedInputs: [fixturePath] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.defaultControlPolicy).toBe('external');
      expect(checksOf(result.value)).toEqual([]);
    },
    timeouts.typeScriptCompilation,
  );
});
