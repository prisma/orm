import { rm } from 'node:fs/promises';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { writeRef } from '@internal/migration-tools/refs';
import type { Diagnostic } from '@prisma/cli-engine/protocol';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
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

afterEach(removeOfflineProjects);

const HASH_HEAD = `c0ffee${'0'.repeat(58)}`;
const HASH_BASE = `beef${'1'.repeat(60)}`;
const HASH_UNKNOWN = `dead${'2'.repeat(60)}`;
const CONNECTION = 'postgres://user:secret@localhost:5432/appdb';

interface FakeDatabaseScript {
  readonly markers?: ReadonlyMap<
    string,
    { readonly storageHash: string; readonly invariants: readonly string[] }
  >;
  readonly ledger?: ReadonlyArray<{ readonly migrationHash: string }>;
  readonly readMarkersError?: Error;
  readonly closeError?: Error;
}

/**
 * The database the real control client talks to: the family instance answers
 * marker and ledger reads from the script, and the driver descriptor counts
 * connections so tests can assert none was opened. No module mocks — the
 * command builds the real client over these descriptors.
 */
function fakeDatabase(script: FakeDatabaseScript = {}) {
  const counters = { connections: 0, closes: 0 };
  const familyInstance = {
    deserializeContract: (json: unknown) => json,
    readAllMarkers: async () => {
      if (script.readMarkersError !== undefined) {
        throw script.readMarkersError;
      }
      return script.markers ?? new Map();
    },
    readLedger: async () => script.ledger ?? [],
  };
  const driver = {
    close: async () => {
      counters.closes += 1;
      if (script.closeError !== undefined) {
        throw script.closeError;
      }
    },
  };
  return { counters, familyInstance, driver };
}

type FakeDatabase = ReturnType<typeof fakeDatabase>;

function driverConfig(
  project: OfflineProject,
  db: FakeDatabase = fakeDatabase(),
): Record<string, unknown> {
  const base = offlineConfig({ project });
  return {
    ...base,
    family: { ...(base['family'] as Record<string, unknown>), create: () => db.familyInstance },
    driver: {
      kind: 'driver',
      id: 'pg',
      familyId: 'sql',
      targetId: 'postgres',
      version: '1.0.0',
      create: async () => {
        db.counters.connections += 1;
        return db.driver;
      },
    },
    db: { connection: CONNECTION },
  };
}

function harness(config: Record<string, unknown>) {
  return createTestCli({ commands: BIN_COMMANDS, groups: BIN_GROUPS, config: { orm: config } });
}

/** A project whose app space carries one migration ∅ → HASH_HEAD. */
async function projectWithOneMigration(): Promise<
  OfflineProject & { readonly migrationHash: string }
> {
  const project = await createOfflineProject({ storageHash: HASH_HEAD });
  const seeded = await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: '20260101T0000_initial',
    from: null,
    to: HASH_HEAD,
  });
  return { ...project, migrationHash: seeded.migrationHash };
}

function markersAt(storageHash: string) {
  return new Map([['app', { storageHash, invariants: [] as readonly string[] }]]);
}

function codesAndSeverities(
  diagnostics: readonly Diagnostic[],
): ReadonlyArray<{ code: string; severity: string }> {
  return diagnostics.map(({ code, severity }) => ({ code, severity }));
}

