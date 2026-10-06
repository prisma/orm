import { rm } from 'node:fs/promises';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { writeRef } from '@internal/migration-tools/refs';
import type { Diagnostic } from '@prisma/cli-engine/protocol';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { afterEach, describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import {
  contractJson,
  createOfflineProject,
  invariantOp,
  type OfflineProject,
  offlineConfig,
  removeOfflineProjects,
  seedContractSnapshot,
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
  return createOrmTestCli({ commands: BIN_COMMANDS, groups: BIN_GROUPS, orm: config });
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

const DIR_BASE = '20260101T0000_base';
const DIR_HEAD = '20260102T0000_head';

/** A project whose app space carries ∅ → HASH_BASE → HASH_HEAD, with the contract at HASH_HEAD. */
async function projectWithTwoMigrations(): Promise<
  OfflineProject & { readonly baseMigrationHash: string }
> {
  const project = await createOfflineProject({ storageHash: HASH_HEAD });
  const base = await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: DIR_BASE,
    from: null,
    to: HASH_BASE,
  });
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: DIR_HEAD,
    from: HASH_BASE,
    to: HASH_HEAD,
  });
  return { ...project, baseMigrationHash: base.migrationHash };
}

function markersAt(storageHash: string) {
  return new Map([['app', { storageHash, invariants: [] as readonly string[] }]]);
}

const EXTERNAL_SPACE = 'external';
const HASH_EXTERNAL_HEAD = `e0e0${'3'.repeat(60)}`;

/** An all-external extension space: a head ref on disk and no migration packages. */
async function addAllExternalSpace(project: OfflineProject): Promise<void> {
  await writeRef(join(project.migrationsDir, EXTERNAL_SPACE, 'refs'), 'head', {
    hash: HASH_EXTERNAL_HEAD,
    invariants: [],
  });
  await seedContractSnapshot({
    migrationsDir: project.migrationsDir,
    storageHash: HASH_EXTERNAL_HEAD,
  });
}

function allExternalExtension(): Record<string, unknown> {
  return {
    kind: 'extension',
    id: EXTERNAL_SPACE,
    familyId: 'sql',
    targetId: 'postgres',
    version: '1.0.0',
    create: () => ({}),
    contractSpace: {
      contractJson: contractJson(HASH_EXTERNAL_HEAD),
      headRef: { hash: HASH_EXTERNAL_HEAD, invariants: [] },
      migrations: [],
    },
  };
}

function withAllExternalExtension(config: Record<string, unknown>): Record<string, unknown> {
  return { ...config, extensions: [allExternalExtension()] };
}

function markersWithExternalAtHead(appHash: string) {
  return new Map([
    ['app', { storageHash: appHash, invariants: [] as readonly string[] }],
    [EXTERNAL_SPACE, { storageHash: HASH_EXTERNAL_HEAD, invariants: [] as readonly string[] }],
  ]);
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

  it('warns when the marker equals the emitted contract but no migration ends there', async () => {
    const project = await createOfflineProject({ storageHash: HASH_HEAD });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: DIR_BASE,
      from: null,
      to: HASH_BASE,
    });
    const db = fakeDatabase({ markers: markersAt(HASH_HEAD) });

    const run = await harness(driverConfig(project, db)).run(['migration', 'status', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(codesAndSeverities(run.presented?.diagnostics ?? [])).toEqual([
      { code: 'MIGRATION.MARKER_NOT_IN_HISTORY', severity: 'warn' },
    ]);
    expect(run.presented?.data).toMatchObject({
      summary: `Database marker ${HASH_HEAD.slice(0, 12)} is not in the on-disk migration graph`,
      spaces: [{ currentContract: HASH_HEAD, targetContract: HASH_HEAD }],
    });
  });

  it('warns about an app marker when the app space has no migrations', async () => {
    const project = await createOfflineProject({ storageHash: HASH_HEAD });
    const db = fakeDatabase({ markers: markersAt(HASH_HEAD) });

    const run = await harness(driverConfig(project, db)).run(['migration', 'status', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(codesAndSeverities(run.presented?.diagnostics ?? [])).toEqual([
      { code: 'MIGRATION.MARKER_NOT_IN_HISTORY', severity: 'warn' },
    ]);
  });

  it('stays quiet about an all-external extension space whose marker is at its head', async () => {
    const project = await projectWithOneMigration();
    await addAllExternalSpace(project);
    const db = fakeDatabase({
      markers: markersWithExternalAtHead(HASH_HEAD),
      ledger: [{ migrationHash: project.migrationHash }],
    });

    const run = await harness(withAllExternalExtension(driverConfig(project, db))).run(
      ['migration', 'status', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.diagnostics).toEqual([]);
    expect(run.presented?.data).toMatchObject({
      summary: 'Up to date',
      spaces: expect.arrayContaining([
        expect.objectContaining({
          space: EXTERNAL_SPACE,
          currentContract: HASH_EXTERNAL_HEAD,
          targetContract: HASH_EXTERNAL_HEAD,
        }),
      ]),
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
      text: `1 pending — run \`prisma-test db migrate --to ${HASH_HEAD.slice(0, 12)}\``,
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

  it('keeps --to in the retry command it suggests when no connection is configured', async () => {
    const project = await projectWithOneMigration();
    const config = driverConfig(project);

    const run = await harness({ ...config, db: undefined }).run(
      ['migration', 'status', '--to', HASH_HEAD, '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'CONFIG.DB_CONNECTION_REQUIRED',
          meta: { missingFlags: ['--db'] },
          nextActions: [
            expect.objectContaining({
              label: expect.stringContaining(
                `migration status --from <contract> --to ${HASH_HEAD}`,
              ),
            }),
          ],
        },
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

  describe('reserved contract references', () => {
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

      const run = await harness(withAllExternalExtension(driverConfig(project, db))).run(
        ['migration', 'status', '--to', '@contract', '--json'],
        { cwd: project.dir },
      );

      expect(run.exitCode).toBe(0);
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
      const document = run.presented?.data as {
        spaces: ReadonlyArray<{
          currentContract: string | null;
          targetContract: string;
          migrations: ReadonlyArray<{ status: string }>;
        }>;
      };

      expect(run.exitCode).toBe(0);
      expect(db.counters.connections).toBe(1);
      expect(document.spaces).toHaveLength(1);
      expect(document.spaces[0]).toMatchObject({
        currentContract: HASH_BASE,
        targetContract: HASH_HEAD,
      });
      expect(document.spaces[0]?.migrations.map((migration) => migration.status)).not.toContain(
        'applied',
      );
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
