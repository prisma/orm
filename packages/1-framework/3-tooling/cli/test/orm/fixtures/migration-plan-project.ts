import { readdir } from 'node:fs/promises';
import { BIN_GROUPS } from '../../../src/orm/cli';
import { createOrmTestCli } from '../../helpers/orm-test-cli';
import {
  createOfflineProject,
  type FakePlannerScript,
  OFFLINE_COMMANDS,
  type OfflineProject,
  offlineConfig,
  seedContractSnapshot,
  seedDbRef,
  seedMigrationPackage,
} from './offline-project';

export const HASH_TO = `c0ffee${'0'.repeat(58)}`;
export const HASH_FROM = `beef${'1'.repeat(60)}`;

export function harness(
  project: OfflineProject,
  options: {
    readonly script?: FakePlannerScript;
    readonly overrides?: Record<string, unknown>;
  } = {},
) {
  return createOrmTestCli({
    commands: OFFLINE_COMMANDS,
    groups: BIN_GROUPS,
    orm: {
      ...offlineConfig({ project, ...(options.script ? { script: options.script } : {}) }),
      ...options.overrides,
    },
  });
}

export async function plannedDirs(project: OfflineProject): Promise<readonly string[]> {
  return (await readdir(project.appMigrationsDir)).filter((entry) => entry !== 'refs').sort();
}

/** A project whose database sits at HASH_FROM and whose contract is HASH_TO. */
export async function plannableProject(): Promise<OfflineProject> {
  const project = await createOfflineProject({ storageHash: HASH_TO });
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: '20260101T0000_initial',
    from: null,
    to: HASH_FROM,
  });
  await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_FROM });
  await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });
  return project;
}

/** A project whose database already sits at the emitted contract. */
export async function upToDateProject(): Promise<OfflineProject> {
  const project = await createOfflineProject({ storageHash: HASH_TO });
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: '20260101T0000_initial',
    from: null,
    to: HASH_TO,
  });
  await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_TO });
  await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_TO });
  return project;
}
