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
import { MigrationToolsError } from '@internal/migration-tools/errors';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { SqlStorage } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import { createSqlFamilyInstance } from '../src/core/control-instance';
import type { SqlControlExtensionDescriptor } from '../src/core/migrations/types';

const TARGET = 'postgres' as const;
const TARGET_FAMILY = 'sql' as const;

const fixtureTables = {
  fixture_box: {
    columns: {
      x: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
      y: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
    },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  },
};

const fixtureHashBody = {
  namespaces: {
    [UNBOUND_NAMESPACE_ID]: {
      id: UNBOUND_NAMESPACE_ID,
      entries: { table: fixtureTables },
    },
  },
};

const fixtureStorageBody = {
  namespaces: {
    [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
      id: UNBOUND_NAMESPACE_ID,
      entries: { table: fixtureTables },
    }),
  },
};

const FIXTURE_HEAD_HASH = computeStorageHash({
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  storage: fixtureHashBody,
  ...sqlContractCanonicalizationHooks,
});

function buildContract(): Contract<SqlStorage> {
  return {
    target: TARGET,
    targetFamily: TARGET_FAMILY,
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
    profileHash: profileHash('fixture-profile-v1'),
    storage: new SqlStorage({
      ...fixtureStorageBody,
      storageHash: coreHash(FIXTURE_HEAD_HASH),
    }),
  };
}

function buildExtension(opts: {
  readonly id: string;
  readonly headRefHash: string;
}): SqlControlExtensionDescriptor<'postgres'> {
  const space: ContractSpace<Contract<SqlStorage>> = {
    contractJson: buildContract(),
    migrations: [],
    headRef: {
      hash: opts.headRefHash,
      invariants: [],
    },
  };
  return {
    kind: 'extension' as const,
    id: opts.id,
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    version: '0.0.1',
    contractSpace: space,
    create: () => ({ familyId: 'sql' as const, targetId: 'postgres' as const }),
  };
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

describe('createSqlFamilyInstance descriptor self-consistency', () => {
  it('accepts an extension whose headRef.hash matches the recomputed contract hash', () => {
    const extension = buildExtension({
      id: 'self-consistent-fixture',
      headRefHash: FIXTURE_HEAD_HASH,
    });
    expect(() => createSqlFamilyInstance(makeStack([extension]))).not.toThrow();
  });

  it('rejects an extension with a stale headRef.hash', () => {
    const extension = buildExtension({
      id: 'stale-fixture',
      headRefHash: 'stale-fixture-hash',
    });
    let captured: MigrationToolsError | undefined;
    try {
      createSqlFamilyInstance(makeStack([extension]));
    } catch (error) {
      if (MigrationToolsError.is(error)) captured = error;
    }
    expect(captured?.code).toBe('MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH');
    expect(captured?.why).toContain('"stale-fixture"');
  });

  it('skips extensions without a contractSpace (additivity preserved)', () => {
    const codecOnlyExtension: SqlControlExtensionDescriptor<'postgres'> = {
      kind: 'extension' as const,
      id: 'codec-only',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      version: '0.0.1',
      create: () => ({ familyId: 'sql' as const, targetId: 'postgres' as const }),
    };
    expect(() => createSqlFamilyInstance(makeStack([codecOnlyExtension]))).not.toThrow();
  });

  it('checks every contractSpace-bearing extension', () => {
    const ok = buildExtension({ id: 'ok', headRefHash: FIXTURE_HEAD_HASH });
    const bad = buildExtension({ id: 'second-bad', headRefHash: 'wrong' });
    let captured: MigrationToolsError | undefined;
    try {
      createSqlFamilyInstance(makeStack([ok, bad]));
    } catch (error) {
      if (MigrationToolsError.is(error)) captured = error;
    }
    expect(captured?.why).toContain('"second-bad"');
  });
});
