import { computeStorageHash } from '@internal/contract/hashing';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type {
  ControlFamilyDescriptor,
  ControlStack,
  ControlTargetDescriptor,
  SchemaDiffIssue,
} from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import { isStructuredError } from '@internal/utils/structured-error';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type { SqlControlAdapter } from '../src/core/control-adapter';
import { createSqlFamilyInstance } from '../src/core/control-instance';

const TARGET = 'postgres' as const;
const TARGET_FAMILY = 'sql' as const;

const fixtureTables = {
  fixture_box: {
    columns: {
      x: { codecId: 'pg/int4@1', nativeType: 'integer', nullable: false },
    },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  },
};

const FIXTURE_HASH = computeStorageHash({
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
      storageHash: coreHash(FIXTURE_HASH),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: fixtureTables },
        }),
      },
    }),
  };
}

function makeStack(options?: {
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

function captureError(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('sql family instance structured error codes', () => {
  it('raises CONTRACT.INFER_UNSUPPORTED when the target descriptor has no inferPslContract', () => {
    const instance = createSqlFamilyInstance(makeStack());
    const error = captureError(() => instance.inferPslContract?.(undefined as never));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.INFER_UNSUPPORTED',
      meta: { targetId: 'postgres' },
    });
  });

  it('raises CONTRACT.CONVERT_UNSUPPORTED when the target descriptor has no printPslContract', () => {
    const instance = createSqlFamilyInstance(makeStack());
    const error = captureError(() => instance.printPslContract?.(undefined as never));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.CONVERT_UNSUPPORTED',
      meta: { targetId: 'postgres' },
    });
  });

  it('raises CONTRACT.PACK_CONTRIBUTION_INVALID when a required classifier descriptor operation is missing', () => {
    const instance = createSqlFamilyInstance(makeStack());
    const error = captureError(() => instance.classifySubjectGranularity?.({} as SchemaDiffIssue));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
      meta: { targetId: 'postgres', operation: 'classifySubjectGranularity' },
    });
  });

  it('raises MIGRATION.MARKER_CAS_FAILURE when the marker CAS update loses the race during sign', async () => {
    const adapterStub = {
      familyId: 'sql',
      targetId: 'postgres',
      bootstrapSignMarkerQueries: () => [],
      readMarker: async () => ({
        storageHash: 'stale-hash',
        profileHash: 'stale-profile',
        contractJson: null,
        updatedAt: new Date(),
        invariants: [],
      }),
      updateMarker: async () => false,
    } as unknown as SqlControlAdapter<string>;
    const instance = createSqlFamilyInstance(makeStack({ createAdapter: () => adapterStub }));

    const driver = {} as SqlControlDriverInstance<string>;
    const error = await instance
      .sign({ driver, contract: buildContract(), contractPath: 'contract.json' })
      .then(() => {
        throw new Error('expected sign() to reject');
      })
      .catch((err: unknown) => err);

    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'MIGRATION.MARKER_CAS_FAILURE',
      message: 'CAS conflict: marker was modified by another process during sign',
    });
  });
});
