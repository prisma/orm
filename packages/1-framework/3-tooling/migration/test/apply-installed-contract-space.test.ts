import type { Contract, ContractMarkerRecord, LedgerEntryRecord } from '@internal/contract/types';
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

function ledgerEntry(to: string): LedgerEntryRecord {
  return {
    space: SPACE,
    migrationName: `to-${to}`,
    migrationHash: `migration-${to}`,
    from: null,
    to,
    appliedAt: new Date(0),
    operationCount: 1,
  };
}

function setup(options: {
  readonly marker: ContractMarkerRecord | null;
  /** The rows later reads return, in order, after the first. */
  readonly laterMarkers?: readonly (ContractMarkerRecord | null)[];
  readonly ledger?: readonly LedgerEntryRecord[];
  readonly failure?: MigrationRunnerFailure;
  /** The results of the runner's calls, in order; a call past the end succeeds. */
  readonly failures?: readonly (MigrationRunnerFailure | undefined)[];
}) {
  const ledgerReads: (string | undefined)[] = [];
  const executions: MigrationRunnerPerSpaceOptions<'sql', 'postgres'>[][] = [];
  const markerReads: string[] = [];
  const familyInstance = {
    readMarker: async ({ space: read }: { readonly space: string }) => {
      markerReads.push(read);
      return markerReads.length === 1
        ? options.marker
        : (options.laterMarkers?.[markerReads.length - 2] ?? options.marker);
    },
    readLedger: async ({ space: read }: { readonly space?: string }) => {
      ledgerReads.push(read);
      return options.ledger ?? [];
    },
    deserializeContract: (json: unknown) => json as Contract,
    storageNameOf: () => 'object',
    accessChangesOf: () => [],
  } as unknown as ControlFamilyInstance<'sql', unknown>;
  const runner: MigrationRunner<'sql', 'postgres'> = {
    execute: async ({ perSpaceOptions }) => {
      executions.push([...perSpaceOptions]);
      const failure = options.failure ?? options.failures?.[executions.length - 1];
      if (failure !== undefined) return notOk(failure);
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
  return { executions, markerReads, ledgerReads, familyInstance, migrations };
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

    expect(result).toEqual(ok({ outcome: 'atHead', operationsExecuted: 0 }));
    expect(markerReads).toEqual([SPACE]);
    expect(executions).toEqual([]);
  });

  it('throws, running nothing, when no path provides an invariant the head requires', async () => {
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

    expect(result).toEqual(ok({ outcome: 'applied', operationsExecuted: 2 }));
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

  it('applies nothing when the row is at a later contract and the ledger shows the database passed the head', async () => {
    const { executions, ledgerReads, familyInstance, migrations } = setup({
      marker: marker('hash-newer'),
      ledger: [ledgerEntry('hash-1'), ledgerEntry('hash-2'), ledgerEntry('hash-newer')],
    });

    const result = await applyInstalledContractSpace({
      spaceId: SPACE,
      contractSpace: space('hash-2', [first, second]),
      driver,
      familyInstance,
      migrations,
      frameworkComponents: [],
    });

    expect(result).toEqual(ok({ outcome: 'ahead', operationsExecuted: 0 }));
    expect(ledgerReads).toEqual([SPACE]);
    expect(executions).toEqual([]);
  });

  it('throws an internal error when the migrations do not reach the head from an empty database', async () => {
    const { executions, familyInstance, migrations } = setup({ marker: null });

    await expect(
      applyInstalledContractSpace({
        spaceId: SPACE,
        contractSpace: space('hash-unreached', [first, second]),
        driver,
        familyInstance,
        migrations,
        frameworkComponents: [],
      }),
    ).rejects.toThrow(/does not lead from the empty contract/);
    expect(executions).toEqual([]);
  });

  it('refuses a row at a contract the installed migrations do not reach, when the ledger never reached the head', async () => {
    const { executions, familyInstance, migrations } = setup({
      marker: marker('hash-newer'),
      ledger: [ledgerEntry('hash-1'), ledgerEntry('hash-newer')],
    });

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

  it('refuses a row that carries an invariant the installed migrations never provide, though the ledger reached the head', async () => {
    const { executions, familyInstance, migrations } = setup({
      marker: marker('hash-next-major', ['_prisma:major-9']),
      ledger: [ledgerEntry('hash-1'), ledgerEntry('hash-2'), ledgerEntry('hash-next-major')],
    });

    await expect(
      applyInstalledContractSpace({
        spaceId: SPACE,
        contractSpace: space('hash-2', [first, second]),
        driver,
        familyInstance,
        migrations,
        frameworkComponents: [],
      }),
    ).rejects.toMatchObject({
      code: 'MIGRATION.INSTALLED_SPACE_UNREACHABLE',
      meta: { reason: 'laterMajor' },
    });
    expect(executions).toEqual([]);
  });

  describe('when another command moved the row after it was read', () => {
    const originMismatch = {
      code: 'MIGRATION.MARKER_ORIGIN_MISMATCH',
      summary: 'origin mismatch',
      why: 'another command moved the row',
      meta: { failingSpace: SPACE },
    } as unknown as MigrationRunnerFailure;

    it('returns at the head when the other command brought it there', async () => {
      const { executions, markerReads, familyInstance, migrations } = setup({
        marker: marker('hash-1'),
        laterMarkers: [marker('hash-2')],
        failures: [originMismatch],
      });

      const result = await applyInstalledContractSpace({
        spaceId: SPACE,
        contractSpace: space('hash-2', [first, second]),
        driver,
        familyInstance,
        migrations,
        frameworkComponents: [],
      });

      expect(result).toEqual(ok({ outcome: 'atHead', operationsExecuted: 0 }));
      expect({ markerReads, executions: executions.length }).toEqual({
        markerReads: [SPACE, SPACE],
        executions: 1,
      });
    });

    it('plans again from the row it reads again when that is still behind', async () => {
      const { executions, familyInstance, migrations } = setup({
        marker: null,
        laterMarkers: [marker('hash-1')],
        failures: [originMismatch],
      });

      const result = await applyInstalledContractSpace({
        spaceId: SPACE,
        contractSpace: space('hash-2', [first, second]),
        driver,
        familyInstance,
        migrations,
        frameworkComponents: [],
      });

      expect(result).toEqual(ok({ outcome: 'applied', operationsExecuted: 1 }));
      expect(executions.map((execution) => execution[0]?.plan.origin)).toEqual([
        null,
        { storageHash: 'hash-1' },
      ]);
    });

    it('returns a second origin mismatch as the failure', async () => {
      const { executions, familyInstance, migrations } = setup({
        marker: null,
        laterMarkers: [marker('hash-1')],
        failures: [originMismatch, originMismatch],
      });

      const result = await applyInstalledContractSpace({
        spaceId: SPACE,
        contractSpace: space('hash-2', [first, second]),
        driver,
        familyInstance,
        migrations,
        frameworkComponents: [],
      });

      expect({ result, executions: executions.length }).toEqual({
        result: notOk(originMismatch),
        executions: 2,
      });
    });

    it('does not read again after any other failure', async () => {
      const failure = {
        code: 'MIGRATION.PRECHECK_FAILED',
        summary: 'check failed',
        why: 'because',
        meta: { failingSpace: SPACE },
      } as unknown as MigrationRunnerFailure;
      const { markerReads, familyInstance, migrations } = setup({ marker: null, failure });

      await applyInstalledContractSpace({
        spaceId: SPACE,
        contractSpace: space('hash-1', [first]),
        driver,
        familyInstance,
        migrations,
        frameworkComponents: [],
      });

      expect(markerReads).toEqual([SPACE]);
    });
  });
});
