import { writeFile } from 'node:fs/promises';
import { writeRef } from '@internal/migration-tools/refs';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import type { MigrationCheckResult } from '../../src/commands/json/schemas';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import {
  contractJson,
  createOfflineProject,
  type OfflineProject,
  offlineConfig,
  removeOfflineProjects,
  seedContractSnapshot,
  seedMigrationPackage,
} from './fixtures/offline-project';

/**
 * Cross-consumer integrity matrix under the tolerant contract-space model.
 * One on-disk project is planted with three independent faults — a
 * `from === to` self-edge with no data op, a hash-mismatched package, and an
 * orphan space dir no extension declares — and the consumers are driven
 * against it: `migration check` reports the full violation set in one run,
 * `migrate` refuses with layout drift taking precedence over package
 * corruption, and the read/render commands tolerate the self-edge.
 * The package-corruption refusals of migrate/plan/status/new are pinned in
 * test/orm/migration-tamper.test.ts and are not repeated here.
 */

afterEach(removeOfflineProjects);

const HASH_A = `${'a'.repeat(64)}`;
const HASH_B = `${'b'.repeat(64)}`;
const HASH_C = `${'c'.repeat(64)}`;

const TAMPERED_OPS = [
  { id: 'table.users', label: 'Create table users', operationClass: 'additive' },
  { id: 'tamper.synthetic', label: 'Synthetic tamper op', operationClass: 'additive' },
];

async function tamperOps(packageDir: string): Promise<void> {
  await writeFile(join(packageDir, 'ops.json'), JSON.stringify(TAMPERED_OPS, null, 2));
}

function extensionDescriptor(id: string): Record<string, unknown> {
  return {
    kind: 'extension',
    id,
    familyId: 'sql',
    targetId: 'postgres',
    version: '1.0.0',
    create: () => ({}),
    contractSpace: {
      contractJson: contractJson(HASH_C),
      headRef: { hash: HASH_C, invariants: [] },
      migrations: [],
    },
  };
}

function driverConfig(project: OfflineProject): Record<string, unknown> {
  const base = offlineConfig({ project });
  return {
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
      create: async () => ({ close: async () => {} }),
    },
    db: { connection: 'postgres://user:secret@localhost:5432/appdb' },
  };
}

function harness(config: Record<string, unknown>) {
  return createTestCli({ commands: BIN_COMMANDS, groups: BIN_GROUPS, config: { orm: config } });
}

/**
 * A self-consistent space dir that is a fault only because no extension
 * declares it: clean package, head ref, on-disk contract, and its snapshot.
 */
async function seedCleanOrphanSpace(project: OfflineProject, spaceId: string): Promise<void> {
  const spaceDir = join(project.migrationsDir, spaceId);
  await seedMigrationPackage({
    appMigrationsDir: spaceDir,
    dirName: '00001_orphan_base',
    from: null,
    to: HASH_C,
  });
  await writeRef(join(spaceDir, 'refs'), 'head', { hash: HASH_C, invariants: [] });
  await writeFile(join(spaceDir, 'contract.json'), JSON.stringify(contractJson(HASH_C)));
  await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_C });
}

/** Self-edge (A → A, no ops), tampered package (A → B), and an orphan space. */
async function allThreeFixture(): Promise<OfflineProject> {
  const project = await createOfflineProject({ storageHash: HASH_B });
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: '00001_base',
    from: null,
    to: HASH_A,
  });
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: '00002_selfedge',
    from: HASH_A,
    to: HASH_A,
    ops: [],
  });
  const tampered = await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: '00003_tamper',
    from: HASH_A,
    to: HASH_B,
  });
  await tamperOps(tampered.packageDir);
  await seedCleanOrphanSpace(project, 'orphan_ext');
  return project;
}

/** A base package plus an A → A self-edge; nothing else wrong. */
async function selfEdgeFixture(): Promise<OfflineProject> {
  const project = await createOfflineProject({ storageHash: HASH_A });
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: '00001_base',
    from: null,
    to: HASH_A,
  });
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: '00002_selfedge',
    from: HASH_A,
    to: HASH_A,
    ops: [],
  });
  return project;
}