describe('migration status', () => {
  it('settles as a completed envelope carrying the status document', async () => {
    const project = await projectWithOneMigration();
    const db = fakeDatabase({
      markers: markersAt(HASH_HEAD),
      ledger: [{ migrationHash: project.migrationHash }],
    });

    const run = await harness(driverConfig(project, db)).run(['migration', 'status', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(run.json.at(-1)).toMatchObject({ kind: 'result', envelope: { ok: true, exitCode: 0 } });
    expect(run.presented?.data).toMatchObject({
      ok: true,
      summary: 'Up to date',
      diagnostics: [],
      spaces: [
        {
          space: 'app',
          currentContract: HASH_HEAD,
          targetContract: HASH_HEAD,
          migrations: [expect.objectContaining({ status: 'applied' })],
        },
      ],
    });
  });

  it('records an unreadable contract as a warn diagnostic and still exits 0', async () => {
    const project = await projectWithOneMigration();
    await rm(project.contractPath);
    const db = fakeDatabase({ markers: markersAt(HASH_HEAD) });

    const run = await harness(driverConfig(project, db)).run(['migration', 'status', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(codesAndSeverities(run.presented?.diagnostics ?? [])).toEqual([
      { code: 'CONTRACT.UNREADABLE', severity: 'warn' },
    ]);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: true, exitCode: 0, diagnostics: [{ code: 'CONTRACT.UNREADABLE' }] },
    });
  });

  it('records a marker outside the graph as a warn diagnostic and still exits 0', async () => {
    const project = await projectWithOneMigration();
    const db = fakeDatabase({ markers: markersAt(HASH_UNKNOWN) });

    const run = await harness(driverConfig(project, db)).run(['migration', 'status', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(codesAndSeverities(run.presented?.diagnostics ?? [])).toEqual([
      { code: 'MIGRATION.MARKER_NOT_IN_HISTORY', severity: 'warn' },
    ]);
    expect(run.presented?.diagnostics.at(0)).toMatchObject({ meta: { space: 'app' } });
    expect(run.presented?.data).toMatchObject({
      summary: `Database marker ${HASH_UNKNOWN.slice(0, 12)} is not in the on-disk migration graph`,
    });
  });

  it('records invariants the marker is missing as a warn diagnostic and still exits 0', async () => {
    const project = await createOfflineProject({ storageHash: HASH_HEAD });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_base',
      from: null,
      to: HASH_BASE,
    });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260102T0000_unique_email',
      from: HASH_BASE,
      to: HASH_HEAD,
      ops: [invariantOp('users.email.unique')],
    });
    await writeRef(join(project.appMigrationsDir, 'refs'), 'production', {
      hash: HASH_HEAD,
      invariants: ['users.email.unique'],
    });
    const db = fakeDatabase({ markers: markersAt(HASH_BASE) });

    const run = await harness(driverConfig(project, db)).run(
      ['migration', 'status', '--to', 'production', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(codesAndSeverities(run.presented?.diagnostics ?? [])).toEqual([
      { code: 'MIGRATION.MISSING_INVARIANTS', severity: 'warn' },
    ]);
    expect(run.presented?.diagnostics.at(0)).toMatchObject({
      summary: 'missing invariant(s): users.email.unique',
      meta: { invariants: ['users.email.unique'], ref: 'production' },
    });
  });

  it('keeps the findings in the json document as well as on the envelope', async () => {
    const project = await projectWithOneMigration();
    const db = fakeDatabase({ markers: markersAt(HASH_UNKNOWN) });

    const run = await harness(driverConfig(project, db)).run(['migration', 'status', '--json'], {
      cwd: project.dir,
    });
    const document = run.presented?.data as { diagnostics: ReadonlyArray<{ code: string }> };

    expect(document.diagnostics).toEqual([
      {
        code: 'MIGRATION.MARKER_NOT_IN_HISTORY',
        severity: 'warn',
        message:
          'Database was updated outside the migration system (marker for space "app" does not match any migration)',
        hints: [expect.stringContaining('db sign'), expect.stringContaining('db update')],
      },
    ]);
  });

  it('heads the human output with the migrations directory and the masked database', async () => {
    const project = await projectWithOneMigration();
    const db = fakeDatabase({ markers: markersAt(HASH_HEAD) });

    const run = await harness(driverConfig(project, db)).run(['migration', 'status'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.human.at(0)).toEqual({
      kind: 'fields',
      rail: true,
      rows: [
        { label: 'migrations', value: 'migrations' },
        { label: 'database', value: 'postgres://****:****@localhost:5432/appdb' },
      ],
    });
  });

  it('draws the space tree as toned spans rather than a pre-coloured string', async () => {
    const project = await projectWithOneMigration();
    const db = fakeDatabase({ markers: markersAt(HASH_HEAD) });

    const run = await harness(driverConfig(project, db)).run(['migration', 'status'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });
    const drawing = run.presented?.presentation.human.at(1);

    expect(drawing).toMatchObject({ kind: 'drawing' });
    const lines = drawing !== undefined && drawing.kind === 'drawing' ? drawing.lines : [];
    expect(lines.length).toBeGreaterThan(0);
    expect(JSON.stringify(lines)).not.toContain('\\u001b');
    expect(JSON.stringify(lines)).toContain('"tone"');
  });

  it('renders the tree and the headline to stderr', async () => {
    const project = await projectWithOneMigration();
    const db = fakeDatabase({ markers: markersAt(HASH_HEAD) });

    const run = await harness(driverConfig(project, db)).run(['migration', 'status'], {
      cwd: project.dir,
      isTty: { stdout: true, stderr: true },
    });
    const rendered = stripAnsi(run.stderr);

    expect(rendered).toContain('20260101T0000_initial');
    expect(rendered).toContain('Up to date');
    expect(run.stdout).toBe('');
    expect(run.presented?.presentation.stdout).toEqual([]);
  });

  it('closes the ends of the run summary line with the pending count', async () => {
    const project = await projectWithOneMigration();

    const run = await harness(driverConfig(project)).run(['migration', 'status'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.human.at(-1)).toEqual({
      kind: 'summary',
      status: 'warn',
      text: `1 pending — run \`{bin} db migrate --to ${HASH_HEAD.slice(0, 12)}\``,
    });
  });

  it('never opens a connection when --from asks for an offline preview', async () => {
    const project = await projectWithOneMigration();
    const db = fakeDatabase();

    const run = await harness(driverConfig(project, db)).run(
      ['migration', 'status', '--from', HASH_HEAD, '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(db.counters.connections).toBe(0);
  });

  it('errors when no connection is configured and --from is absent', async () => {
    const project = await projectWithOneMigration();
    const config = driverConfig(project);

    const run = await harness({ ...config, db: undefined }).run(['migration', 'status', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: { code: 'CONFIG.DB_CONNECTION_REQUIRED', meta: { missingFlags: ['--db'] } },
      },
    });
  });

  it('uses the same envelope with no missing flags when only the driver is absent', async () => {
    const project = await projectWithOneMigration();
    const config = driverConfig(project);

    const run = await harness({ ...config, driver: undefined }).run(
      ['migration', 'status', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: { code: 'CONFIG.DB_CONNECTION_REQUIRED', meta: { missingFlags: [] } },
      },
    });
  });

  it('errors when --space names a space that is not on disk', async () => {
    const project = await projectWithOneMigration();

    const run = await harness(driverConfig(project)).run(
      ['migration', 'status', '--space', 'nope', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.SPACE_NOT_FOUND' } },
    });
  });

  it('prints the glyph key as its own drawing under --legend', async () => {
    const project = await projectWithOneMigration();

    const run = await harness(driverConfig(project)).run(['migration', 'status', '--legend'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });
    const blocks = run.presented?.presentation.human ?? [];
    const legend = JSON.stringify(blocks.at(1));

    expect(blocks.at(1)).toMatchObject({ kind: 'drawing' });
    expect(legend).toContain('applied');
    expect(legend).toContain('reserved markers — also typeable as --from/--to tokens');
    expect(legend).toContain('user-defined refs');
  });

  it('renders the tree with ASCII glyphs under --ascii', async () => {
    const project = await projectWithOneMigration();

    const run = await harness(driverConfig(project)).run(
      ['migration', 'status', '--ascii', '--from', EMPTY_CONTRACT_HASH],
      { cwd: project.dir, isTty: { stdout: true, stderr: true } },
    );
    const migrationLine = stripAnsi(run.stderr)
      .split('\n')
      .find((line) => line.includes('20260101T0000_initial'));

    expect(run.exitCode).toBe(0);
    expect(migrationLine).toBeDefined();
    expect(migrationLine).toContain('|^');
    expect(migrationLine).toContain(`- -> ${HASH_HEAD.slice(0, 7)}`);
    expect(migrationLine).not.toContain('│↑');
    expect(migrationLine).not.toContain('→');
  });

  it('closes the connection and keeps the structured error when the marker read fails', async () => {
    const project = await projectWithOneMigration();
    const db = fakeDatabase({
      readMarkersError: new Error('connection reset'),
      closeError: new Error('close failed'),
    });

    const run = await harness(driverConfig(project, db)).run(['migration', 'status', '--json'], {
      cwd: project.dir,
    });

    expect(db.counters.closes).toBe(1);
    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CLI.UNEXPECTED' } },
    });
  });
});
