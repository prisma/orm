import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type {
  ContractSpace,
  ControlFamilyDescriptor,
  ControlFamilyInstance,
  ControlTargetDescriptor,
} from '@internal/framework-components/control';
import {
  type MigrationPackage,
  type MigrationRunnerFailure,
  migrationRunnerFailure,
  PRISMA_SPACE_ID,
} from '@internal/framework-components/control';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { notOk, ok } from '@internal/utils/result';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createControlClient } from '../../src/control-api/client';
import { createMockComponents } from './client-fixtures';

const PRISMA_TABLES_HEAD = 'prisma-tables-head';

const installedSpace: ContractSpace = {
  contractJson: createContract(),
  migrations: [],
  headRef: { hash: PRISMA_TABLES_HEAD, invariants: [] },
};

const createMetadata = {
  from: null,
  to: PRISMA_TABLES_HEAD,
  providedInvariants: [],
  createdAt: '2026-11-27T00:00:00.000Z',
};
const createOps = [{ id: 'create', label: 'Create', operationClass: 'additive' }] as const;
const spaceWithAMigration: ContractSpace = {
  ...installedSpace,
  migrations: [
    {
      dirName: '20261127T0000_create',
      metadata: {
        ...createMetadata,
        migrationHash: computeMigrationHash(createMetadata, createOps),
      },
      ops: createOps,
    } satisfies MigrationPackage,
  ],
};

function markerAt(storageHash: string, invariants: readonly string[] = []): ContractMarkerRecord {
  return {
    storageHash,
    profileHash: 'profile',
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date('2026-11-27T00:00:00.000Z'),
    appTag: null,
    meta: {},
    invariants,
  };
}

/** A client over a family that records every marker read, and a target that carries `contractSpace` when given one. */
function clientWith(
  contractSpace: ContractSpace | undefined,
  options: {
    readonly prismaRow?: ContractMarkerRecord | null;
    readonly runnerFailure?: MigrationRunnerFailure;
  } = {},
) {
  const { prismaRow = markerAt(PRISMA_TABLES_HEAD) } = options;
  const { mockFamilyInstance, mockAdapter, mockDriverDescriptor } = createMockComponents();
  const reads: string[] = [];
  const familyInstance = {
    ...mockFamilyInstance,
    readMarker: async ({ space }: { readonly space: string }) => {
      reads.push(`readMarker ${space}`);
      return space === PRISMA_SPACE_ID ? prismaRow : null;
    },
    readLedger: async () => [],
    storageNameOf: () => 'object',
    accessChangesOf: () => [],
    readAllMarkers: async () => {
      reads.push('readAllMarkers');
      return new Map();
    },
  } as unknown as ControlFamilyInstance<string, unknown>;
  const family = {
    familyId: 'sql',
    create: () => familyInstance,
    // biome-ignore lint/suspicious/noExplicitAny: required for mock flexibility
  } as unknown as ControlFamilyDescriptor<any, any>;
  const target = {
    kind: 'target',
    targetId: 'postgres',
    familyId: 'sql',
    migrations: {
      createRunner: () => ({
        execute: async () =>
          options.runnerFailure === undefined
            ? ok({
                perSpaceResults: [{ space: PRISMA_SPACE_ID, value: { operationsExecuted: 1 } }],
              })
            : notOk(options.runnerFailure),
      }),
    },
    ...(contractSpace === undefined ? {} : { contractSpace }),
    // biome-ignore lint/suspicious/noExplicitAny: required for mock flexibility
  } as unknown as ControlTargetDescriptor<any, any, any>;
  const client = createControlClient({
    family,
    target,
    adapter: mockAdapter,
    driver: mockDriverDescriptor,
  });
  return { client, reads };
}

const dbSignOptions = {
  contract: createContract() satisfies Contract,
  migrationsDir: '/tmp/__test-client-migrations',
  invocation: { cwd: '/work/app', configPath: undefined, dbGiven: false },
};

