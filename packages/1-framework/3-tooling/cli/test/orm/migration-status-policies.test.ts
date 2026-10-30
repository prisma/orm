import { writeRef } from '@internal/migration-tools/refs';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { afterEach, describe, expect, it } from 'vitest';
import { removeOfflineProjects } from './fixtures/offline-project';
import {
  driverConfig,
  fakeDatabase,
  HASH_HEAD,
  HASH_UNKNOWN,
  harness,
  projectWithOneMigration,
} from './fixtures/status-database';

afterEach(removeOfflineProjects);

function markerWithPolicies(policies: unknown, storageHash: string = HASH_HEAD) {
  return new Map([
    [
      'app',
      {
        storageHash,
        profileHash: '',
        contractJson: null,
        canonicalVersion: null,
        updatedAt: new Date(0),
        appTag: null,
        meta: policies === undefined ? {} : { policies },
        invariants: [] as readonly string[],
      },
    ],
  ]);
}

async function statusAgainst(args: { readonly policies: unknown; readonly json: boolean }) {
  const project = await projectWithOneMigration();
  await writeRef(join(project.appMigrationsDir, 'refs'), 'production', {
    hash: HASH_HEAD,
    invariants: [],
    policies: { change: ['migrate'], dataProtection: { dataLoss: 'data-loss-forbidden' } },
  });
  const db = fakeDatabase({
    markers: markerWithPolicies(args.policies),
    ledger: [{ migrationHash: project.migrationHash }],
  });
  return harness(driverConfig(project, db)).run(
    ['migration', 'status', '--to', 'production', ...(args.json ? ['--json'] : [])],
    { cwd: project.dir, isTty: { stdout: true } },
  );
}

describe('migration status --to <ref>, the ref declares policies', () => {
  it('lists each declared setting that differs from the database, and says so in the summary', async () => {
    const run = await statusAgainst({ policies: undefined, json: false });

    expect(run.exitCode).toBe(0);
    const output = stripAnsi(run.stdout + run.stderr);
    expect(output).toContain('differences');
    expect(output).toContain('change: ref declares migrate, database has migrate, reconcile');
    expect(output).toContain(
      'dataProtection.dataLoss: ref declares data-loss-forbidden, database has data-loss-with-consent',
    );
    expect(output).toContain('Up to date; policies differ from production');
  });

  it('carries the differences in the json document', async () => {
    const run = await statusAgainst({ policies: { change: ['migrate'] }, json: true });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      summary: 'Up to date; policies differ from production',
      policyDifferences: [
        {
          setting: 'dataProtection.dataLoss',
          declared: 'data-loss-forbidden',
          inForce: 'data-loss-with-consent',
        },
      ],
    });
  });

  it('reports no differences when the database records what the ref declares', async () => {
    const run = await statusAgainst({
      policies: { change: ['migrate'], dataProtection: { dataLoss: 'data-loss-forbidden' } },
      json: true,
    });

    expect(run.presented?.data).toMatchObject({ summary: 'Up to date', policyDifferences: [] });
  });
});

describe('migration status on a marker outside the migration graph', () => {
  async function offGraphStatus(policies: unknown) {
    const project = await projectWithOneMigration();
    const db = fakeDatabase({ markers: markerWithPolicies(policies, HASH_UNKNOWN) });
    return harness(driverConfig(project, db)).run(['migration', 'status', '--json'], {
      cwd: project.dir,
    });
  }

  it('advises only authoring migrations when the change policy permits only migrations', async () => {
    const run = await offGraphStatus({ change: ['migrate'] });
    const advice =
      "This database's change policy permits only migrations: author migrations that bring it back onto the migration graph, commit them, and deploy again";

    expect(run.presented?.diagnostics).toMatchObject([
      {
        code: 'MIGRATION.MARKER_NOT_IN_HISTORY',
        meta: { space: 'app', change: ['migrate'] },
        nextActions: [{ kind: 'user-choice', label: advice }],
      },
    ]);
    expect(run.presented?.data).toMatchObject({
      diagnostics: [{ code: 'MIGRATION.MARKER_NOT_IN_HISTORY', hints: [advice] }],
    });
  });

  it('advises db sign and db update when the change policy permits reconciling', async () => {
    const run = await offGraphStatus(undefined);

    expect(run.presented?.diagnostics).toMatchObject([
      {
        code: 'MIGRATION.MARKER_NOT_IN_HISTORY',
        nextActions: [{ command: 'prisma-test db sign' }, { command: 'prisma-test db update' }],
      },
    ]);
  });
});
