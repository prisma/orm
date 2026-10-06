/**
 * Supabase extension `/contract` branded handles
 *
 * Tests for the branded model handles exported from
 * `@internal/extension-supabase/contract`:
 *
 * 1. Brand/coordinate assertions: `AuthUser` carries `spaceId:'supabase'`,
 *    namespace `auth`, table `users`, and `AuthUser.refs.id` carries the
 *    expected cross-space `TargetFieldRef` coordinates.
 *
 * 2. Lowering smoke test (AC1): a `defineContract` fixture with
 *    `extensions:[supabasePack]`, a `Profile` model with
 *    `rel.belongsTo(AuthUser, …)` and
 *    `constraints.foreignKey(cols.userId, AuthUser.refs.id, { onDelete:'cascade' })`
 *    lowers to a storage `ForeignKeyReference` with `spaceId:'supabase'` +
 *    resolved `auth`/`users`/`id`, and the domain relation is the
 *    non-navigable cross-space relation.
 *
 * 3. Handle↔contract consistency: `AuthUser` / `AuthIdentity` / `StorageBucket`
 *    / `StorageObject` each agree with the shipped `contract.json` on namespace,
 *    table name, column names, and model name (key in contract.json domain).
 *
 * 4. extensionModel factory: a handle built via `extensionModel` carries the
 *    same brand/coordinate as one built by hand.
 */
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import type { TargetFieldRef } from '@internal/sql-contract-ts/contract-builder';
import {
  defineContract,
  extensionModel,
  field,
  model,
  rel,
} from '@internal/sql-contract-ts/contract-builder';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createTestSqlNamespace } from '../../../2-sql/1-core/contract/test/test-support';
import { testTypeLookups } from '../../../2-sql/1-core/contract/test/test-type-lookups';
import contractJson from '../src/contract/contract.json' with { type: 'json' };
import { AuthIdentity, AuthUser, StorageBucket, StorageObject } from '../src/exports/contract';
import supabasePack from '../src/exports/pack';

