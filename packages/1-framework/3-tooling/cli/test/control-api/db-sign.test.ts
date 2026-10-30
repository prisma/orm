import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  SpaceSignature,
  SpaceToSign,
} from '@internal/framework-components/control';
import { DEFAULT_DATABASE_POLICIES } from '@internal/framework-components/control';
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

function space(spaceId: string, contract: Contract, invariants: readonly string[] = []) {
  return createAggregateContractSpace({
    spaceId,
    packages: [],
    refs: {},
    headRef: { hash: contract.storage.storageHash, invariants },
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

function marker(
  storageHash: string,
  invariants: readonly string[] = [],
  meta: Record<string, unknown> = {},
): ContractMarkerRecord {
  return {
    storageHash,
    profileHash: `${storageHash}-profile`,
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(0),
    appTag: null,
    meta,
    invariants: [...invariants],
  };
}

function familySigning(
  signatures: (spaces: readonly SpaceToSign[]) => SpaceSignature[],
  verifies: (contract: unknown) => boolean = () => true,
  markers: ReadonlyMap<string, ContractMarkerRecord> = new Map([['app', marker('old-app')]]),
) {
  const calls: string[] = [];
  const signed: SpaceToSign[][] = [];
  const checkedPolicies: unknown[] = [];
  const familyInstance = blindCast<
    ControlFamilyInstance<string, unknown>,
    'the family methods db sign calls'
  >({
    readAllMarkers: async () => {
      calls.push('readAllMarkers');
      return markers;
    },
    introspect: async () => {
      calls.push('introspect');
      return {};
    },
    verifySchema: ({ contract }: { readonly contract: unknown }) => ({
      ok: verifies(contract),
      summary: 'ok',
      contract: { storageHash: 'x' },
      target: { expected: 'postgres' },
      schema: { issues: [] },
      timings: { total: 0 },
    }),
    markerLocation: 'prisma_contract.marker',
    signSpaces: async ({
      spaces,
      expectedDatabasePolicies,
    }: {
      readonly spaces: readonly SpaceToSign[];
      readonly expectedDatabasePolicies?: unknown;
    }) => {
      calls.push('signSpaces');
      signed.push([...spaces]);
      checkedPolicies.push(expectedDatabasePolicies);
      return signatures(spaces);
    },
  });
  return { familyInstance, calls, signed, checkedPolicies };
}

const driver = blindCast<ControlDriverInstance<string, string>, 'never queried'>({});

const INVOCATION = { cwd: '/work/app', configPath: 'config/prisma.config.ts', dbGiven: true };

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
      invocation: INVOCATION,
    });

    expect(family.calls).toEqual(['readAllMarkers', 'introspect', 'signSpaces']);
    expect(family.checkedPolicies).toEqual([DEFAULT_DATABASE_POLICIES]);
    expect(family.signed).toEqual([
      [
        { space: 'pgvector', contract: extContract, expected: null },
        {
          space: 'app',
          contract: appContract,
          expected: { storageHash: 'old-app', profileHash: 'old-app-profile' },
        },
      ],
    ]);
  });

  it('fails as a concurrent change naming the moved settings when the policies changed after it checked them', async () => {
    const family = familySigning((spaces) => [
      {
        status: 'conflict',
        reason: 'databasePolicies',
        space: 'app',
        contract: signedEverySpace(spaces).find(({ space }) => space === 'app')?.contract ?? {
          storageHash: '',
          profileHash: '',
        },
        checked: DEFAULT_DATABASE_POLICIES,
        comparison: {
          kind: 'moved',
          found: { ...DEFAULT_DATABASE_POLICIES, change: ['migrate'] },
          differences: [
            { setting: 'change', declared: ['migrate', 'reconcile'], inForce: ['migrate'] },
          ],
        },
      },
    ]);

    const result = await signContractSpaces({
      driver,
      familyInstance: family.familyInstance,
      aggregate,
      frameworkComponents: [],
      invocation: INVOCATION,
    });

    const failure = result.assertNotOk();
    expect({
      code: failure.code,
      why: failure.why,
      fix: failure.fix,
      meta: failure.meta,
    }).toEqual({
      code: 'MIGRATION.MARKER_CAS_FAILURE',
      why: "The database's policies changed after db sign checked them: change moved from migrate, reconcile to migrate. db sign did not sign the application space.",
      fix: 'Sign again, which checks the policies anew: {bin} db sign --config config/prisma.config.ts --db <url>',
      meta: {
        reason: 'databasePolicies',
        space: 'app',
        checkedDatabasePolicies: DEFAULT_DATABASE_POLICIES,
        foundDatabasePolicies: { ...DEFAULT_DATABASE_POLICIES, change: ['migrate'] },
      },
    });
  });

  it('reports a space whose marker changed while it ran, beside the spaces it signed', async () => {
    const family = familySigning((spaces) =>
      signedEverySpace(spaces).map((signature) =>
        signature.space === 'app'
          ? {
              status: 'conflict',
              reason: 'storageHash',
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
      invocation: INVOCATION,
    });

    expect(result.assertOk().spaces).toEqual([
      {
        space: 'app',
        status: 'conflict',
        reason: 'storageHash',
        contract: {
          storageHash: appContract.storage.storageHash,
          profileHash: appContract.profileHash,
        },
        expected: { storageHash: 'old-app', profileHash: 'old-app-profile' },
        found: { storageHash: 'moved', profileHash: 'moved-profile' },
      },
      {
        space: 'pgvector',
        status: 'created',
        contract: {
          storageHash: extContract.storage.storageHash,
          profileHash: extContract.profileHash,
        },
      },
    ]);
  });

  it('reports a space that fails verification with both of its contract hashes', async () => {
    const family = familySigning(signedEverySpace, (contract) => contract !== extContract);

    const result = await signContractSpaces({
      driver,
      familyInstance: family.familyInstance,
      aggregate,
      frameworkComponents: [],
      invocation: INVOCATION,
    });

    expect(result.assertOk().spaces[1]).toMatchObject({
      space: 'pgvector',
      status: 'failed',
      contract: {
        storageHash: extContract.storage.storageHash,
        profileHash: extContract.profileHash,
      },
    });
  });

  it('refuses a database whose change policy permits only migrations, before it signs', async () => {
    const family = familySigning(
      signedEverySpace,
      () => true,
      new Map([['app', marker('old-app', [], { policies: { change: ['migrate'] } })]]),
    );

    const result = await signContractSpaces({
      driver,
      familyInstance: family.familyInstance,
      aggregate,
      frameworkComponents: [],
      invocation: INVOCATION,
    });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toMatchObject({
      code: 'MIGRATION.CHANGE_POLICY_FORBIDS',
      why: 'The marker records change: migrate, so db sign may not move it.',
      nextActions: [
        {
          kind: 'user-choice',
          label:
            'Author a migration with {bin} migration plan --config config/prisma.config.ts, then deploy it.',
        },
      ],
      meta: { spaceId: 'app', command: 'db sign', change: ['migrate'] },
    });
    expect(family.calls).toEqual(['readAllMarkers']);
  });

  it('signs a database with no marker, whatever policies a later run declares', async () => {
    const family = familySigning(signedEverySpace, () => true, new Map());

    const result = await signContractSpaces({
      driver,
      familyInstance: family.familyInstance,
      aggregate,
      frameworkComponents: [],
      invocation: INVOCATION,
    });

    expect(result.ok).toBe(true);
    expect(family.calls).toEqual(['readAllMarkers', 'introspect', 'signSpaces']);
  });
});

