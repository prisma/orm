import type { Diagnostic } from '@prisma/cli-engine/protocol';
import { createTestCli } from '@prisma/cli-engine/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import {
  createOfflineProject,
  type OfflineProject,
  offlineConfig,
  removeOfflineProjects,
  seedMigrationPackage,
} from './fixtures/offline-project';

afterEach(removeOfflineProjects);

const HASH_HEAD = `c0ffee${'0'.repeat(58)}`;
const HASH_UNKNOWN = `dead${'2'.repeat(60)}`;

/**
 * A family whose single-contract marker check passes and whose marker table
 * places the app space at a hash the contract does not carry, so the aggregate
 * verifier reports `hashMismatch` for the app space.
 */
function driftedFamilyConfig(project: OfflineProject): Record<string, unknown> {
  const base = offlineConfig({ project });
  return {
    ...base,
    family: {
      ...(base['family'] as Record<string, unknown>),
      create: () => ({
        deserializeContract: (json: unknown) => json,
        readAllMarkers: async () =>
          new Map([['app', { storageHash: HASH_UNKNOWN, invariants: [] as readonly string[] }]]),
        readLedger: async () => [],
        verify: async () => ({
          ok: true,
          summary: 'Database marker matches contract',
          contract: { storageHash: HASH_HEAD },
          marker: { storageHash: HASH_HEAD },
          target: { expected: 'postgres', actual: 'postgres' },
          timings: { total: 1 },
        }),
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

describe('db verify app-space marker drift', () => {
  it('names the binary in the violation remediation carried by --json meta', async () => {
    const project = await createOfflineProject({ storageHash: HASH_HEAD });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_HEAD,
    });

    const run = await createTestCli({
      commands: BIN_COMMANDS,
      groups: BIN_GROUPS,
      config: { orm: driftedFamilyConfig(project) },
    }).run(['db', 'verify', '--marker-only', '--json'], { cwd: project.dir });

    const [drift] = run.presented?.diagnostics ?? [];
    const violations = (drift as Diagnostic | undefined)?.meta?.['violations'];
    expect(run.exitCode).toBe(4);
    expect(violations).toEqual([
      {
        kind: 'hashMismatch',
        spaceId: 'app',
        remediation:
          'Run `prisma db update` to advance the marker, or roll the database back to the recorded hash.',
      },
    ]);
  });
});
