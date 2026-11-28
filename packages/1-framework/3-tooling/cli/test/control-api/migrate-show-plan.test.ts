import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { PrismaConfig } from '@internal/config-loader';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { formatMigrationDirName, writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeMigrateShowPlan } from '../../src/control-api/operations/migrate-show';
import { createTestProjectDir } from '../utils/test-project-dir';

const mocks = vi.hoisted(() => ({
  createControlClient: vi.fn(),
}));

vi.mock('../../src/control-api/client', () => ({
  createControlClient: mocks.createControlClient,
}));

const HASH_A = `${'a'.repeat(64)}`;
const HASH_B = `${'b'.repeat(64)}`;

function contractJsonForHash(storageHash: string): Record<string, unknown> {
  return {
    formatVersion: 1,
    targetFamily: 'sql',
    target: 'postgres',
    storage: { storageHash },
    models: {},
  };
}

describe('executeMigrateShowPlan', () => {
  let tempDir: string;
  let migrationsDir: string;
  let appMigrationsDir: string;
  let config: PrismaConfig;
  let firstDirName: string;
  let firstMigrationHash: string;
  let secondDirName: string;
  let secondMigrationHash: string;

  async function writeAttestedMigration(opts: {
    from: string | null;
    to: string;
    timestamp: Date;
    slug: string;
  }): Promise<{ dirName: string; migrationHash: string }> {
    const baseMetadata: Omit<MigrationMetadata, 'migrationHash'> = {
      from: opts.from,
      to: opts.to,
      providedInvariants: [],
      createdAt: opts.timestamp.toISOString(),
    };
    const ops: MigrationPlanOperation[] = [
      {
        id: `table.${opts.slug}`,
        label: `Create table "${opts.slug}"`,
        operationClass: 'additive',
      },
    ];
    const migrationHash = computeMigrationHash(baseMetadata, ops);
    const dirName = formatMigrationDirName(opts.timestamp, opts.slug);
    await writeMigrationPackage(
      join(appMigrationsDir, dirName),
      { ...baseMetadata, migrationHash },
      ops,
    );
    return { dirName, migrationHash };
  }

  beforeEach(async () => {
    mocks.createControlClient.mockReset();
    tempDir = createTestProjectDir('migrate-show-plan');
    migrationsDir = join(tempDir, 'migrations');
    appMigrationsDir = join(migrationsDir, 'app');
    await mkdir(join(appMigrationsDir, 'refs'), { recursive: true });
    await writeFile(join(tempDir, 'contract.json'), JSON.stringify(contractJsonForHash(HASH_B)));

    const first = await writeAttestedMigration({
      from: null,
      to: HASH_A,
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'add_user',
    });
    firstDirName = first.dirName;
    firstMigrationHash = first.migrationHash;
    const second = await writeAttestedMigration({
      from: HASH_A,
      to: HASH_B,
      timestamp: new Date(2026, 0, 2, 10, 0),
      slug: 'add_post',
    });
    secondDirName = second.dirName;
    secondMigrationHash = second.migrationHash;

    config = {
      family: {
        familyId: 'sql',
        create: vi.fn().mockReturnValue({
          deserializeContract: (json: unknown) => json,
          accessChangesOf: () => [],
        }),
      },
      target: {
        id: 'postgres',
        familyId: 'sql',
        targetId: 'postgres',
        kind: 'target',
        migrations: {},
      },
      contract: { output: join(tempDir, 'contract.json') },
      migrations: { dir: 'migrations' },
    } as unknown as PrismaConfig;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('computes the ordered offline path without constructing a control client', async () => {
    const result = await executeMigrateShowPlan({
      config,
      cwd: tempDir,
      invocation: { cwd: tempDir, configPath: undefined, dbGiven: false },
      from: HASH_A,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.migrations).toEqual([
        {
          spaceId: 'app',
          dirName: secondDirName,
          migrationHash: secondMigrationHash,
          from: HASH_A,
          to: HASH_B,
        },
      ]);
      expect(result.value.summary).toBe('1 migration will run');
      expect(result.value.databaseMarkerHashBySpace).toBeUndefined();
      expect(result.value.contractHash).toBe(HASH_B);
    }
    expect(mocks.createControlClient).not.toHaveBeenCalled();
  });

  it('plans every migration from the empty contract offline', async () => {
    const result = await executeMigrateShowPlan({
      config,
      cwd: tempDir,
      invocation: { cwd: tempDir, configPath: undefined, dbGiven: false },
      from: EMPTY_CONTRACT_HASH,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.migrations.map((m) => m.dirName)).toEqual([firstDirName, secondDirName]);
      expect(result.value.migrations.map((m) => m.migrationHash)).toEqual([
        firstMigrationHash,
        secondMigrationHash,
      ]);
    }
  });

  function planThenApplyCommands(
    result: Awaited<ReturnType<typeof executeMigrateShowPlan>>,
  ): readonly (string | undefined)[] | undefined {
    if (result.ok) return undefined;
    return result.failure.nextActions
      ?.slice(0, 2)
      .map((action) => (action.kind === 'run-command' ? action.command : undefined));
  }

  it('advises --to with the hash when no path reaches a contract a migration names', async () => {
    const result = await executeMigrateShowPlan({
      config,
      cwd: tempDir,
      invocation: { cwd: tempDir, configPath: undefined, dbGiven: false },
      from: HASH_B,
      to: HASH_A,
    });

    expect(planThenApplyCommands(result)).toEqual([
      `{bin} migration plan --from ${HASH_B} --to ${HASH_A}`,
      `{bin} db migrate --to ${HASH_A}`,
    ]);
  });

  it('advises --to with the ref name when the target is a ref', async () => {
    await writeFile(
      join(appMigrationsDir, 'refs', 'staging.json'),
      JSON.stringify({ formatVersion: 1, hash: HASH_A, invariants: [] }),
    );

    const result = await executeMigrateShowPlan({
      config,
      cwd: tempDir,
      invocation: { cwd: tempDir, configPath: undefined, dbGiven: false },
      from: HASH_B,
      to: 'staging',
    });

    expect(planThenApplyCommands(result)).toEqual([
      `{bin} migration plan --from ${HASH_B} --to staging`,
      '{bin} db migrate --to staging',
    ]);
  });

  it('advises no --to when no path reaches the emitted contract', async () => {
    const emitted = 'c'.repeat(64);
    await writeFile(join(tempDir, 'contract.json'), JSON.stringify(contractJsonForHash(emitted)));

    const result = await executeMigrateShowPlan({
      config,
      cwd: tempDir,
      invocation: { cwd: tempDir, configPath: undefined, dbGiven: false },
      from: HASH_B,
    });

    expect(result.ok ? undefined : result.failure.meta).toMatchObject({ targetHash: emitted });
    expect(planThenApplyCommands(result)).toEqual([
      `{bin} migration plan --from ${HASH_B}`,
      '{bin} db migrate',
    ]);
  });

  it('advises no --to when the target is given as @contract', async () => {
    const emitted = 'c'.repeat(64);
    await writeFile(join(tempDir, 'contract.json'), JSON.stringify(contractJsonForHash(emitted)));

    const result = await executeMigrateShowPlan({
      config,
      cwd: tempDir,
      invocation: { cwd: tempDir, configPath: undefined, dbGiven: false },
      from: HASH_B,
      to: '@contract',
    });

    expect(planThenApplyCommands(result)).toEqual([
      `{bin} migration plan --from ${HASH_B}`,
      '{bin} db migrate',
    ]);
  });

  it('fires onPreflightComplete exactly once, before any client construction', async () => {
    const onPreflightComplete = vi.fn();
    const result = await executeMigrateShowPlan({
      config,
      cwd: tempDir,
      invocation: { cwd: tempDir, configPath: undefined, dbGiven: false },
      from: HASH_A,
      onPreflightComplete,
    });
    expect(result.ok).toBe(true);
    expect(onPreflightComplete).toHaveBeenCalledTimes(1);
    expect(onPreflightComplete).toHaveBeenCalledWith({
      configPath: expect.any(String),
      migrationsRelative: expect.any(String),
      dbConnection: undefined,
      hasExplicitFrom: true,
    });
    expect(mocks.createControlClient).not.toHaveBeenCalled();
  });
});