describe('bringing the Prisma space up to date', () => {
  it("reads the _prisma space's row and applies nothing when it is at the installed head", async () => {
    const { client, reads } = clientWith(installedSpace);
    await client.connect('postgres://test');

    expect(await client.bringPrismaSpaceUpToDate()).toEqual({
      outcome: 'atHead',
      operationsExecuted: 0,
    });
    expect(reads).toEqual([`readMarker ${PRISMA_SPACE_ID}`]);
  });

  it('does nothing on a target that carries no space for its tables', async () => {
    const { client, reads } = clientWith(undefined);
    await client.connect('postgres://test');

    expect(await client.bringPrismaSpaceUpToDate()).toBeUndefined();
    expect(reads).toEqual([]);
  });

  it('db sign brings the tables up to date before it reads any row', async () => {
    const { client, reads } = clientWith(installedSpace);

    await client.dbSign({ ...dbSignOptions, connection: 'postgres://test' });

    expect(reads.slice(0, 2)).toEqual([`readMarker ${PRISMA_SPACE_ID}`, 'readAllMarkers']);
  });

  it('db sign on a target that carries no space reads only the rows it always read', async () => {
    const { client, reads } = clientWith(undefined);

    await client.dbSign({ ...dbSignOptions, connection: 'postgres://test' });

    expect(reads).not.toContain(`readMarker ${PRISMA_SPACE_ID}`);
  });

  it('a dry run of db init leaves the tables as they are', async () => {
    const { client, reads } = clientWith(installedSpace);

    await client
      .dbInit({
        contract: createContract(),
        mode: 'plan',
        migrationsDir: '/tmp/__test-client-migrations',
        invocation: dbSignOptions.invocation,
        connection: 'postgres://test',
      })
      .catch(() => undefined);

    expect(reads).not.toContain(`readMarker ${PRISMA_SPACE_ID}`);
  });

  it("db sign returns, rather than throws, a failure of the space's migrations", async () => {
    const failure = migrationRunnerFailure('MIGRATION.PRECHECK_FAILED', 'a check failed', {
      meta: { failingSpace: PRISMA_SPACE_ID, databaseUnchanged: true },
    });
    const { client, reads } = clientWith(spaceWithAMigration, {
      prismaRow: null,
      runnerFailure: failure,
    });

    const signed = await client.dbSign({ ...dbSignOptions, connection: 'postgres://test' });

    expect({ ok: signed.ok, code: signed.ok ? undefined : signed.failure.code, reads }).toEqual({
      ok: false,
      code: 'MIGRATION.PRECHECK_FAILED',
      reads: [`readMarker ${PRISMA_SPACE_ID}`],
    });
  });

  it('db sign returns, rather than throws, a row this release cannot use', async () => {
    const { client } = clientWith(installedSpace, {
      prismaRow: markerAt('written-by-a-later-major', ['_prisma:major-9']),
    });

    const signed = await client.dbSign({ ...dbSignOptions, connection: 'postgres://test' });

    expect(signed.ok ? undefined : signed.failure.code).toBe(
      'MIGRATION.INSTALLED_SPACE_UNREACHABLE',
    );
  });

  it('bringPrismaSpaceUpToDate throws the same failure', async () => {
    const { client } = clientWith(installedSpace, {
      prismaRow: markerAt('written-by-a-later-major', ['_prisma:major-9']),
    });
    await client.connect('postgres://test');

    await expect(client.bringPrismaSpaceUpToDate()).rejects.toMatchObject({
      code: 'MIGRATION.INSTALLED_SPACE_UNREACHABLE',
    });
  });

  it('db sign tells its caller when it applied the space, and only then', async () => {
    const applied: unknown[] = [];
    const behind = clientWith(spaceWithAMigration, { prismaRow: null });
    await behind.client.dbSign({
      ...dbSignOptions,
      connection: 'postgres://test',
      onPrismaSpaceApplied: (value) => applied.push(value),
    });
    const atHead = clientWith(spaceWithAMigration);
    await atHead.client.dbSign({
      ...dbSignOptions,
      connection: 'postgres://test',
      onPrismaSpaceApplied: (value) => applied.push(value),
    });

    expect(applied).toEqual([{ outcome: 'applied', operationsExecuted: 1 }]);
  });
});
