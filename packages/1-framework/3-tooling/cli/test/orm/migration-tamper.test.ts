import { mkdir, rm, writeFile } from 'node:fs/promises';
import { writeRef } from '@internal/migration-tools/refs';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import {
  ADDITIVE_OP,
  contractJson,
  createOfflineProject,
  type OfflineProject,
  offlineConfig,
  removeOfflineProjects,
  seedMigrationPackage,
} from './fixtures/offline-project';

/**
 * Tamper detection under the tolerant contract-space model. Each case lays
 * down a valid migration package, corrupts `ops.json` after attestation,
 * and drives a command through the harness. Gating commands (migrate,
 * migration plan, migration status, migration new) refuse via the
 * structured MIGRATION.CONTRACT_SPACE_VIOLATION envelope; read/render
 * commands (migration show) load the tolerant aggregate and succeed.
 */

afterEach(removeOfflineProjects);

const HASH_TO = `${'a'.repeat(64)}`;
const PACKAGE_DIR_NAME = '20260101T0000_tamper_test';

interface Counters {
  connections: number;
}

function driverConfig(project: OfflineProject): {
  readonly config: Record<string, unknown>;
  readonly counters: Counters;
} {
  const counters: Counters = { connections: 0 };
  const base = offlineConfig({ project });
  return {
    counters,
    config: {
      ...base,
      family: {
        ...(base['family'] as Record<string, unknown>),
        create: () => ({
          deserializeContract: (json: unknown) => json,
          readAllMarkers: async () => new Map(),
          readLedger: async () => [],
        }),
      },
      driver: {
        kind: 'driver',
        id: 'pg',
        familyId: 'sql',
        targetId: 'postgres',
        version: '1.0.0',
        create: async () => {
          counters.connections += 1;
          return { close: async () => {} };
        },
      },
      db: { connection: 'postgres://user:secret@localhost:5432/appdb' },
    },
  };
}

function harness(config: Record<string, unknown>) {
  return createTestCli({ commands: BIN_COMMANDS, groups: BIN_GROUPS, config: { orm: config } });
}

/** A project whose only migration's ops.json was rewritten after attestation. */
async function tamperedProject(): Promise<OfflineProject> {
  const project = await createOfflineProject({ storageHash: HASH_TO });
  const { packageDir } = await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: PACKAGE_DIR_NAME,
    from: null,
    to: HASH_TO,
  });
  await writeFile(
    join(packageDir, 'ops.json'),
    JSON.stringify(
      [
        ADDITIVE_OP,
        { id: 'tamper.synthetic', label: 'Synthetic tamper op', operationClass: 'additive' },
      ],
      null,
      2,
    ),
  );
  return project;
}

function errorOf(run: { readonly json: ReadonlyArray<{ readonly kind: string }> }) {
  const terminal = run.json.at(-1) as
    | {
        kind: string;
        envelope?: {
          ok: boolean;
          error?: { code: string; summary: string; meta?: Record<string, unknown> };
        };
      }
    | undefined;
  return terminal?.envelope?.error;
}

function expectIntegrityRefusal(run: {
  readonly exitCode: number;
  readonly json: ReadonlyArray<{ readonly kind: string }>;
}): void {
  expect(run.exitCode).not.toBe(0);
  const error = errorOf(run);
  expect(error?.code).toBe('MIGRATION.CONTRACT_SPACE_VIOLATION');
  expect(error?.summary).toContain('Contract-space integrity failure');
  const violations = error?.meta?.['violations'] as
    | ReadonlyArray<Record<string, unknown>>
    | undefined;
  expect(
    violations?.some(
      (violation) => violation['kind'] === 'hashMismatch' && violation['spaceId'] === 'app',
    ),
  ).toBe(true);
}

describe('migration tamper detection', () => {
  it('migrate refuses offline, before the driver ever connects', async () => {
    const project = await tamperedProject();
    const { config, counters } = driverConfig(project);

    const run = await harness(config).run(['db', 'migrate', '--json'], { cwd: project.dir });

    expectIntegrityRefusal(run);
    expect(counters.connections).toBe(0);
  });

  it('migration plan refuses before planning work', async () => {
    const project = await tamperedProject();

    const run = await harness(offlineConfig({ project })).run(['migration', 'plan', '--json'], {
      cwd: project.dir,
    });

    expectIntegrityRefusal(run);
  });

  it('migration status refuses on the reader-subset package-corruption check', async () => {
    const project = await tamperedProject();
    const { config } = driverConfig(project);

    const run = await harness(config).run(['migration', 'status', '--json'], {
      cwd: project.dir,
    });

    expectIntegrityRefusal(run);
  });

  it('migration status tolerates package corruption when the app contract is unreadable', async () => {
    const project = await tamperedProject();
    await rm(project.contractPath);
    const { config } = driverConfig(project);

    const run = await harness(config).run(['migration', 'status', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(
      run.presented?.diagnostics.some((diagnostic) => diagnostic.code === 'CONTRACT.UNREADABLE'),
    ).toBe(true);
  });

  it('migration new refuses on the app-space hash mismatch before scaffolding', async () => {
    const project = await tamperedProject();

    const run = await harness(offlineConfig({ project })).run(
      ['migration', 'new', '--name', 'next', '--json'],
      { cwd: project.dir },
    );

    expectIntegrityRefusal(run);
  });

  it('migration new proceeds when cross-space layout drift is the only integrity fault', async () => {
    const ORPHAN_HASH = `${'c'.repeat(64)}`;
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await mkdir(project.appMigrationsDir, { recursive: true });
    const orphanDir = join(project.migrationsDir, 'orphan_ext');
    await seedMigrationPackage({
      appMigrationsDir: orphanDir,
      dirName: '00001_orphan_base',
      from: null,
      to: ORPHAN_HASH,
    });
    await writeRef(join(orphanDir, 'refs'), 'head', { hash: ORPHAN_HASH, invariants: [] });
    await writeFile(join(orphanDir, 'contract.json'), JSON.stringify(contractJson(ORPHAN_HASH)));

    const run = await harness(offlineConfig({ project })).run(
      ['migration', 'new', '--name', 'layout-drift-ok', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      ok: true,
      dir: expect.stringMatching(/migrations[/\\]app[/\\]/),
    });
  });

  it('migration show renders a tampered package from the tolerant aggregate', async () => {
    const project = await tamperedProject();

    const run = await harness(offlineConfig({ project })).run(
      ['migration', 'show', join('migrations', 'app', PACKAGE_DIR_NAME), '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ ok: true });
  });
});
