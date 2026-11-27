import { readFile, rm, writeFile } from 'node:fs/promises';
import { ContractValidationError } from '@internal/contract/contract-validation-error';
import type { Contract } from '@internal/contract/types';
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

/** A migrations directory with one app migration ∅ → APP_HEAD and the snapshot it ends at. */
async function migrationsDirWithSnapshot(): Promise<string> {
  const projectDir = createTestProjectDir('migrate-destination-snapshots');
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
  await writeContractSnapshot(migrationsDir, APP_HEAD, {
    contractJson: { formatVersion: 1, ...APP_CONTRACT },
    contractDts: 'export type Contract = never;\n',
  });
  return migrationsDir;
}

async function addUnknownKeyToSnapshot(migrationsDir: string): Promise<string> {
  const path = join(contractSnapshotDir(migrationsDir, APP_HEAD), 'contract.json');
  const json = JSON.parse(await readFile(path, 'utf-8'));
  await writeFile(path, JSON.stringify({ ...json, zzz: 1 }));
  return path;
}

/** A family that refuses a contract holding the key `zzz`, as the strict contract reader does. */
function strictFamily(): ControlFamilyInstance<'sql', unknown> {
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
    readAllMarkers: async () => new Map(),
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
) {
  return {
    driver: blindCast<ControlDriverInstance<'sql', 'postgres'>, 'the fakes never touch it'>({
      familyId: 'sql',
      targetId: 'postgres',
      close: async () => {},
    }),
    invocation: { cwd: '/work/app', configPath: undefined, dbGiven: false },
    familyInstance: strictFamily(),
    contract: APP_CONTRACT,
    migrations,
    frameworkComponents: [],
    migrationsDir,
    extensions: [],
    targetId: 'postgres' as const,
  };
}

describe('executeMigrate reads the snapshot each migration ends at through the family', () => {
  it('hands the runner a snapshot the family reads', async () => {
    const migrationsDir = await migrationsDirWithSnapshot();
    const { handed, migrations } = recordingMigrations();

    const result = await executeMigrate(migrateOptions(migrationsDir, migrations));

    expect({ ok: result.ok, handed: handed.map((edges) => edges.length) }).toEqual({
      ok: true,
      handed: [1],
    });
  });

  it('refuses a snapshot the family refuses, naming the file, before the runner runs', async () => {
    const migrationsDir = await migrationsDirWithSnapshot();
    const snapshotPath = await addUnknownKeyToSnapshot(migrationsDir);
    const { handed, migrations } = recordingMigrations();

    const result = await executeMigrate(migrateOptions(migrationsDir, migrations));

    expect({
      failure: result.ok ? undefined : { code: result.failure.code, why: result.failure.why },
      handed,
    }).toEqual({
      failure: {
        code: 'CONTRACT.VALIDATION_FAILED',
        why: `Target contract at ${snapshotPath} failed to deserialize: zzz must be removed`,
      },
      handed: [],
    });
  });
});
