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
  target: { readonly prismaTables?: ContractSpace } = { prismaTables: installedSpace },
) {
  const familyInstance = {
    readAllMarkers: async () =>
      new Map([[PRISMA_SPACE_ID, { storageHash, profileHash: 'p', invariants: [] }]]),
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

describe("db verify and the space for Prisma's own tables", () => {
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
      message: "Prisma's own tables in this database are in the form an earlier release left them",
      fix: "Run `{bin} db migrate`, which brings Prisma's own tables up to date before it does anything else; `{bin} db init`, `{bin} db update` and `{bin} db sign` do the same.",
      meta: { spaceId: PRISMA_SPACE_ID, markerHash: 'first', headRefHash: 'second' },
    });
  });

  it('finds nothing when the row records a contract the installed release does not know, which a later release wrote', async () => {
    expect((await verifyWithPrismaRowAt('third')).assertOk().markerDrift).toBeNull();
  });

  it('does not report the row as one of a space the project does not declare on a target that carries no space', async () => {
    expect((await verifyWithPrismaRowAt('first', {})).assertOk().markerDrift).toBeNull();
  });
});
