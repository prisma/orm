import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type {
  ContractSpace,
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationPackage,
  MigrationRunner,
  MigrationRunnerFailure,
  MigrationRunnerPerSpaceOptions,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { notOk, ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import { applyInstalledContractSpace } from '../src/apply-installed-contract-space';
import { createTestContract, createTestMetadata } from './fixtures';

const SPACE = '_prisma';
const driver = { familyId: 'sql', targetId: 'postgres' } as ControlDriverInstance<
  'sql',
  'postgres'
>;

const createOps = [
  { id: 'create.marker', label: 'Create marker', operationClass: 'additive' },
] as const;
const addOps = [{ id: 'add.column', label: 'Add column', operationClass: 'additive' }] as const;

function migrationPackage(
  dirName: string,
  from: string | null,
  to: string,
  ops: MigrationPackage['ops'],
): MigrationPackage {
  return { dirName, metadata: createTestMetadata({ from, to }, ops), ops };
}

const first = migrationPackage('20261126T0000_first', null, 'hash-1', createOps);
const second = migrationPackage('20261127T0000_second', 'hash-1', 'hash-2', addOps);

function space(headHash: string, migrations: readonly MigrationPackage[]): ContractSpace {
  return {
    contractJson: createTestContract(),
    migrations,
    headRef: { hash: headHash, invariants: [] },
  };
}

function marker(storageHash: string, invariants: readonly string[] = []): ContractMarkerRecord {
  return {
    storageHash,
    profileHash: 'profile',
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(0),
    appTag: null,
    meta: {},
    invariants,
  };
}

function setup(options: {
  readonly marker: ContractMarkerRecord | null;
  readonly failure?: MigrationRunnerFailure;
}) {
  const executions: MigrationRunnerPerSpaceOptions<'sql', 'postgres'>[][] = [];
  const markerReads: string[] = [];
  const familyInstance = {
    readMarker: async ({ space: read }: { readonly space: string }) => {
      markerReads.push(read);
      return options.marker;
    },
    deserializeContract: (json: unknown) => json as Contract,
    storageNameOf: () => 'object',
    accessChangesOf: () => [],
  } as unknown as ControlFamilyInstance<'sql', unknown>;
  const runner: MigrationRunner<'sql', 'postgres'> = {
    execute: async ({ perSpaceOptions }) => {
      executions.push([...perSpaceOptions]);
      if (options.failure !== undefined) return notOk(options.failure);
      return ok({
        perSpaceResults: perSpaceOptions.map((spaceOptions) => ({
          space: spaceOptions.space,
          value: {
            operationsPlanned: spaceOptions.plan.operations.length,
            operationsExecuted: spaceOptions.plan.operations.length,
          },
        })),
      });
    },
  };
  const migrations = { createRunner: () => runner } as unknown as TargetMigrationsCapability<
    'sql',
    'postgres',
    ControlFamilyInstance<'sql', unknown>
  >;
  return { executions, markerReads, familyInstance, migrations };
}

describe('applyInstalledContractSpace', () => {
  it('reads the space row and touches nothing more when it is at the head', async () => {
    const { executions, markerReads, familyInstance, migrations } = setup({
      marker: marker('hash-2'),
    });

    const result = await applyInstalledContractSpace({
      spaceId: SPACE,
      contractSpace: space('hash-2', [first, second]),
      driver,
      familyInstance,
      migrations,
      frameworkComponents: [],
    });

    expect(result).toEqual(ok({ applied: false, operationsExecuted: 0 }));
    expect(markerReads).toEqual([SPACE]);
    expect(executions).toEqual([]);
  });

  it('applies the space when its row lacks an invariant of the head', async () => {
    const { executions, familyInstance, migrations } = setup({ marker: marker('hash-1') });
    const withInvariant: ContractSpace = {
      ...space('hash-1', [first]),
      headRef: { hash: 'hash-1', invariants: ['_prisma:not-provided'] },
    };

    await expect(
      applyInstalledContractSpace({
        spaceId: SPACE,
        contractSpace: withInvariant,
        driver,
        familyInstance,
        migrations,
        frameworkComponents: [],
      }),
    ).rejects.toThrow(/_prisma/);
    expect(executions).toEqual([]);
  });

  it('runs the whole path once for one space when there is no row', async () => {
    const { executions, familyInstance, migrations } = setup({ marker: null });

    const result = await applyInstalledContractSpace({
      spaceId: SPACE,
      contractSpace: space('hash-2', [first, second]),
      driver,
      familyInstance,
      migrations,
      frameworkComponents: [],
    });

    expect(result).toEqual(ok({ applied: true, operationsExecuted: 2 }));
    expect(executions).toHaveLength(1);
    const [only] = executions;
    expect(only).toHaveLength(1);
    const options = only?.[0];
    expect(options).toMatchObject({
      space: SPACE,
      driver,
      plan: {
        targetId: 'postgres',
        spaceId: SPACE,
        origin: null,
        destination: { storageHash: 'hash-2' },
        operations: [...createOps, ...addOps],
      },
      migrationEdges: [
        { dirName: first.dirName, from: expect.any(String), to: 'hash-1', operationCount: 1 },
        { dirName: second.dirName, from: 'hash-1', to: 'hash-2', operationCount: 1 },
      ],
    });
    expect(options).not.toHaveProperty('databasePolicies');
  });

  it('starts the path at the row it reads', async () => {
    const { executions, familyInstance, migrations } = setup({ marker: marker('hash-1') });

    await applyInstalledContractSpace({
      spaceId: SPACE,
      contractSpace: space('hash-2', [first, second]),
      driver,
      familyInstance,
      migrations,
      frameworkComponents: [],
    });

    expect(executions[0]?.[0]?.plan).toMatchObject({
      origin: { storageHash: 'hash-1' },
      operations: [...addOps],
    });
  });

  it('returns the runner failure unchanged', async () => {
    const failure = {
      code: 'MIGRATION.PRECHECK_FAILED',
      summary: 'check failed',
      why: 'because',
      meta: { failingSpace: SPACE },
    } as unknown as MigrationRunnerFailure;
    const { familyInstance, migrations } = setup({ marker: null, failure });

    const result = await applyInstalledContractSpace({
      spaceId: SPACE,
      contractSpace: space('hash-1', [first]),
      driver,
      familyInstance,
      migrations,
      frameworkComponents: [],
    });

    expect(result).toEqual(notOk(failure));
  });

  it('refuses a space whose migration does not match its hash', async () => {
    const { executions, familyInstance, migrations } = setup({ marker: null });
    const tampered: MigrationPackage = { ...first, ops: addOps };

    await expect(
      applyInstalledContractSpace({
        spaceId: SPACE,
        contractSpace: space('hash-1', [tampered]),
        driver,
        familyInstance,
        migrations,
        frameworkComponents: [],
      }),
    ).rejects.toThrow(first.dirName);
    expect(executions).toEqual([]);
  });

  it('refuses a row at a contract the installed migrations do not reach', async () => {
    const { executions, familyInstance, migrations } = setup({ marker: marker('hash-newer') });

    await expect(
      applyInstalledContractSpace({
        spaceId: SPACE,
        contractSpace: space('hash-2', [first, second]),
        driver,
        familyInstance,
        migrations,
        frameworkComponents: [],
      }),
    ).rejects.toMatchObject({ code: 'MIGRATION.INSTALLED_SPACE_UNREACHABLE' });
    expect(executions).toEqual([]);
  });
});
