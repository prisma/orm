import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type {
  ContractSpace,
  ControlFamilyDescriptor,
  ControlFamilyInstance,
  ControlTargetDescriptor,
} from '@internal/framework-components/control';
import { PRISMA_TABLES_SPACE_ID } from '@internal/framework-components/control';
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

function markerAt(storageHash: string): ContractMarkerRecord {
  return {
    storageHash,
    profileHash: 'profile',
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date('2026-11-27T00:00:00.000Z'),
    appTag: null,
    meta: {},
    invariants: [],
  };
}

/** A client over a family that records every marker read, and a target that carries `contractSpace` when given one. */
function clientWith(contractSpace: ContractSpace | undefined) {
  const { mockFamilyInstance, mockAdapter, mockDriverDescriptor } = createMockComponents();
  const reads: string[] = [];
  const familyInstance = {
    ...mockFamilyInstance,
    readMarker: async ({ space }: { readonly space: string }) => {
      reads.push(`readMarker ${space}`);
      return space === PRISMA_TABLES_SPACE_ID ? markerAt(PRISMA_TABLES_HEAD) : null;
    },
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
    migrations: { createRunner: () => ({}) },
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

describe("bringing Prisma's own tables up to date", () => {
  it("reads the _prisma space's row and applies nothing when it is at the installed head", async () => {
    const { client, reads } = clientWith(installedSpace);
    await client.connect('postgres://test');

    expect(await client.bringPrismaTablesUpToDate()).toEqual({
      outcome: 'atHead',
      operationsExecuted: 0,
    });
    expect(reads).toEqual([`readMarker ${PRISMA_TABLES_SPACE_ID}`]);
  });

  it('does nothing on a target that carries no space for its tables', async () => {
    const { client, reads } = clientWith(undefined);
    await client.connect('postgres://test');

    expect(await client.bringPrismaTablesUpToDate()).toBeUndefined();
    expect(reads).toEqual([]);
  });

  it('db sign brings the tables up to date before it reads any row', async () => {
    const { client, reads } = clientWith(installedSpace);

    await client.dbSign({ ...dbSignOptions, connection: 'postgres://test' });

    expect(reads.slice(0, 2)).toEqual([`readMarker ${PRISMA_TABLES_SPACE_ID}`, 'readAllMarkers']);
  });

  it('db sign on a target that carries no space reads only the rows it always read', async () => {
    const { client, reads } = clientWith(undefined);

    await client.dbSign({ ...dbSignOptions, connection: 'postgres://test' });

    expect(reads).not.toContain(`readMarker ${PRISMA_TABLES_SPACE_ID}`);
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

    expect(reads).not.toContain(`readMarker ${PRISMA_TABLES_SPACE_ID}`);
  });
});