function documentOf(run: { readonly presented: { readonly data: unknown } | undefined }) {
  return run.presented?.data as MigrationCheckResult;
}

describe('cross-consumer contract-space integrity matrix', () => {
  it('migration check reports the hash mismatch, self-edge and orphan dir in one run', async () => {
    const project = await allThreeFixture();

    const run = await harness(offlineConfig({ project })).run(['migration', 'check', '--json'], {
      cwd: project.dir,
    });
    const codes = documentOf(run).failures.map((failure) => failure.code);

    expect(run.exitCode).toBe(4);
    expect(codes).toContain('MIGRATION.CHECK_HASH_MISMATCH');
    expect(codes).toContain('MIGRATION.CHECK_NOOP_SELF_EDGE');
    expect(codes).toContain('MIGRATION.CHECK_ORPHAN_SPACE_DIR');
    expect(codes.filter((code) => code === 'MIGRATION.CHECK_HASH_MISMATCH')).toHaveLength(1);
  });

  it('migration check reports package corruption living in a declared extension space', async () => {
    const project = await createOfflineProject({ storageHash: HASH_A });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '00001_base',
      from: null,
      to: HASH_A,
    });
    const extDir = join(project.migrationsDir, 'ext_a');
    await seedMigrationPackage({
      appMigrationsDir: extDir,
      dirName: '00001_base',
      from: null,
      to: HASH_B,
    });
    const tampered = await seedMigrationPackage({
      appMigrationsDir: extDir,
      dirName: '00002_tamper',
      from: HASH_B,
      to: HASH_C,
    });
    await tamperOps(tampered.packageDir);
    await writeRef(join(extDir, 'refs'), 'head', { hash: HASH_C, invariants: [] });
    await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_C });

    const run = await harness({
      ...offlineConfig({ project }),
      extensions: [extensionDescriptor('ext_a')],
    }).run(['migration', 'check', '--json'], { cwd: project.dir });
    const hashFailures = documentOf(run).failures.filter(
      (failure) => failure.code === 'MIGRATION.CHECK_HASH_MISMATCH',
    );

    expect(run.exitCode).toBe(4);
    expect(hashFailures).toHaveLength(1);
    expect(hashFailures[0]?.where).toContain('ext_a');
  });

  it('migrate refuses the all-three project with layout drift taking precedence', async () => {
    const project = await allThreeFixture();

    const run = await harness(driverConfig(project)).run(['db', 'migrate', '--json'], {
      cwd: project.dir,
    });
    const terminal = run.json.at(-1) as
      | {
          kind: string;
          envelope?: { ok: boolean; error?: { code: string; meta?: Record<string, unknown> } };
        }
      | undefined;
    const violations = (terminal?.envelope?.error?.meta?.['violations'] ?? []) as ReadonlyArray<
      Record<string, unknown>
    >;

    expect(run.exitCode).not.toBe(0);
    expect(terminal?.envelope?.error?.code).toBe('MIGRATION.CONTRACT_SPACE_LAYOUT_VIOLATION');
    expect(violations.some((violation) => violation['kind'] === 'orphanSpaceDir')).toBe(true);
  });

  it('migration status tolerates a self-edge and renders at exit 0', async () => {
    const project = await selfEdgeFixture();

    const run = await harness(driverConfig(project)).run(['migration', 'status', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(run.json.at(-1)).toMatchObject({ kind: 'result', envelope: { ok: true, exitCode: 0 } });
  });

  it('migration show renders the self-edge package at exit 0', async () => {
    const project = await selfEdgeFixture();

    const run = await harness(offlineConfig({ project })).run(
      ['migration', 'show', join('migrations', 'app', '00002_selfedge'), '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(JSON.stringify(run.presented?.data)).toContain(HASH_A);
  });
});
