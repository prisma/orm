import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { defineContract } from '../src/contract-builder';

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'sql'>;

const documentFamilyPack = {
  kind: 'family',
  id: 'document',
  familyId: 'document',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'document'>;

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const pgvectorExtensionPack = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
} as const satisfies ExtensionPackRef<'sql', 'postgres'>;

const mysqlExtensionPack = {
  ...pgvectorExtensionPack,
  targetId: 'mysql',
} as const satisfies ExtensionPackRef<'sql', 'mysql'>;

function unsafeExtensionPackRefForRuntimeTest<FamilyId extends string, TargetId extends string>(
  pack: FamilyPackRef<string> | TargetPackRef<string, string> | ExtensionPackRef<string, string>,
): ExtensionPackRef<FamilyId, TargetId> {
  // These runtime-guard tests intentionally bypass the static pack-ref contract so they can
  // assert the error paths for invalid inputs that well-typed authoring code cannot produce.
  return pack as unknown as ExtensionPackRef<FamilyId, TargetId>;
}

describe('defineContract runtime guards', () => {
  it.each([
    {
      name: 'non-SQL family packs',
      run: () =>
        defineContract({
          ...testTypeLookups,
          family: documentFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
          models: {},
        }),
      error: 'defineContract only accepts SQL family packs. Received family "document".',
      code: 'CONTRACT.PACK_FAMILY_MISMATCH',
    },
    {
      name: 'a target pack from another family',
      run: () =>
        defineContract({
          ...testTypeLookups,
          family: sqlFamilyPack,
          target: { ...postgresTargetPack, familyId: 'document' } as unknown as TargetPackRef<
            'sql',
            'postgres'
          >,
          createNamespace: createTestSqlNamespace,
          models: {},
        }),
      error: 'target pack "postgres" targets family "document" but contract family is "sql".',
      code: 'CONTRACT.PACK_FAMILY_MISMATCH',
    },
    {
      name: 'non-extension pack refs in extensions',
      run: () =>
        defineContract({
          ...testTypeLookups,
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
          extensions: {
            invalid: unsafeExtensionPackRefForRuntimeTest(postgresTargetPack),
          },
          models: {},
        }),
      error:
        'defineContract only accepts extension pack refs in extensions. Received kind "target".',
      code: 'CONTRACT.PACK_REF_INVALID',
    },
    {
      name: 'extension packs from another family',
      run: () =>
        defineContract({
          ...testTypeLookups,
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
          extensions: {
            invalid: unsafeExtensionPackRefForRuntimeTest({
              ...pgvectorExtensionPack,
              familyId: 'document',
            }),
          },
          models: {},
        }),
      error:
        'extension pack "pgvector" targets family "document" but contract target family is "sql".',
      code: 'CONTRACT.PACK_FAMILY_MISMATCH',
    },
    {
      name: 'extension packs for another target',
      run: () =>
        defineContract({
          ...testTypeLookups,
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
          extensions: {
            invalid: mysqlExtensionPack,
          },
          models: {},
        }),
      error: 'extension pack "pgvector" targets "mysql" but contract target is "postgres".',
      code: 'CONTRACT.PACK_TARGET_MISMATCH',
    },
  ])('rejects $name', ({ run, error, code }) => {
    expect(run).toThrow(error);
    expect(run).toThrow(expect.objectContaining({ code }));
  });
});

describe('defineContract namespace declaration runtime guards', () => {
  const sqliteTargetPack = {
    kind: 'target',
    id: 'sqlite',
    familyId: 'sql',
    targetId: 'sqlite',
    version: '0.0.1',
    defaultNamespaceId: '__unbound__',
  } as const satisfies TargetPackRef<'sql', 'sqlite'>;

  it('accepts an empty namespaces list and treats it as no-op', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: [],
        createNamespace: createTestSqlNamespace,
        models: {},
      }),
    ).not.toThrow();
  });

  it('accepts user-declared Postgres schema names with a `createNamespace` factory', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['public', 'auth'],
        createNamespace: createTestSqlNamespace,
        models: {},
      }),
    ).not.toThrow();

    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['public', 'auth'],
        createNamespace: createTestSqlNamespace,
        models: {},
      }),
    ).not.toThrow();
  });

  it('rejects the reserved IR sentinel `__unbound__` in the declared namespaces list', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['__unbound__'],
        createNamespace: createTestSqlNamespace,
        models: {},
      }),
    ).toThrow(/__unbound__.*reserved/i);

    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['__unbound__'],
        createNamespace: createTestSqlNamespace,
        models: {},
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.NAMESPACE_INVALID' }));
  });

  it('rejects the reserved parser-synthesised sentinel `__unspecified__` in the declared namespaces list', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['__unspecified__'],
        createNamespace: createTestSqlNamespace,
        models: {},
      }),
    ).toThrow(/__unspecified__.*reserved/i);
  });

  it('rejects Postgres-specific reserved keyword `unbound` in the declared namespaces list', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['unbound'],
        createNamespace: createTestSqlNamespace,
        models: {},
      }),
    ).toThrow(/unbound.*reserved.*Postgres|Postgres.*unbound.*reserved/i);
  });

  it('rejects duplicate namespace names', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['auth', 'public', 'auth'],
        createNamespace: createTestSqlNamespace,
        models: {},
      }),
    ).toThrow(/duplicate.*auth/i);

    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['auth', 'public', 'auth'],
        createNamespace: createTestSqlNamespace,
        models: {},
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.NAME_DUPLICATE' }));
  });

  it('rejects empty / whitespace-only namespace names', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: [''],
        createNamespace: createTestSqlNamespace,
        models: {},
      }),
    ).toThrow(/empty/i);

    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['   '],
        createNamespace: createTestSqlNamespace,
        models: {},
      }),
    ).toThrow(/whitespace|empty/i);
  });

  it('on SQLite, rejects any non-empty namespaces list (SQLite has no schema concept)', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: sqliteTargetPack,
        namespaces: ['auth'],
        createNamespace: createTestSqlNamespace,
        models: {},
      }),
    ).toThrow(/SQLite/);
  });

  it('on SQLite, accepts an empty namespaces list (the no-op default)', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: sqliteTargetPack,
        namespaces: [],
        createNamespace: createTestSqlNamespace,
        models: {},
      }),
    ).not.toThrow();
  });
});
