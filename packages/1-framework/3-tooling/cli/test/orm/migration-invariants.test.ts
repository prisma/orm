import { writeRef } from '@internal/migration-tools/refs';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import {
  createOfflineProject,
  invariantOp,
  type OfflineProject,
  offlineConfig,
  removeOfflineProjects,
  seedMigrationPackage,
} from './fixtures/offline-project';

/**
 * The UNKNOWN_INVARIANT pre-check in `migrate --to` and `migration status
 * --to` — the only invariant-routing refusal reachable without a real
 * database. Marker-subtraction and NO_INVARIANT_PATH live in the journey
 * suite (test/integration cli-journeys).
 */

afterEach(removeOfflineProjects);

const TO_HASH = `${'a'.repeat(64)}`;
const REF_HASH = `${'b'.repeat(64)}`;

interface MarkerScript {
  readonly hash?: string;
  readonly invariants?: readonly string[];
}

function driverConfig(project: OfflineProject, marker: MarkerScript = {}): Record<string, unknown> {
  const markers =
    marker.hash === undefined
      ? new Map()
      : new Map([['app', { storageHash: marker.hash, invariants: marker.invariants ?? [] }]]);
  const base = offlineConfig({ project });
  return {
    ...base,
    family: {
      ...(base['family'] as Record<string, unknown>),
      create: () => ({
        deserializeContract: (json: unknown) => json,
        readAllMarkers: async () => markers,
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
 * One migration ∅ → TO_HASH whose edge declares `edgeInvariants`, and a
 * `prod` ref at TO_HASH requiring `refInvariants`.
 */
async function projectWithRef(options: {
  readonly refInvariants: readonly string[];
  readonly edgeInvariants?: readonly string[];
}): Promise<OfflineProject> {
  const project = await createOfflineProject({ storageHash: TO_HASH });
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: '20260101T0000_create_users',
    from: null,
    to: TO_HASH,
    ops: (options.edgeInvariants ?? []).map(invariantOp),
  });
  await writeRef(join(project.appMigrationsDir, 'refs'), 'prod', {
    hash: TO_HASH,
    invariants: [...options.refInvariants],
  });
  return project;
}

function errorCodeOf(run: {
  readonly json: ReadonlyArray<{ readonly kind: string }>;
}): string | undefined {
  const terminal = run.json.at(-1) as
    | { kind: string; envelope?: { ok: boolean; error?: { code: string } } }
    | undefined;
  return terminal?.envelope?.error?.code;
}

describe('migrate --to invariant pre-check', () => {
  it('refuses a ref naming an invariant no edge declares', async () => {
    const project = await projectWithRef({
      refInvariants: ['typo-id'],
      edgeInvariants: ['real-id'],
    });

    const run = await harness(driverConfig(project)).run(
      ['db', 'migrate', '--to', 'prod', '--json'],
      {
        cwd: project.dir,
      },
    );

    expect(run.exitCode).not.toBe(0);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'MIGRATION.UNKNOWN_INVARIANT',
          meta: { unknown: ['typo-id'], declared: ['real-id'] },
        },
      },
    });
  });

  it('treats a retired invariant already on the marker as known', async () => {
    const project = await projectWithRef({ refInvariants: ['retired-id'] });

    const run = await harness(
      driverConfig(project, { hash: TO_HASH, invariants: ['retired-id'] }),
    ).run(['db', 'migrate', '--to', 'prod', '--json'], { cwd: project.dir });

    expect(errorCodeOf(run)).not.toBe('MIGRATION.UNKNOWN_INVARIANT');
    expect(JSON.stringify(run.json)).not.toContain('MIGRATION.UNKNOWN_INVARIANT');
  });

  it('skips the pre-check when the ref requires no invariants', async () => {
    const project = await projectWithRef({ refInvariants: [], edgeInvariants: ['real-id'] });

    const run = await harness(driverConfig(project)).run(
      ['db', 'migrate', '--to', 'prod', '--json'],
      {
        cwd: project.dir,
      },
    );

    expect(errorCodeOf(run)).not.toBe('MIGRATION.UNKNOWN_INVARIANT');
    expect(JSON.stringify(run.json)).not.toContain('MIGRATION.UNKNOWN_INVARIANT');
  });
});

describe('migration status --to invariant pre-check', () => {
  it('refuses an unknown ref invariant just as migrate does, not as a warning', async () => {
    const project = await projectWithRef({
      refInvariants: ['typo-id'],
      edgeInvariants: ['real-id'],
    });

    const run = await harness(driverConfig(project, { hash: TO_HASH })).run(
      ['migration', 'status', '--to', 'prod', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).not.toBe(0);
    expect(errorCodeOf(run)).toBe('MIGRATION.UNKNOWN_INVARIANT');
  });

  it('does not refuse when the marker already holds the retired invariant', async () => {
    const project = await projectWithRef({ refInvariants: ['retired-id'] });

    const run = await harness(
      driverConfig(project, { hash: TO_HASH, invariants: ['retired-id'] }),
    ).run(['migration', 'status', '--to', 'prod', '--json'], { cwd: project.dir });

    expect(errorCodeOf(run)).not.toBe('MIGRATION.UNKNOWN_INVARIANT');
    expect(JSON.stringify(run.json)).not.toContain('MIGRATION.UNKNOWN_INVARIANT');
  });

  it('does not claim up to date when the marker cannot reach the ref', async () => {
    const project = await createOfflineProject({ storageHash: REF_HASH });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_branch_a',
      from: null,
      to: TO_HASH,
    });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260102T0000_branch_b',
      from: null,
      to: REF_HASH,
    });
    await writeRef(join(project.appMigrationsDir, 'refs'), 'prod', {
      hash: REF_HASH,
      invariants: [],
    });

    const run = await harness(driverConfig(project, { hash: TO_HASH })).run(
      ['migration', 'status', '--to', 'prod', '--json'],
      { cwd: project.dir },
    );
    const document = run.presented?.data as { summary?: string };

    expect(run.exitCode).toBe(0);
    expect(document.summary).not.toMatch(/up to date/i);
  });
});
