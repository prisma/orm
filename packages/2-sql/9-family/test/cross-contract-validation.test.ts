import { computeStorageHash } from '@internal/contract/hashing';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type {
  ContractSpace,
  ControlFamilyDescriptor,
  ControlStack,
  ControlTargetDescriptor,
} from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { SqlStorage } from '@internal/sql-contract/types';
import { isStructuredError } from '@internal/utils/structured-error';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import { createSqlFamilyInstance } from '../src/core/control-instance';
import type { SqlControlExtensionDescriptor } from '../src/core/migrations/types';

const TARGET = 'postgres' as const;
const TARGET_FAMILY = 'sql' as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildContract(
  tables: Record<string, unknown>,
  extensions: Record<string, unknown> = {},
  foreignKeys: unknown[] = [],
): Contract<SqlStorage> {
  const allTables = Object.fromEntries(
    Object.entries(tables).map(([name, cols]) => [
      name,
      {
        columns: cols as Record<string, unknown>,
        uniques: [],
        indexes: [],
        foreignKeys: foreignKeys.filter(
          (fk) => (fk as { source: { tableName: string } }).source.tableName === name,
        ),
      },
    ]),
  );

  const hash = computeStorageHash({
    target: TARGET,
    targetFamily: TARGET_FAMILY,
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: allTables },
        },
      },
    },
    ...sqlContractCanonicalizationHooks,
  });

  return {
    target: TARGET,
    targetFamily: TARGET_FAMILY,
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions,
    meta: {},
    profileHash: profileHash('fixture-profile-v1'),
    storage: new SqlStorage({
      storageHash: coreHash(hash),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: allTables as never },
        }),
      },
    }),
  };
}

function buildExtension(opts: {
  readonly id: string;
  readonly tables?: Record<string, unknown>;
  readonly extensions?: Record<string, unknown>;
  readonly foreignKeys?: unknown[];
}): SqlControlExtensionDescriptor<'postgres'> {
  const tables = opts.tables ?? {};
  const fks = opts.foreignKeys ?? [];
  const contract = buildContract(tables, opts.extensions ?? {}, fks);
  const hash = contract.storage.storageHash as string;

  return {
    kind: 'extension' as const,
    id: opts.id,
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    version: '0.0.1',
    contractSpace: {
      contractJson: contract,
      migrations: [],
      headRef: { hash, invariants: [] },
    } satisfies ContractSpace<Contract<SqlStorage>>,
    create: () => ({ familyId: 'sql' as const, targetId: 'postgres' as const }),
  };
}

function buildExtensionWithCrossSpaceFK(opts: {
  readonly id: string;
  readonly targetSpaceId: string;
  readonly dependsOn?: readonly string[];
}): SqlControlExtensionDescriptor<'postgres'> {
  const localTable = `${opts.id.replace(/-/g, '_')}_table`;
  const extensions = opts.dependsOn
    ? Object.fromEntries(opts.dependsOn.map((dep) => [dep, {}]))
    : {};

  const tables = {
    [localTable]: {
      id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
      ref_id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
    },
  };

  const fks = [
    {
      source: {
        namespaceId: UNBOUND_NAMESPACE_ID,
        tableName: localTable,
        columns: ['ref_id'],
      },
      target: {
        namespaceId: UNBOUND_NAMESPACE_ID,
        tableName: 'remote_table',
        columns: ['id'],
        spaceId: opts.targetSpaceId,
      },
    },
  ];

  return buildExtension({ id: opts.id, tables, extensions, foreignKeys: fks });
}

function makeStack(
  extensions: readonly SqlControlExtensionDescriptor<'postgres'>[],
): ControlStack<'sql', 'postgres'> {
  return createControlStack({
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '0.0.1',
      create: (() => ({})) as unknown as ControlFamilyDescriptor<'sql'>['create'],
      emission: {
        id: 'sql',
        generateStorageType: () => '{ readonly storageHash: StorageHash }',
        generateModelStorageType: () => 'Record<string, never>',
        getFamilyImports: () => [],
        getFamilyTypeAliases: () => '',
        getTypeMapsExpression: () => 'unknown',
        getContractWrapper: (base: string) => `export type Contract = ${base};`,
      },
    },
    target: {
      kind: 'target',
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      contractSerializer: {
        deserializeContract: (json) => json as never,
        serializeContract: (contract) => contract as never,
      },
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    } as ControlTargetDescriptor<'sql', 'postgres'>,
    adapter: {
      kind: 'adapter',
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    },
    extensions: extensions,
  });
}