describe('signContractSpaces with invariants the head ref requires', () => {
  const INSTALL_VECTOR = 'pgvector:install-vector-v1';

  function aggregateWith(extension: ReturnType<typeof space>, app = space('app', appContract)) {
    return createContractSpaceAggregate({
      targetId: 'postgres',
      app,
      extensions: [extension],
      checkIntegrity: () => [],
    });
  }

  it('refuses a space whose marker lacks a required invariant, and writes no marker for it', async () => {
    const family = familySigning(
      signedEverySpace,
      () => true,
      new Map([['pgvector', marker('old-ext')]]),
    );

    const result = await signContractSpaces({
      driver,
      familyInstance: family.familyInstance,
      aggregate: aggregateWith(space('pgvector', extContract, [INSTALL_VECTOR])),
      frameworkComponents: [],
      invocation: INVOCATION,
    });

    expect(family.signed.flat().map((toSign) => toSign.space)).toEqual(['app']);
    expect(result.assertOk().spaces[1]).toEqual({
      space: 'pgvector',
      status: 'missing-invariants',
      contract: {
        storageHash: extContract.storage.storageHash,
        profileHash: extContract.profileHash,
      },
      missingInvariants: [INSTALL_VECTOR],
    });
  });

  it('refuses a space with no marker whose head ref requires an invariant', async () => {
    const family = familySigning(signedEverySpace, () => true, new Map());

    const result = await signContractSpaces({
      driver,
      familyInstance: family.familyInstance,
      aggregate: aggregateWith(space('pgvector', extContract, [INSTALL_VECTOR])),
      frameworkComponents: [],
      invocation: INVOCATION,
    });

    expect(family.signed.flat().map((toSign) => toSign.space)).toEqual(['app']);
    expect(result.assertOk().spaces[1]).toMatchObject({
      space: 'pgvector',
      status: 'missing-invariants',
      missingInvariants: [INSTALL_VECTOR],
    });
  });

  it('signs a space whose marker already records every required invariant', async () => {
    const family = familySigning(
      signedEverySpace,
      () => true,
      new Map([['pgvector', marker('old-ext', [INSTALL_VECTOR, 'pgvector:other'])]]),
    );

    const result = await signContractSpaces({
      driver,
      familyInstance: family.familyInstance,
      aggregate: aggregateWith(space('pgvector', extContract, [INSTALL_VECTOR])),
      frameworkComponents: [],
      invocation: INVOCATION,
    });

    expect(family.signed).toEqual([
      [
        {
          space: 'pgvector',
          contract: extContract,
          expected: { storageHash: 'old-ext', profileHash: 'old-ext-profile' },
        },
        { space: 'app', contract: appContract, expected: null },
      ],
    ]);
    expect(result.assertOk().spaces.map((outcome) => outcome.status)).toEqual([
      'created',
      'created',
    ]);
  });

  it('signs every space when no head ref requires an invariant', async () => {
    const family = familySigning(signedEverySpace);

    const result = await signContractSpaces({
      driver,
      familyInstance: family.familyInstance,
      aggregate,
      frameworkComponents: [],
      invocation: INVOCATION,
    });

    expect(family.calls).toContain('signSpaces');
    expect(result.assertOk().spaces.map((outcome) => outcome.status)).toEqual([
      'created',
      'created',
    ]);
  });

  it('signs the other space when one space is refused', async () => {
    const family = familySigning(signedEverySpace);

    const result = await signContractSpaces({
      driver,
      familyInstance: family.familyInstance,
      aggregate: aggregateWith(space('pgvector', extContract, [INSTALL_VECTOR])),
      frameworkComponents: [],
      invocation: INVOCATION,
    });

    expect(family.signed).toEqual([
      [
        {
          space: 'app',
          contract: appContract,
          expected: { storageHash: 'old-app', profileHash: 'old-app-profile' },
        },
      ],
    ]);
    expect(result.assertOk().spaces).toEqual([
      {
        space: 'app',
        status: 'created',
        contract: {
          storageHash: appContract.storage.storageHash,
          profileHash: appContract.profileHash,
        },
      },
      {
        space: 'pgvector',
        status: 'missing-invariants',
        contract: {
          storageHash: extContract.storage.storageHash,
          profileHash: extContract.profileHash,
        },
        missingInvariants: [INSTALL_VECTOR],
      },
    ]);
  });

  it('reports a space that fails verification as failed beside a refused space', async () => {
    const family = familySigning(signedEverySpace, (contract) => contract !== appContract);

    const result = await signContractSpaces({
      driver,
      familyInstance: family.familyInstance,
      aggregate: aggregateWith(space('pgvector', extContract, [INSTALL_VECTOR])),
      frameworkComponents: [],
      invocation: INVOCATION,
    });

    expect(result.assertOk().spaces.map((outcome) => outcome.status)).toEqual([
      'failed',
      'missing-invariants',
    ]);
  });

  it('reports both the missing invariants and the failed verification of one space', async () => {
    const family = familySigning(signedEverySpace, (contract) => contract !== extContract);

    const result = await signContractSpaces({
      driver,
      familyInstance: family.familyInstance,
      aggregate: aggregateWith(space('pgvector', extContract, [INSTALL_VECTOR])),
      frameworkComponents: [],
      invocation: INVOCATION,
    });

    expect(result.assertOk().spaces[1]).toEqual({
      space: 'pgvector',
      status: 'missing-invariants',
      contract: {
        storageHash: extContract.storage.storageHash,
        profileHash: extContract.profileHash,
      },
      missingInvariants: [INSTALL_VECTOR],
      schema: {
        ok: false,
        summary: 'ok',
        contract: { storageHash: 'x' },
        target: { expected: 'postgres' },
        schema: { issues: [] },
        timings: { total: 0 },
      },
    });
  });

  it('carries no schema result for a refused space that verifies', async () => {
    const family = familySigning(signedEverySpace);

    const result = await signContractSpaces({
      driver,
      familyInstance: family.familyInstance,
      aggregate: aggregateWith(space('pgvector', extContract, [INSTALL_VECTOR])),
      frameworkComponents: [],
      invocation: INVOCATION,
    });

    expect(result.assertOk().spaces[1]).not.toHaveProperty('schema');
  });
});
