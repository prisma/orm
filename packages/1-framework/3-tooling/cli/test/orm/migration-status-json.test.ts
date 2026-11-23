import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { removeOfflineProjects } from './fixtures/offline-project';
import {
  driverConfig,
  fakeDatabase,
  HASH_BASE,
  HASH_HEAD,
  HASH_UNKNOWN,
  harness,
  markersAt,
  projectWithOneMigration,
  projectWithTwoMigrations,
} from './fixtures/status-database';

afterEach(removeOfflineProjects);

async function pending() {
  const project = await projectWithOneMigration();
  return harness(driverConfig(project)).run(['migration', 'status', '--json'], {
    cwd: project.dir,
  });
}

async function noPath() {
  const project = await projectWithTwoMigrations();
  const db = fakeDatabase({
    markers: markersAt(HASH_BASE),
    ledger: [{ migrationHash: project.baseMigrationHash }],
  });
  return harness(driverConfig(project, db)).run(
    ['migration', 'status', '--from', '@contract', '--to', '@db', '--json'],
    { cwd: project.dir },
  );
}

async function markerOffGraph() {
  const project = await projectWithOneMigration();
  const db = fakeDatabase({ markers: markersAt(HASH_UNKNOWN) });
  return harness(driverConfig(project, db)).run(['migration', 'status', '--json'], {
    cwd: project.dir,
  });
}

async function contractUnreadable() {
  const project = await projectWithOneMigration();
  await rm(project.contractPath);
  const db = fakeDatabase({ markers: markersAt(HASH_HEAD) });
  return harness(driverConfig(project, db)).run(['migration', 'status', '--json'], {
    cwd: project.dir,
  });
}

describe('migration status --json', () => {
  it.each([
    ['migrations are pending', pending],
    ['no path reaches the target', noPath],
    ['the marker is off the graph', markerOffGraph],
    ['the contract is unreadable', contractUnreadable],
  ])('leaves no {bin} placeholder in the output when %s', async (_, scenario) => {
    const run = await scenario();

    expect(run.exitCode).toBe(0);
    expect(run.json.length).toBeGreaterThan(0);
    expect(JSON.stringify(run.json)).not.toContain('{bin}');
  });

  it('states the pending count in the summary and the migrate command as a next action', async () => {
    const run = await pending();

    expect(run.presented?.data).toMatchObject({ summary: '1 pending' });
    expect(run.presented?.presentation.next).toEqual([
      {
        kind: 'run-command',
        label: 'Apply the pending migrations',
        command: `prisma-test db migrate --to ${HASH_HEAD.slice(0, 12)}`,
      },
    ]);
  });

  it('repeats --db in the migrate command when status was given --db', async () => {
    const project = await projectWithOneMigration();
    const run = await harness(driverConfig(project)).run(
      ['migration', 'status', '--db', 'postgresql://localhost/app', '--json'],
      { cwd: project.dir },
    );

    expect(run.presented?.presentation.next).toEqual([
      expect.objectContaining({
        command: `prisma-test db migrate --to ${HASH_HEAD.slice(0, 12)} --db <url>`,
      }),
    ]);
  });

  it('plans the missing migration from the --from contract to the --to target', async () => {
    const run = await noPath();

    expect(run.presented?.data).toMatchObject({
      summary: `No migration path from the --from contract (${HASH_HEAD.slice(0, 12)}) to the target (${HASH_BASE.slice(0, 12)}).`,
    });
    expect(run.presented?.presentation.next).toEqual([
      {
        kind: 'run-command',
        label: 'Plan the missing migration',
        command: `prisma-test migration plan --from ${HASH_HEAD} --to ${HASH_BASE} --name <name>`,
      },
      {
        kind: 'run-command',
        label: 'Then apply it',
        command: `prisma-test db migrate --to ${HASH_BASE}`,
      },
      { kind: 'user-choice', label: 'Or pass `--to <contract>` to pick a reachable target' },
    ]);
  });
});
