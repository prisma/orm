import { computeStorageHash } from '@internal/contract/hashing';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type {
  ControlFamilyDescriptor,
  ControlStack,
  ControlTargetDescriptor,
} from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { SqlStorage } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';

const TARGET = 'postgres' as const;
const TARGET_FAMILY = 'sql' as const;

const fixtureTables = {
  fixture_box: {
    columns: {
      x: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
    },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  },
};

export const FIXTURE_HASH = computeStorageHash({
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  storage: {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        entries: { table: fixtureTables },
      },
    },
  },
  ...sqlContractCanonicalizationHooks,
});

export function buildContract(
  hashes: { readonly storageHash: string; readonly profileHash: string } = {
    storageHash: FIXTURE_HASH,
    profileHash: 'fixture-profile-v1',
  },
): Contract<SqlStorage> {
  return {
    target: TARGET,
    targetFamily: TARGET_FAMILY,
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
    profileHash: profileHash(hashes.profileHash),
    storage: new SqlStorage({
      storageHash: coreHash(hashes.storageHash),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: fixtureTables },
        }),
      },
    }),
  };
}

export function makeStack(options?: {
  readonly createAdapter?: () => unknown;
}): ControlStack<'sql', 'postgres'> {
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
      create: (options?.createAdapter ??
        (() => ({ familyId: 'sql', targetId: 'postgres' }))) as unknown as (
        stack: unknown,
      ) => never,
    },
    extensions: [],
  });
}
