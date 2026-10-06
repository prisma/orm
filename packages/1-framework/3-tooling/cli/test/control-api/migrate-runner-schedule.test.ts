import { rm } from 'node:fs/promises';
import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type {
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyInstance,
  MigrationPlanOperation,
  MigrationRunner,
  MigrationRunnerPerSpaceOptions,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { writeRef } from '@internal/migration-tools/refs';
import { blindCast } from '@internal/utils/casts';
import { ok } from '@internal/utils/result';
import { createSqlContract } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { executeMigrate } from '../../src/control-api/operations/migrate';
import { createTestProjectDir } from '../utils/test-project-dir';

const EXTERNAL_SPACE = 'external';

const APP_CONTRACT: Contract = createSqlContract();
const APP_HEAD = APP_CONTRACT.storage.storageHash;

const EXTERNAL_CONTRACT: Contract = {
  ...createSqlContract({
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: { users: {} } } },
      },
    },
  }),
  defaultControlPolicy: 'external',
};
const EXTERNAL_HEAD = EXTERNAL_CONTRACT.storage.storageHash;

const CREATE_TABLE: MigrationPlanOperation = {
  id: 'table.post',
  label: 'Create table post',
  operationClass: 'additive',
};

const projectDirs: string[] = [];

afterEach(async () => {
  await Promise.all(projectDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A migrations directory whose app space carries one migration ∅ → APP_HEAD. */
async function migrationsDirWithOneAppEdge(): Promise<string> {
  const projectDir = createTestProjectDir('migrate-runner-schedule');
  projectDirs.push(projectDir);
  const migrationsDir = join(projectDir, 'migrations');
  const ops = [CREATE_TABLE];
  const base: Omit<MigrationMetadata, 'migrationHash'> = {
    from: EMPTY_CONTRACT_HASH,
    to: APP_HEAD,
    providedInvariants: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  await writeMigrationPackage(
    join(migrationsDir, 'app', '20260101T0000_initial'),
    { ...base, migrationHash: computeMigrationHash(base, ops) },
    ops,
  );
  return migrationsDir;
}

/** Adds an all-external extension space: a head ref and a snapshot, no migration packages. */
async function addAllExternalSpace(migrationsDir: string): Promise<void> {
  await writeRef(join(migrationsDir, EXTERNAL_SPACE, 'refs'), 'head', {
    hash: EXTERNAL_HEAD,
    invariants: [],
  });
  await writeContractSnapshot(migrationsDir, EXTERNAL_HEAD, {
    contractJson: EXTERNAL_CONTRACT,
    contractDts: 'export type Contract = never;\n',
  });
}

function allExternalExtension(): ControlExtensionDescriptor<'sql', 'postgres'> {
  return {
    kind: 'extension',
    id: EXTERNAL_SPACE,
    familyId: 'sql',
    targetId: 'postgres',
    version: '1.0.0',
    contractSpace: {
      contractJson: EXTERNAL_CONTRACT,
      headRef: { hash: EXTERNAL_HEAD, invariants: [] },
      migrations: [],
    },
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
  };
}

function markerAt(storageHash: string): ContractMarkerRecord {
  return {
    storageHash,
    profileHash: '',
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(0),
    appTag: null,
    meta: {},
    invariants: [],
  };
}

function fakeDriver(): ControlDriverInstance<'sql', 'postgres'> {
  return blindCast<
    ControlDriverInstance<'sql', 'postgres'>,
    'executeMigrate hands the driver to the family and runner fakes, which never touch it'
  >({ familyId: 'sql', targetId: 'postgres', close: async () => {} });
}

function fakeFamily(
  markers: ReadonlyMap<string, ContractMarkerRecord>,
): ControlFamilyInstance<'sql', unknown> {
  const used: Pick<
    ControlFamilyInstance<'sql', unknown>,
    'familyId' | 'deserializeContract' | 'readAllMarkers'
  > = {
    familyId: 'sql',
    deserializeContract: (json) =>
      blindCast<Contract, 'the snapshots in this test are written from Contract values'>(json),
    readAllMarkers: async () => markers,
  };
  return blindCast<
    ControlFamilyInstance<'sql', unknown>,
    'executeMigrate reads only the family members picked above'
  >(used);
}

/** A runner that records which spaces it was handed and reports each as applied. */
function recordingMigrations() {
  const runnerCalls: string[][] = [];
  const runner: MigrationRunner<'sql', 'postgres'> = {
    execute: async ({ perSpaceOptions }) => {
      const spaces = perSpaceOptions.map(
        (option: MigrationRunnerPerSpaceOptions<'sql', 'postgres'>) => option.space,
      );
      runnerCalls.push(spaces);
      return ok({
        perSpaceResults: perSpaceOptions.map((option) => ({
          space: option.space,
          value: {
            operationsPlanned: option.plan.operations.length,
            operationsExecuted: option.plan.operations.length,
          },
        })),
      });
    },
  };
  const migrations = blindCast<
    TargetMigrationsCapability<'sql', 'postgres', ControlFamilyInstance<'sql', unknown>>,
    'executeMigrate only creates a runner'
  >({ createRunner: () => runner });
  return { runnerCalls, migrations };
}

function migrateOptions(args: {
  readonly migrationsDir: string;
  readonly markers: ReadonlyMap<string, ContractMarkerRecord>;
  readonly migrations: TargetMigrationsCapability<
    'sql',
    'postgres',
    ControlFamilyInstance<'sql', unknown>
  >;
  readonly extensions?: ReadonlyArray<ControlExtensionDescriptor<'sql', 'postgres'>>;
  readonly refHash?: string;
}) {
  return {
    driver: fakeDriver(),
    familyInstance: fakeFamily(args.markers),
    contract: APP_CONTRACT,
    migrations: args.migrations,
    frameworkComponents: [],
    migrationsDir: args.migrationsDir,
    extensions: args.extensions ?? [],
    targetId: 'postgres' as const,
    ...(args.refHash === undefined ? {} : { refHash: args.refHash }),
  };
}

describe('executeMigrate runner schedule', () => {
  it('leaves a database with no marker alone when the target is the empty contract', async () => {
    const migrationsDir = await migrationsDirWithOneAppEdge();
    const { runnerCalls, migrations } = recordingMigrations();

    const result = await executeMigrate(
      migrateOptions({
        migrationsDir,
        markers: new Map(),
        migrations,
        refHash: EMPTY_CONTRACT_HASH,
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.summary).toBe('Already up to date');
    expect(runnerCalls).toEqual([]);
  });

  it('runs an all-external extension that needs its marker and keeps the unmarked app space out', async () => {
    const migrationsDir = await migrationsDirWithOneAppEdge();
    await addAllExternalSpace(migrationsDir);
    const { runnerCalls, migrations } = recordingMigrations();

    const result = await executeMigrate(
      migrateOptions({
        migrationsDir,
        markers: new Map(),
        migrations,
        extensions: [allExternalExtension()],
        refHash: EMPTY_CONTRACT_HASH,
      }),
    );

    expect(result.ok).toBe(true);
    expect(runnerCalls).toEqual([[EXTERNAL_SPACE]]);
  });

  it('does not call the runner when the app space is already at its head', async () => {
    const migrationsDir = await migrationsDirWithOneAppEdge();
    const { runnerCalls, migrations } = recordingMigrations();

    const result = await executeMigrate(
      migrateOptions({
        migrationsDir,
        markers: new Map([['app', markerAt(APP_HEAD)]]),
        migrations,
      }),
    );

    expect(result.ok && result.value.summary).toBe('Already up to date');
    expect(runnerCalls).toEqual([]);
  });

  it('hands an app space already at its head to the runner beside an extension that needs work', async () => {
    const migrationsDir = await migrationsDirWithOneAppEdge();
    await addAllExternalSpace(migrationsDir);
    const { runnerCalls, migrations } = recordingMigrations();

    const result = await executeMigrate(
      migrateOptions({
        migrationsDir,
        markers: new Map([['app', markerAt(APP_HEAD)]]),
        migrations,
        extensions: [allExternalExtension()],
      }),
    );

    expect(result.ok).toBe(true);
    expect(runnerCalls).toEqual([[EXTERNAL_SPACE, 'app']]);
  });
});
