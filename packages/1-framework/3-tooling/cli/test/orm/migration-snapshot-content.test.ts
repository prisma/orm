import { writeFile } from 'node:fs/promises';
import { computeStorageHash } from '@internal/contract/hashing';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import {
  createOfflineProject,
  type OfflineProject,
  offlineConfig,
  removeOfflineProjects,
  seedContractSnapshot,
  seedDbRef,
  seedMigrationPackage,
} from './fixtures/offline-project';

/**
 * The one hash whose content genuinely reproduces it: the shared offline
 * fixture builds contracts whose storage is `{ storageHash, namespaces: {} }`,
 * so addressing them by this computed hash makes every seeded artifact
 * content-consistent.
 */
const GENUINE_HASH = computeStorageHash({
  target: 'postgres',
  targetFamily: 'sql',
  storage: { namespaces: {} },
}) as string;

afterEach(removeOfflineProjects);

function harness(project: OfflineProject) {
  const config = offlineConfig({ project });
  const target = config['target'] as Record<string, unknown>;
  return createTestCli({
    commands: BIN_COMMANDS,
    groups: BIN_GROUPS,
    config: {
      orm: {
        ...config,
        target: { ...target, contractSerializer: { hashCanonicalizationHooks: {} } },
      },
    },
  });
}

/** A project whose graph, snapshot store, db ref and emitted contract all sit at GENUINE_HASH. */
async function upToDateProject(): Promise<OfflineProject> {
  const project = await createOfflineProject({ storageHash: GENUINE_HASH });
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: '20260101T0000_initial',
    from: null,
    to: GENUINE_HASH,
  });
  await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: GENUINE_HASH });
  await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: GENUINE_HASH });
  return project;
}

async function tamperSnapshot(project: OfflineProject): Promise<void> {
  const jsonPath = join(contractSnapshotDir(project.migrationsDir, GENUINE_HASH), 'contract.json');
  await writeFile(
    jsonPath,
    JSON.stringify({
      storage: { storageHash: GENUINE_HASH, namespaces: { sneaky: { entries: {} } } },
      schemaVersion: '1.0.0',
      target: 'postgres',
      targetFamily: 'sql',
      models: {},
    }),
    'utf-8',
  );
}

describe('contract snapshot content verification', () => {
  it('plan reports a clean no-op while the snapshot store is untampered', async () => {
    const project = await upToDateProject();

    const run = await harness(project).run(['migration', 'plan', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ noOp: true });
  });

  it('plan refuses when the snapshot content was edited under an unchanged hash field', async () => {
    const project = await upToDateProject();
    await tamperSnapshot(project);

    const run = await harness(project).run(['migration', 'plan', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(2);
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;
    expect(envelope).toMatchObject({
      ok: false,
      error: {
        code: 'MIGRATION.CONTRACT_SNAPSHOT_CONTENT_MISMATCH',
        meta: {
          storageHash: GENUINE_HASH,
          computedHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      },
    });
  });

  it('check reports the tampered snapshot as CHECK_SNAPSHOT_CONTENT_MISMATCH', async () => {
    const project = await upToDateProject();
    await tamperSnapshot(project);

    const run = await harness(project).run(['migration', 'check', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(4);
    const data = run.presented?.data as {
      failures: readonly { code: string; why: string }[];
    };
    const failure = data.failures.find(
      (f) => f.code === 'MIGRATION.CHECK_SNAPSHOT_CONTENT_MISMATCH',
    );
    expect(failure).toBeDefined();
    expect(failure?.why).toContain(GENUINE_HASH);
  });

  it('check passes while the snapshot store is untampered', async () => {
    const project = await upToDateProject();

    const run = await harness(project).run(['migration', 'check', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
  });
});
