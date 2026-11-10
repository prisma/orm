import { computeStorageHash } from '@internal/contract/hashing';
import { coreHash, profileHash } from '@internal/contract/types';
import type { ContractSpace, ControlStack } from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { MigrationToolsError } from '@internal/migration-tools/errors';
import { buildMongoNamespace, type MongoContract, MongoStorage } from '@internal/mongo-contract';
import { mongoContractCanonicalizationHooks } from '@internal/mongo-contract/canonicalization-hooks';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { mongoFamilyDescriptor } from '../src/core/control-descriptor';
import { createMongoFamilyInstance } from '../src/core/control-instance';
import type { MongoControlExtensionDescriptor } from '../src/core/control-types';
import { stubMongoTargetDescriptor as mongoTargetDescriptor } from './test-target-descriptor';

const TARGET = 'mongo' as const;
const TARGET_FAMILY = 'mongo' as const;

const fixtureNamespace = buildMongoNamespace({
  id: UNBOUND_NAMESPACE_ID,
  entries: {
    collection: {
      fixture_box: {
        indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }], unique: true }],
      },
    },
  },
});

// Hash over the constructed namespace (not a hand-written literal): the
// self-consistency check recomputes the hash from this same `MongoStorage`
// instance's fields, so both sides must derive from identical data.
const FIXTURE_HEAD_HASH = computeStorageHash({
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  storage: { namespaces: { [UNBOUND_NAMESPACE_ID]: fixtureNamespace } },
  ...mongoContractCanonicalizationHooks,
});

function buildContract(): MongoContract<MongoStorage> {
  return {
    target: TARGET,
    targetFamily: TARGET_FAMILY,
    roots: {},
    domain: applicationDomainOf({}),
    capabilities: {},
    extensions: {},
    meta: {},
    profileHash: profileHash('fixture-profile-v1'),
    storage: new MongoStorage({
      storageHash: coreHash(FIXTURE_HEAD_HASH),
      namespaces: { [UNBOUND_NAMESPACE_ID]: fixtureNamespace },
    }),
  };
}

function buildExtension(opts: {
  readonly id: string;
  readonly headRefHash: string;
}): MongoControlExtensionDescriptor {
  const space: ContractSpace<MongoContract<MongoStorage>> = {
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
    familyId: 'mongo' as const,
    targetId: 'mongo' as const,
    version: '0.0.1',
    contractSpace: space,
    create: () => ({ familyId: 'mongo' as const, targetId: 'mongo' as const }),
  };
}

function makeStack(
  extensions: readonly MongoControlExtensionDescriptor[],
): ControlStack<'mongo', 'mongo'> {
  return createControlStack({
    family: mongoFamilyDescriptor,
    target: mongoTargetDescriptor,
    extensions: extensions,
  });
}

describe('createMongoFamilyInstance descriptor self-consistency', () => {
  it('accepts an extension whose headRef.hash matches the recomputed contract hash', () => {
    const extension = buildExtension({
      id: 'self-consistent-fixture',
      headRefHash: FIXTURE_HEAD_HASH,
    });
    expect(() => createMongoFamilyInstance(makeStack([extension]))).not.toThrow();
  });

  it('rejects an extension with a stale headRef.hash', () => {
    const extension = buildExtension({
      id: 'stale-fixture',
      headRefHash: 'stale-fixture-hash',
    });
    let captured: MigrationToolsError | undefined;
    try {
      createMongoFamilyInstance(makeStack([extension]));
    } catch (error) {
      if (MigrationToolsError.is(error)) captured = error;
    }
    expect(captured?.code).toBe('MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH');
    expect(captured?.why).toContain('"stale-fixture"');
  });

  it('skips extensions without a contractSpace (additivity preserved)', () => {
    const codecOnlyExtension: MongoControlExtensionDescriptor = {
      kind: 'extension' as const,
      id: 'codec-only',
      familyId: 'mongo' as const,
      targetId: 'mongo' as const,
      version: '0.0.1',
      create: () => ({ familyId: 'mongo' as const, targetId: 'mongo' as const }),
    };
    expect(() => createMongoFamilyInstance(makeStack([codecOnlyExtension]))).not.toThrow();
  });

  it('checks every contractSpace-bearing extension', () => {
    const ok = buildExtension({ id: 'ok', headRefHash: FIXTURE_HEAD_HASH });
    const bad = buildExtension({ id: 'second-bad', headRefHash: 'wrong' });
    let captured: MigrationToolsError | undefined;
    try {
      createMongoFamilyInstance(makeStack([ok, bad]));
    } catch (error) {
      if (MigrationToolsError.is(error)) captured = error;
    }
    expect(captured?.why).toContain('"second-bad"');
  });
});
