import stripAnsi from 'strip-ansi';
import { afterEach, describe, expect, it } from 'vitest';
import { removeOfflineProjects } from './fixtures/offline-project';
import {
  addAllExternalSpace,
  codesAndSeverities,
  DIR_BASE,
  DIR_HEAD,
  driverConfig,
  EXTERNAL_SPACE,
  fakeDatabase,
  HASH_BASE,
  HASH_EXTERNAL_HEAD,
  HASH_HEAD,
  HASH_UNKNOWN,
  harness,
  markersAt,
  markersWithExternalAtHead,
  projectWithOneMigration,
  projectWithTwoMigrations,
  withAllExternalExtension,
} from './fixtures/status-database';

afterEach(removeOfflineProjects);

describe('migration status with reserved contract references', () => {
  it('resolves --to @contract to the emitted contract, the same as no --to', async () => {
    const project = await projectWithOneMigration();
    const db = fakeDatabase({
      markers: markersAt(HASH_HEAD),
      ledger: [{ migrationHash: project.migrationHash }],
    });
    const config = driverConfig(project, db);

    const implicit = await harness(config).run(['migration', 'status', '--json'], {
      cwd: project.dir,
    });
    const explicit = await harness(config).run(
      ['migration', 'status', '--to', '@contract', '--json'],
      { cwd: project.dir },
    );

    expect(explicit.exitCode).toBe(0);
    expect(explicit.presented?.data).toEqual(implicit.presented?.data);
    expect(explicit.presented?.data).toMatchObject({
      summary: 'Up to date',
      spaces: [{ targetContract: HASH_HEAD }],
    });
  });

  it('targets each extension space at its own contract for --to @contract', async () => {
    const project = await projectWithOneMigration();
    await addAllExternalSpace(project);
    const db = fakeDatabase({
      markers: markersWithExternalAtHead(HASH_HEAD),
      ledger: [{ migrationHash: project.migrationHash }],
    });

    const config = withAllExternalExtension(driverConfig(project, db));

    const implicit = await harness(config).run(['migration', 'status', '--json'], {
      cwd: project.dir,
    });
    const run = await harness(config).run(['migration', 'status', '--to', '@contract', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toEqual(implicit.presented?.data);
    expect(run.presented?.data).toMatchObject({
      summary: 'Up to date',
      diagnostics: [],
      spaces: expect.arrayContaining([
        expect.objectContaining({ space: 'app', targetContract: HASH_HEAD }),
        expect.objectContaining({
          space: EXTERNAL_SPACE,
          currentContract: HASH_EXTERNAL_HEAD,
          targetContract: HASH_EXTERNAL_HEAD,
        }),
      ]),
    });
  });

  it('resolves --from @contract offline', async () => {
    const project = await projectWithOneMigration();
    const db = fakeDatabase();

    const run = await harness(driverConfig(project, db)).run(
      ['migration', 'status', '--from', '@contract', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(db.counters.connections).toBe(0);
    expect(run.presented?.data).toMatchObject({
      summary: 'Up to date',
      spaces: [{ currentContract: HASH_HEAD, targetContract: HASH_HEAD }],
    });
  });

  it('resolves --to @db to the live marker and reports up to date', async () => {
    const project = await projectWithTwoMigrations();
    const db = fakeDatabase({
      markers: markersAt(HASH_BASE),
      ledger: [{ migrationHash: project.baseMigrationHash }],
    });

    const run = await harness(driverConfig(project, db)).run(
      ['migration', 'status', '--to', '@db', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      summary: 'Up to date',
      diagnostics: [],
      spaces: [{ currentContract: HASH_BASE, targetContract: HASH_BASE }],
    });
  });

  it('reports the migration pending between the live marker and --to when --from is @db', async () => {
    const project = await projectWithTwoMigrations();
    const db = fakeDatabase({
      markers: markersAt(HASH_BASE),
      ledger: [{ migrationHash: project.baseMigrationHash }],
    });

    const run = await harness(driverConfig(project, db)).run(
      ['migration', 'status', '--from', '@db', '--to', DIR_HEAD, '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(db.counters.connections).toBe(1);
    expect(run.presented?.data).toMatchObject({
      summary: `1 pending — run \`{bin} db migrate --to ${HASH_HEAD.slice(0, 12)}\``,
      spaces: [
        {
          currentContract: HASH_BASE,
          targetContract: HASH_HEAD,
          migrations: expect.arrayContaining([
            expect.objectContaining({ name: DIR_BASE, status: 'applied' }),
            expect.objectContaining({ name: DIR_HEAD, status: 'pending' }),
          ]),
        },
      ],
    });
  });

  it('reads the database only for the target when --from is a hash and --to is @db', async () => {
    const project = await projectWithTwoMigrations();
    const db = fakeDatabase({
      markers: markersAt(HASH_HEAD),
      ledger: [{ migrationHash: project.baseMigrationHash }],
    });

    const run = await harness(driverConfig(project, db)).run(
      ['migration', 'status', '--from', HASH_BASE, '--to', '@db', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(db.counters.connections).toBe(1);
    expect(run.presented?.data).toMatchObject({
      spaces: [
        {
          currentContract: HASH_BASE,
          targetContract: HASH_HEAD,
          migrations: expect.not.arrayContaining([expect.objectContaining({ status: 'applied' })]),
        },
      ],
    });
  });

  it('labels the database marker @db in the tree when --from is a hash and --to is @db', async () => {
    const project = await projectWithTwoMigrations();
    const db = fakeDatabase({ markers: markersAt(HASH_BASE) });

    const run = await harness(driverConfig(project, db)).run(
      ['migration', 'status', '--from', HASH_BASE, '--to', '@db'],
      { cwd: project.dir, isTty: { stdout: true, stderr: true } },
    );
    const dbLines = stripAnsi(run.stderr)
      .split('\n')
      .filter((line) => line.includes('@db'));

    expect(run.exitCode).toBe(0);
    expect(dbLines).toHaveLength(1);
    expect(dbLines[0]).toContain(HASH_BASE.slice(0, 7));
  });

  it('labels the empty node @db when --to @db reads a database with no marker', async () => {
    const project = await projectWithTwoMigrations();
    const db = fakeDatabase();

    const run = await harness(driverConfig(project, db)).run(
      ['migration', 'status', '--to', '@db'],
      {
        cwd: project.dir,
        isTty: { stdout: true, stderr: true },
      },
    );
    const dbLines = stripAnsi(run.stderr)
      .split('\n')
      .filter((line) => line.includes('@db'));

    expect(run.exitCode).toBe(0);
    expect(dbLines).toHaveLength(1);
    expect(dbLines[0]).toContain('∅');
  });

  it('reports no path when --from @contract is ahead of the database named by --to @db', async () => {
    const project = await projectWithTwoMigrations();
    const db = fakeDatabase({
      markers: markersAt(HASH_BASE),
      ledger: [{ migrationHash: project.baseMigrationHash }],
    });

    const run = await harness(driverConfig(project, db)).run(
      ['migration', 'status', '--from', '@contract', '--to', '@db', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      summary: `No migration path from the --from contract (${HASH_HEAD.slice(0, 12)}) to the target (${HASH_BASE.slice(0, 12)}). Run \`{bin} migration plan --name <name>\` to author one, or pass \`--to <contract>\` to pick a reachable target.`,
    });
  });

  it('warns when --to @db reads a marker outside the graph and --from is a hash', async () => {
    const project = await projectWithTwoMigrations();
    const db = fakeDatabase({ markers: markersAt(HASH_UNKNOWN) });

    const run = await harness(driverConfig(project, db)).run(
      ['migration', 'status', '--from', HASH_BASE, '--to', '@db', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(codesAndSeverities(run.presented?.diagnostics ?? [])).toEqual([
      { code: 'MIGRATION.MARKER_NOT_IN_HISTORY', severity: 'warn' },
    ]);
    expect(run.presented?.data).toMatchObject({
      summary: `Database marker ${HASH_UNKNOWN.slice(0, 12)} is not in the on-disk migration graph`,
    });
  });

  it('errors with the connection-required envelope for --to @db without a connection', async () => {
    const project = await projectWithOneMigration();
    const config = driverConfig(project);

    const run = await harness({ ...config, db: undefined }).run(
      ['migration', 'status', '--from', HASH_HEAD, '--to', '@db', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'CONFIG.DB_CONNECTION_REQUIRED',
          why: expect.stringContaining('@db'),
          meta: { missingFlags: ['--db'] },
          nextActions: [
            expect.objectContaining({
              label: expect.stringContaining(
                `migration status --from ${HASH_HEAD} --to @db --db $DATABASE_URL`,
              ),
            }),
          ],
        },
      },
    });
  });

  it('errors with the connection-required envelope for --from @db without a connection', async () => {
    const project = await projectWithOneMigration();
    const config = driverConfig(project);

    const run = await harness({ ...config, db: undefined }).run(
      ['migration', 'status', '--from', '@db', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: { code: 'CONFIG.DB_CONNECTION_REQUIRED', meta: { missingFlags: ['--db'] } },
      },
    });
  });
});