const bareFamilyPack: FamilyPackRef<'sql'> = {
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

// ---------------------------------------------------------------------------
// 1. Brand / coordinate assertions
// ---------------------------------------------------------------------------

describe('AuthUser handle — brand and coordinate', () => {
  it('carries spaceId "supabase"', () => {
    expect(AuthUser.spaceId).toBe('supabase');
  });

  it('carries namespace "auth"', () => {
    expect(AuthUser.stageOne.namespace).toBe('auth');
  });

  it('carries table "users"', () => {
    expect(AuthUser.tableName).toBe('users');
  });

  it('refs.id is a cross-space TargetFieldRef branded "supabase"', () => {
    expectTypeOf(AuthUser.refs.id).toEqualTypeOf<TargetFieldRef<'AuthUser', 'id', 'supabase'>>();
    expect(AuthUser.refs.id.spaceId).toBe('supabase');
    expect(AuthUser.refs.id.namespaceId).toBe('auth');
    expect(AuthUser.refs.id.tableName).toBe('users');
  });
});

describe('AuthIdentity handle — brand and coordinate', () => {
  it('carries spaceId "supabase", namespace "auth", table "identities"', () => {
    expect(AuthIdentity.spaceId).toBe('supabase');
    expect(AuthIdentity.stageOne.namespace).toBe('auth');
    expect(AuthIdentity.tableName).toBe('identities');
  });
});

describe('StorageBucket handle — brand and coordinate', () => {
  it('carries spaceId "supabase", namespace "storage", table "buckets"', () => {
    expect(StorageBucket.spaceId).toBe('supabase');
    expect(StorageBucket.stageOne.namespace).toBe('storage');
    expect(StorageBucket.tableName).toBe('buckets');
  });
});

describe('StorageObject handle — brand and coordinate', () => {
  it('carries spaceId "supabase", namespace "storage", table "objects"', () => {
    expect(StorageObject.spaceId).toBe('supabase');
    expect(StorageObject.stageOne.namespace).toBe('storage');
    expect(StorageObject.tableName).toBe('objects');
  });
});

// ---------------------------------------------------------------------------
// 2. Lowering smoke test (AC1 — real extension, FK + relation)
// ---------------------------------------------------------------------------

describe('lowering smoke test — FK + relation to AuthUser via real supabasePack', () => {
  function buildProfileContract() {
    const Profile = model('Profile', {
      fields: {
        id: field.column({ codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false }).id(),
        userId: field.column({ codecId: 'pg/text@1', dataType: 'pg/text', nullable: false }),
      },
      relations: {
        user: rel.belongsTo(AuthUser, { from: 'userId', to: 'id' }),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'profile',
      foreignKeys: [constraints.foreignKey(cols.userId, AuthUser.refs.id, { onDelete: 'cascade' })],
    }));

    return defineContract({
      ...testTypeLookups,
      family: bareFamilyPack,
      target: postgresTargetPack,
      extensions: { supabase: supabasePack },
      models: { Profile },
      createNamespace: createTestSqlNamespace,
    });
  }

  it('lowers the FK with spaceId "supabase", namespace "auth", table "users", column "id"', () => {
    const contract = buildProfileContract();
    const profileTable = contract.storage.namespaces['public']!.entries.table?.['profile'];
    expect(profileTable).toBeDefined();
    const fks = profileTable?.foreignKeys;
    expect(fks).toHaveLength(1);
    const fk = fks![0]!;
    expect(fk.target.spaceId).toBe('supabase');
    expect(fk.target.namespaceId).toBe('auth');
    expect(fk.target.tableName).toBe('users');
    expect(fk.target.columns).toEqual(['id']);
  });

  it('cascade action passes through the FK without error', () => {
    const contract = buildProfileContract();
    const profileTable = contract.storage.namespaces['public']!.entries.table?.['profile'];
    const fk = profileTable?.foreignKeys?.[0];
    expect(fk?.onDelete).toBe('cascade');
  });

  it('the cross-space relation appears in the contract domain', () => {
    const contract = buildProfileContract();
    const profileDomain = contract.domain.namespaces['public']?.models['Profile'];
    expect(profileDomain).toBeDefined();
    const userRelation = profileDomain?.relations['user'] as Record<string, unknown> | undefined;
    expect(userRelation).toBeDefined();
  });

  it('the cross-space relation carries to.space "supabase"', () => {
    const contract = buildProfileContract();
    const profileDomain = contract.domain.namespaces['public']?.models['Profile'];
    const userRelation = profileDomain?.relations['user'] as Record<string, unknown> | undefined;
    const to = userRelation?.['to'] as Record<string, unknown> | undefined;
    expect(to?.['space']).toBe('supabase');
    expect(to?.['namespace']).toBe('auth');
    expect(to?.['model']).toBe('AuthUser');
  });
});

// ---------------------------------------------------------------------------
// 3. Handle↔contract consistency
// ---------------------------------------------------------------------------

type ContractJsonDomain = {
  namespaces: Record<
    string,
    {
      models: Record<
        string,
        { storage: { table: string; fields: Record<string, { column: string }> } }
      >;
    }
  >;
};

describe('handle↔contract.json consistency', () => {
  const domain = contractJson.domain as unknown as ContractJsonDomain;

  // `handles.ts` keys its `fields` record by physical column name (it builds
  // `TargetFieldRef`s against real DB columns), while the generated
  // contract's domain fields are keyed by the inferred (camelCased) field
  // name with a `column` property carrying the physical name. `handles.ts`
  // is also a curated legacy subset — not every column of the fuller
  // generated contract has a handle. So the check compares
  // handles.ts's column keys against the *set of `column` values* the
  // contract declares (subset, not exact-equal), which catches drift/
  // renames without demanding full column parity.
  function expectHandleColumnsSubsetOfContract(
    handleFields: Record<string, unknown>,
    jsonFields: Record<string, { column: string }>,
  ) {
    const jsonColumns = new Set(Object.values(jsonFields).map((field) => field.column));
    for (const column of Object.keys(handleFields)) {
      expect(jsonColumns.has(column), `expected contract.json to declare column "${column}"`).toBe(
        true,
      );
    }
  }

  it('AuthUser modelName, namespace, table, and columns match contract.json', () => {
    const jsonModel = domain.namespaces['auth']?.models['AuthUser'];
    expect(jsonModel).toBeDefined();
    expect(AuthUser.stageOne.modelName).toBe('AuthUser');
    expect(AuthUser.stageOne.namespace).toBe('auth');
    expect(AuthUser.tableName).toBe(jsonModel!.storage.table);
    expectHandleColumnsSubsetOfContract(AuthUser.stageOne.fields, jsonModel!.storage.fields);
  });

  it('AuthIdentity modelName, namespace, table, and columns match contract.json', () => {
    const jsonModel = domain.namespaces['auth']?.models['AuthIdentity'];
    expect(jsonModel).toBeDefined();
    expect(AuthIdentity.stageOne.modelName).toBe('AuthIdentity');
    expect(AuthIdentity.stageOne.namespace).toBe('auth');
    expect(AuthIdentity.tableName).toBe(jsonModel!.storage.table);
    expectHandleColumnsSubsetOfContract(AuthIdentity.stageOne.fields, jsonModel!.storage.fields);
  });

  it('StorageBucket modelName, namespace, table, and columns match contract.json', () => {
    const jsonModel = domain.namespaces['storage']?.models['StorageBucket'];
    expect(jsonModel).toBeDefined();
    expect(StorageBucket.stageOne.modelName).toBe('StorageBucket');
    expect(StorageBucket.stageOne.namespace).toBe('storage');
    expect(StorageBucket.tableName).toBe(jsonModel!.storage.table);
    expectHandleColumnsSubsetOfContract(StorageBucket.stageOne.fields, jsonModel!.storage.fields);
  });

  it('StorageObject modelName, namespace, table, and columns match contract.json', () => {
    const jsonModel = domain.namespaces['storage']?.models['StorageObject'];
    expect(jsonModel).toBeDefined();
    expect(StorageObject.stageOne.modelName).toBe('StorageObject');
    expect(StorageObject.stageOne.namespace).toBe('storage');
    expect(StorageObject.tableName).toBe(jsonModel!.storage.table);
    expectHandleColumnsSubsetOfContract(StorageObject.stageOne.fields, jsonModel!.storage.fields);
  });
});

// ---------------------------------------------------------------------------
// 4. extensionModel factory
// ---------------------------------------------------------------------------

describe('extensionModel factory', () => {
  const pgText = { codecId: 'pg/text@1' } as const;

  it('produces a handle with the same brand/coordinate as a hand-constructed one', () => {
    const handle = extensionModel(
      'TestModel',
      { namespace: 'auth', fields: { id: field.column(pgText).id() }, table: 'test_models' },
      'supabase' as const,
    );

    expect(handle.stageOne.modelName).toBe('TestModel');
    expect(handle.spaceId).toBe('supabase');
    expect(handle.stageOne.namespace).toBe('auth');
    expect(handle.tableName).toBe('test_models');
    expect(handle.refs.id.spaceId).toBe('supabase');
    expect(handle.refs.id.namespaceId).toBe('auth');
    expect(handle.refs.id.tableName).toBe('test_models');
  });

  it('refs carry the correct type-level brand', () => {
    const handle = extensionModel(
      'TestModel',
      { namespace: 'auth', fields: { id: field.column(pgText).id() }, table: 'test_models' },
      'supabase' as const,
    );
    expectTypeOf(handle.refs.id).toEqualTypeOf<TargetFieldRef<'TestModel', 'id', 'supabase'>>();
  });
});
