import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  SpaceSignature,
  SpaceToSign,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  createAggregateContractSpace,
  createContractSpaceAggregate,
} from '@internal/migration-tools/aggregate';
import { blindCast } from '@internal/utils/casts';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { signContractSpaces } from '../../src/control-api/operations/db-sign';

function contractFor(table: string): Contract {
  return createSqlContract({
    target: 'postgres',
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: { [table]: {} } } },
      },
    },
  });
}

const appContract = contractFor('user');
const extContract = contractFor('vector_index');

function space(spaceId: string, contract: Contract) {
  return createAggregateContractSpace({
    spaceId,
    packages: [],
    refs: {},
    headRef: { hash: contract.storage.storageHash, invariants: [] },
    refsDir: `migrations/${spaceId}/refs`,
    migrationsDir: `migrations/${spaceId}`,
    resolveContract: () => contract,
    deserializeContract: (json) => json as Contract,
  });
}

const aggregate = createContractSpaceAggregate({
  targetId: 'postgres',
  app: space('app', appContract),
  extensions: [space('pgvector', extContract)],
  checkIntegrity: () => [],
});

function marker(storageHash: string): ContractMarkerRecord {
  return {
    storageHash,
    profileHash: `${storageHash}-profile`,
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(0),
    appTag: null,
    meta: {},
    invariants: [],
  };
}

function familySigning(signatures: (spaces: readonly SpaceToSign[]) => SpaceSignature[]) {
  const calls: string[] = [];
  const signed: SpaceToSign[][] = [];
  const familyInstance = blindCast<
    ControlFamilyInstance<string, unknown>,
    'the family methods db sign calls'
  >({
    readAllMarkers: async () => {
      calls.push('readAllMarkers');
      return new Map([['app', marker('old-app')]]);
    },
    introspect: async () => {
      calls.push('introspect');
      return {};
    },
    verifySchema: () => ({
      ok: true,
      summary: 'ok',
      contract: { storageHash: 'x' },
      target: { expected: 'postgres' },
      schema: { issues: [] },
      timings: { total: 0 },
    }),
    signSpaces: async ({ spaces }: { readonly spaces: readonly SpaceToSign[] }) => {
      calls.push('signSpaces');
      signed.push([...spaces]);
      return signatures(spaces);
    },
  });
  return { familyInstance, calls, signed };
}

const driver = blindCast<ControlDriverInstance<string, string>, 'never queried'>({});

function signedEverySpace(spaces: readonly SpaceToSign[]): SpaceSignature[] {
  return spaces.map(({ space: spaceId, contract }) => ({
    status: 'created',
    space: spaceId,
    contract: { storageHash: contract.storage.storageHash, profileHash: contract.profileHash },
  }));
}

describe('signContractSpaces', () => {
  it('reads every marker before it introspects, and signs each space against the marker it read', async () => {
    const family = familySigning(signedEverySpace);

    await signContractSpaces({
      driver,
      familyInstance: family.familyInstance,
      aggregate,
      frameworkComponents: [],
    });

    expect(family.calls).toEqual(['readAllMarkers', 'introspect', 'signSpaces']);
    expect(family.signed).toEqual([
      [
        { space: 'pgvector', contract: extContract, verifiedMarker: null },
        {
          space: 'app',
          contract: appContract,
          verifiedMarker: { storageHash: 'old-app', profileHash: 'old-app-profile' },
        },
      ],
    ]);
  });

  it('reports a space whose marker changed while it ran, beside the spaces it signed', async () => {
    const family = familySigning((spaces) =>
      signedEverySpace(spaces).map((signature) =>
        signature.space === 'app'
          ? {
              status: 'conflict',
              space: 'app',
              contract: signature.contract,
              expected: { storageHash: 'old-app', profileHash: 'old-app-profile' },
              found: { storageHash: 'moved', profileHash: 'moved-profile' },
            }
          : signature,
      ),
    );

    const result = await signContractSpaces({
      driver,
      familyInstance: family.familyInstance,
      aggregate,
      frameworkComponents: [],
    });

    expect(result.assertOk().spaces).toEqual([
      {
        space: 'app',
        status: 'conflict',
        contract: {
          storageHash: appContract.storage.storageHash,
          profileHash: appContract.profileHash,
        },
        marker: {
          expected: { storageHash: 'old-app', profileHash: 'old-app-profile' },
          found: { storageHash: 'moved', profileHash: 'moved-profile' },
        },
      },
      {
        space: 'pgvector',
        status: 'signed',
        contract: {
          storageHash: extContract.storage.storageHash,
          profileHash: extContract.profileHash,
        },
        marker: { created: true, updated: false },
      },
    ]);
  });
});