// ---------------------------------------------------------------------------
// (B) Reverse-reference rejection
// ---------------------------------------------------------------------------

describe('cross-space FK reverse-reference rejection', () => {
  it('accepts an extension with a cross-space FK pointing at an independent space (no dependency)', () => {
    // ext-posts has a cross-space FK to 'auth-service', which is not in the extension set
    // This simulates an app-level reference pointing outward — should be fine if it's the app
    // OR if the target space has no dependency on the source space
    const ext = buildExtensionWithCrossSpaceFK({
      id: 'posts',
      targetSpaceId: 'auth-service',
    });
    expect(() => createSqlFamilyInstance(makeStack([ext]))).not.toThrow();
  });

  it('accepts a normal dependency-direction FK: ext-A references ext-B which A depends on', () => {
    // ext-a depends on ext-b; ext-a has FK pointing at ext-b — correct direction
    const extB = buildExtension({
      id: 'ext-b',
      tables: { users: { id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false } } },
    });
    const extA = buildExtensionWithCrossSpaceFK({
      id: 'ext-a',
      targetSpaceId: 'ext-b',
      dependsOn: ['ext-b'],
    });
    expect(() => createSqlFamilyInstance(makeStack([extA, extB]))).not.toThrow();
  });

  it('rejects an extension with a cross-space FK that points AGAINST the dependency direction', () => {
    // ext-b depends on ext-a; ext-a has a FK pointing at ext-b (ext-b depends on ext-a, so ext-a→ext-b is a reverse reference)
    const extA = buildExtensionWithCrossSpaceFK({
      id: 'ext-a',
      targetSpaceId: 'ext-b',
    });
    const extB = buildExtension({
      id: 'ext-b',
      tables: { users: { id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false } } },
      extensions: { 'ext-a': {} },
    });
    expect(() => createSqlFamilyInstance(makeStack([extA, extB]))).toThrow(/ext-a/);
    expect(() => createSqlFamilyInstance(makeStack([extA, extB]))).toThrow(/ext-b/);
  });

  it('names both the offending extension and the target space in the reverse-reference error', () => {
    const extA = buildExtensionWithCrossSpaceFK({
      id: 'ext-a',
      targetSpaceId: 'ext-b',
    });
    const extB = buildExtension({
      id: 'ext-b',
      tables: { users: { id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false } } },
      extensions: { 'ext-a': {} },
    });
    const msg = (() => {
      try {
        createSqlFamilyInstance(makeStack([extA, extB]));
        return '';
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    })();
    expect(msg).toMatch(/ext-a/);
    expect(msg).toMatch(/ext-b/);
    expect(msg).toMatch(/reverse|direction|dependency/i);
  });

  it('raises CONTRACT.FOREIGN_KEY_INVALID for a reverse-reference FK', () => {
    const extA = buildExtensionWithCrossSpaceFK({
      id: 'ext-a',
      targetSpaceId: 'ext-b',
    });
    const extB = buildExtension({
      id: 'ext-b',
      tables: { users: { id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false } } },
      extensions: { 'ext-a': {} },
    });
    const error = (() => {
      try {
        createSqlFamilyInstance(makeStack([extA, extB]));
        return undefined;
      } catch (err) {
        return err;
      }
    })();
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.FOREIGN_KEY_INVALID',
      meta: { extensionId: 'ext-a', targetSpaceId: 'ext-b' },
    });
  });

  it('accepts an extension with a local FK (no spaceId)', () => {
    const extA = buildExtension({
      id: 'ext-a',
      tables: {
        posts: {
          id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
          user_id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
        },
        users: { id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false } },
      },
      foreignKeys: [
        {
          source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'posts', columns: ['user_id'] },
          target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'users', columns: ['id'] },
        },
      ],
    });
    expect(() => createSqlFamilyInstance(makeStack([extA]))).not.toThrow();
  });
});
