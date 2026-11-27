import { readFile, rm } from 'node:fs/promises';
import { ContractValidationError } from '@internal/contract/contract-validation-error';
import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationPlanOperation,
  MigrationRunner,
  MigrationRunnerPerSpaceOptions,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import {
  contractSnapshotDir,
  writeContractSnapshot,
} from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { blindCast } from '@internal/utils/casts';
import { ok } from '@internal/utils/result';
import { createSqlContract } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { executeMigrate } from '../../src/control-api/operations/migrate';
import { createTestProjectDir } from '../utils/test-project-dir';

const APP_CONTRACT: Contract = createSqlContract();
const APP_HEAD = APP_CONTRACT.storage.storageHash;

const CREATE_TABLE: MigrationPlanOperation = {
  id: 'table.post',
  label: 'Create table post',
  operationClass: 'additive',
};

const projectDirs: string[] = [];

afterEach(async () => {
  await Promise.all(projectDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const MIDDLE = 'ab'.repeat(32);

async function writeMigration(
  migrationsDir: string,
  dirName: string,
  from: string,
  to: string,
): Promise<void> {
  const ops = [CREATE_TABLE];
  const base: Omit<MigrationMetadata, 'migrationHash'> = {
    from,
    to,
    providedInvariants: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  await writeMigrationPackage(
    join(migrationsDir, 'app', dirName),
    { ...base, migrationHash: computeMigrationHash(base, ops) },
    ops,
  );
}

/**
 * Two app migrations, ∅ → MIDDLE → APP_HEAD, each with the snapshot it ends at. The snapshot at
 * MIDDLE holds a key the family refuses, as a snapshot an earlier release wrote can.
 */
async function migrationsDirWithUnreadableMiddleSnapshot(): Promise<{
  readonly migrationsDir: string;
  readonly middleSnapshot: unknown;
}> {
  const projectDir = createTestProjectDir('migrate-destination-snapshots');
  projectDirs.push(projectDir);
  const migrationsDir = join(projectDir, 'migrations');
  await writeMigration(migrationsDir, '20260101T0000_initial', EMPTY_CONTRACT_HASH, MIDDLE);
  await writeMigration(migrationsDir, '20260102T0000_second', MIDDLE, APP_HEAD);
  const middleSnapshot = {
    formatVersion: 1,
    ...APP_CONTRACT,
    storage: { ...APP_CONTRACT.storage, storageHash: MIDDLE },
    zzz: 1,
  };
  await writeContractSnapshot(migrationsDir, MIDDLE, {
    contractJson: middleSnapshot,
    contractDts: 'export type Contract = never;\n',
  });
  await writeContractSnapshot(migrationsDir, APP_HEAD, {
    contractJson: { formatVersion: 1, ...APP_CONTRACT },
    contractDts: 'export type Contract = never;\n',
  });
  const stored = JSON.parse(
    await readFile(join(contractSnapshotDir(migrationsDir, MIDDLE), 'contract.json'), 'utf-8'),
  );
  return { migrationsDir, middleSnapshot: stored };
}

/** A family that refuses a contract holding the key `zzz`, as the strict contract reader does. */
function strictFamily(
  markers: ReadonlyMap<string, ContractMarkerRecord> = new Map(),
): ControlFamilyInstance<'sql', unknown> {
  const used: Pick<
    ControlFamilyInstance<'sql', unknown>,
    'familyId' | 'deserializeContract' | 'readAllMarkers' | 'accessChangesOf'
  > = {
    familyId: 'sql',
    deserializeContract: (json) => {
      if (json !== null && typeof json === 'object' && 'zzz' in json) {
        throw new ContractValidationError('zzz must be removed', 'structural');
      }
      return blindCast<Contract, 'the snapshots in this test are written from Contract values'>(
        json,
      );
    },
    readAllMarkers: async () => markers,
    accessChangesOf: () => [],
  };
  return blindCast<
    ControlFamilyInstance<'sql', unknown>,
    'executeMigrate reads only the family members picked above'
  >(used);
}

function recordingMigrations() {
  const handed: unknown[][] = [];
  const runner: MigrationRunner<'sql', 'postgres'> = {
    execute: async ({ perSpaceOptions }) => {
      handed.push(
        perSpaceOptions.flatMap((option: MigrationRunnerPerSpaceOptions<'sql', 'postgres'>) =>
          option.migrationEdges.map((edge) => edge.destinationContractJson),
        ),
      );
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
  return { handed, migrations };
}

function migrateOptions(
  migrationsDir: string,
  migrations: TargetMigrationsCapability<'sql', 'postgres', ControlFamilyInstance<'sql', unknown>>,
  markers?: ReadonlyMap<string, ContractMarkerRecord>,
) {
  return {
    driver: blindCast<ControlDriverInstance<'sql', 'postgres'>, 'the fakes never touch it'>({
      familyId: 'sql',
      targetId: 'postgres',
      close: async () => {},
    }),
    invocation: { cwd: '/work/app', configPath: undefined, dbGiven: false },
    familyInstance: strictFamily(markers),
    contract: APP_CONTRACT,
    migrations,
    frameworkComponents: [],
    migrationsDir,
    extensions: [],
    targetId: 'postgres' as const,
  };
}

describe('executeMigrate records the snapshots of the migrations it applies as they are stored', () => {
  it('applies every migration to an empty database when a snapshot along the path is one the family refuses', async () => {
    const { migrationsDir, middleSnapshot } = await migrationsDirWithUnreadableMiddleSnapshot();
    const { handed, migrations } = recordingMigrations();

    const result = await executeMigrate(migrateOptions(migrationsDir, migrations));

    expect({ ok: result.ok, middle: handed[0]?.[0] }).toEqual({ ok: true, middle: middleSnapshot });
  });

  it('applies the pending migration to a database already past that snapshot', async () => {
    const { migrationsDir } = await migrationsDirWithUnreadableMiddleSnapshot();
    const { handed, migrations } = recordingMigrations();

    const result = await executeMigrate(
      migrateOptions(
        migrationsDir,
        migrations,
        new Map([
          [
            'app',
            {
              storageHash: MIDDLE,
              profileHash: '',
              contractJson: null,
              canonicalVersion: null,
              updatedAt: new Date(0),
              appTag: null,
              meta: {},
              invariants: [],
            },
          ],
        ]),
      ),
    );

    expect({ ok: result.ok, edges: handed.map((edges) => edges.length) }).toEqual({
      ok: true,
      edges: [1],
    });
  });
});
