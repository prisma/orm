import type { Contract } from '@internal/contract/types';
import type {
  ContractSpace,
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationPackage,
} from '@internal/framework-components/control';
import { PRISMA_SPACE_ID } from '@internal/framework-components/control';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { executeDbVerify } from '../../src/control-api/operations/db-verify';

function migration(from: string | null, to: string): MigrationPackage {
  return {
    dirName: `to-${to}`,
    metadata: { from, to, migrationHash: `hash-${to}`, providedInvariants: [] },
    ops: [],
  } as unknown as MigrationPackage;
}

const installedSpace: ContractSpace = {
  contractJson: createContract(),
  migrations: [migration(null, 'first'), migration('first', 'second')],
  headRef: { hash: 'second', invariants: [] },
};

function verifyWithPrismaRowAt(
  storageHash: string,
  options: {
    readonly target?: { readonly prismaSpace?: ContractSpace };
    readonly invariants?: readonly string[];
    readonly ledgerTo?: readonly string[];
  } = {},
) {
  const { target = { prismaSpace: installedSpace }, invariants = [], ledgerTo = [] } = options;
  const familyInstance = {
    readAllMarkers: async () =>
      new Map([[PRISMA_SPACE_ID, { storageHash, profileHash: 'p', invariants }]]),
    readLedger: async ({ space }: { readonly space?: string }) =>
      ledgerTo.map((to) => ({ space, to })),
    deserializeContract: (json: unknown) => json as Contract,
  } as unknown as ControlFamilyInstance<string, unknown>;
  return executeDbVerify({
    driver: {} as ControlDriverInstance<string, string>,
    familyInstance,
    contract: createContract(),
    migrationsDir: '/tmp/__test-db-verify-prisma-tables',
    targetId: 'postgres',
    extensions: [],
    frameworkComponents: [],
    mode: 'lenient',
    skipSchema: true,
    skipMarker: false,
    ...target,
  });
}

describe('db verify and the Prisma space', () => {
  it("finds nothing when the space's row is at the installed head", async () => {
    expect((await verifyWithPrismaRowAt('second')).assertOk().markerDrift).toBeNull();
  });

  it('says the tables are behind the installed release and names the command that brings them up to date', async () => {
    const drift = (await verifyWithPrismaRowAt('first')).assertOk().markerDrift;

    expect({
      code: drift?.code,
      message: drift?.message,
      fix: drift?.fix,
      meta: drift?.meta,
    }).toEqual({
      code: 'CONTRACT.PRISMA_SPACE_BEHIND',
      message:
        'The records Prisma keeps for itself in this database are not up to date with the installed release of Prisma',
      fix: 'Run `{bin} db migrate`, which brings the records Prisma keeps for itself up to date before it does anything else; `{bin} db init`, `{bin} db update` and `{bin} db sign` do the same.',
      meta: { spaceId: PRISMA_SPACE_ID, markerHash: 'first', headRefHash: 'second' },
    });
  });

  it('finds nothing when a later release of this major version brought the row further', async () => {
    const verified = await verifyWithPrismaRowAt('third', {
      ledgerTo: ['first', 'second', 'third'],
    });

    expect(verified.assertOk().markerDrift).toBeNull();
  });

  it('reports what a command that changes the database would refuse when the ledger never recorded the installed head', async () => {
    const drift = (
      await verifyWithPrismaRowAt('third', { ledgerTo: ['first', 'third'] })
    ).assertOk().markerDrift;

    expect({ code: drift?.code, meta: drift?.meta }).toEqual({
      code: 'MIGRATION.INSTALLED_SPACE_UNREACHABLE',
      meta: {
        spaceId: PRISMA_SPACE_ID,
        markerHash: 'third',
        headRefHash: 'second',
        reason: 'unknownContract',
      },
    });
  });

  it('reports a row a later major version wrote, though the ledger recorded the installed head', async () => {
    const drift = (
      await verifyWithPrismaRowAt('third', {
        invariants: ['_prisma:major-9'],
        ledgerTo: ['first', 'second', 'third'],
      })
    ).assertOk().markerDrift;

    expect({ code: drift?.code, reason: drift?.meta?.['reason'] }).toEqual({
      code: 'MIGRATION.INSTALLED_SPACE_UNREACHABLE',
      reason: 'laterMajor',
    });
  });

  it('does not report the row as one of a space the project does not declare on a target that carries no space', async () => {
    expect(
      (await verifyWithPrismaRowAt('first', { target: {} })).assertOk().markerDrift,
    ).toBeNull();
  });
});
