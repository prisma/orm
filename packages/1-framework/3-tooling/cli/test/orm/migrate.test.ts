import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import {
  type MigrationPlanOperation,
  migrationRunnerFailure,
  type SchemaDiffIssue,
  schemaCheckWhy,
} from '@internal/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import {
  contractSnapshotDir,
  writeContractSnapshot,
} from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { writeRef } from '@internal/migration-tools/refs';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok } from '@internal/utils/result';
import type { EngineEvent, StreamEvent } from '@prisma/cli-engine';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildPathNotFoundFailure } from '../../src/control-api/operations/migrate';
import { runnerFailureFacts } from '../../src/control-api/operations/run-migration';
import type { ControlClient } from '../../src/control-api/types';
import { BIN_GROUPS, createBinCommands } from '../../src/orm/cli';
import { createMigrateCommand } from '../../src/orm/migrate';
import { migrateRunnerFailureError } from '../../src/utils/migrate-failure';
import { stdoutErrorMeta } from '../helpers/json-frames';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import { reference } from '../utils/plan-origins';
import { onDisk } from '../utils/runner-failure-errors';
import { createTestProjectDir, writeProjectManifest } from '../utils/test-project-dir';

const DEFAULT = { kind: 'default' } as const;

const MISSING_COLUMN: SchemaDiffIssue = {
  path: ['public', 'event', 'id'],
  expected: { id: 'id', nodeKind: 'sql-column', isEqualTo: () => false, children: () => [] },
};

const mocks = {
  connect: vi.fn(),
  readAllMarkers: vi.fn(),
  migrate: vi.fn(),
  renderContractDts: vi.fn(),
  close: vi.fn(),
};
const RENDERED_CONTRACT_DTS = '// rendered\nexport type Contract = { rendered: true };\n';
const SNAPSHOT_CONTRACT_DTS = '/* rendered */ export type Contract = { rendered: true };\n';

/** The command tree mounted over a control-client double instead of the real client. */
const clientDouble = {
  connect: mocks.connect,
  bringPrismaSpaceUpToDate: async () => undefined,
  readAllMarkers: mocks.readAllMarkers,
  migrate: mocks.migrate,
  renderContractDts: mocks.renderContractDts,
  close: mocks.close,
} as unknown as ControlClient;

const commands = createBinCommands(() => clientDouble);

const EMPTY = 'empty';
const C1 = '1'.repeat(64);
const C2 = '2'.repeat(64);
const TARGET = 'mock';
const FAMILY = 'mock';

const OPS: readonly MigrationPlanOperation[] = [
  { id: 'relation.users', label: 'Create relation users', operationClass: 'additive' },
];

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writePackage(
  dir: string,
  base: Omit<MigrationMetadata, 'migrationHash'>,
): Promise<string> {
  const dirName = `20260101_10000${base.from === EMPTY ? '0' : '1'}_${base.to.slice(0, 6)}`;
  const metadata: MigrationMetadata = {
    ...base,
    migrationHash: computeMigrationHash(base, [...OPS]),
  };
  await writeMigrationPackage(join(dir, dirName), metadata, [...OPS]);
  return dirName;
}

/** A linear app history: empty → C1 → C2, with the emitted contract at C2. */
async function buildProject(): Promise<string> {
  const cwd = createTestProjectDir('orm-migrate');
  tempDirs.push(cwd);
  writeProjectManifest(cwd);
  const appDir = join(cwd, 'migrations', 'app');
  await mkdir(appDir, { recursive: true });
  await writePackage(appDir, {
    from: EMPTY,
    to: C1,
    providedInvariants: [],
    createdAt: '2026-01-01T10:00:00.000Z',
  });
  await writePackage(appDir, {
    from: C1,
    to: C2,
    providedInvariants: [],
    createdAt: '2026-01-01T10:01:00.000Z',
  });
  await writeFile(
    join(cwd, 'contract.json'),
    JSON.stringify({
      storage: { storageHash: C2, namespaces: {} },
      formatVersion: 1,
      target: TARGET,
      targetFamily: FAMILY,
    }),
  );
  return cwd;
}

function ormConfig(cwd: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: FAMILY,
      familyId: FAMILY,
      version: '1.0.0',
      emission: {},
      create: () => ({
        deserializeContract: (json: unknown) => json,
        accessChangesOf: () => [],
      }),
    },
    target: {
      kind: 'target',
      id: TARGET,
      familyId: FAMILY,
      targetId: TARGET,
      version: '1.0.0',
      create: () => ({}),
      migrations: {},
    },
    adapter: {
      kind: 'adapter',
      id: 'mock',
      familyId: FAMILY,
      targetId: TARGET,
      version: '1.0.0',
      create: () => ({}),
    },
    driver: {
      kind: 'driver',
      id: 'mock',
      familyId: FAMILY,
      targetId: TARGET,
      version: '1.0.0',
      create: () => ({}),
    },
    db: { connection: 'postgres://user:secret@localhost:5432/appdb' },
    contract: {
      source: { format: 'typescript', inputs: [], load: async () => ({}) },
      output: join(cwd, 'contract.json'),
      typesModule: '@acme/orm-db/contract-types',
    },
    migrations: { dir: 'migrations' },
    ...overrides,
  };
}

function appliedSuccess(): Record<string, unknown> {
  return {
    migrationsApplied: 2,
    markerHash: C2,
    applied: [
      {
        spaceId: 'app',
        dirName: '20260101_100000_111111',
        migrationHash: 'h1',
        from: EMPTY,
        to: C1,
        operationsExecuted: 1,
      },
    ],
    summary: 'Applied 2 migration(s)',
    perSpace: [
      {
        spaceId: 'app',
        kind: 'app',
        operations: [
          { id: 'relation.users', label: 'Create relation users', operationClass: 'additive' },
        ],
        marker: { storageHash: C2 },
      },
    ],
  };
}

beforeEach(() => {
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.readAllMarkers.mockReset().mockResolvedValue(new Map());
  mocks.migrate.mockReset().mockResolvedValue(ok(appliedSuccess()));
  mocks.renderContractDts.mockReset().mockResolvedValue(ok({ contractDts: RENDERED_CONTRACT_DTS }));
});

function refsDirOf(cwd: string): string {
  return join(cwd, 'migrations', 'app', 'refs');
}

async function storeSnapshot(cwd: string, hash: string): Promise<void> {
  await writeContractSnapshot(join(cwd, 'migrations'), hash, {
    contractJson: { formatVersion: 1, storage: { storageHash: hash, namespaces: {} } },
    contractDts: SNAPSHOT_CONTRACT_DTS,
  });
}

/** Runs the first next action of the settled result's first diagnostic, as printed. */
function runSuggestedCommand(cwd: string, json: readonly StreamEvent[]) {
  const envelope = envelopeOf(json) as {
    diagnostics: { nextActions: { kind: string; command?: string }[] }[];
  };
  const command = envelope.diagnostics[0]?.nextActions.find(
    (action) => action.kind === 'run-command',
  )?.command;
  if (command === undefined) throw new Error('no command to run');
  const [, ...argv] = command.replaceAll("'", '').split(' ');
  return harness(ormConfig(cwd)).run([...argv, '--json'], { cwd });
}

function harness(config: Record<string, unknown>) {
  return createOrmTestCli({ commands, groups: BIN_GROUPS, orm: config });
}

function envelopeOf(json: readonly StreamEvent[]): unknown {
  const terminal = json.at(-1);
  return terminal?.kind === 'result' ? terminal.envelope : undefined;
}

function stepEvents(events: readonly EngineEvent[]): readonly EngineEvent[] {
  return events.filter((event) => event.kind === 'step-started' || event.kind === 'step-finished');
}

describe('migrate', () => {
  it('settles as a completed envelope carrying the apply document', async () => {
    const cwd = await buildProject();

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      ok: true,
      migrationsApplied: 2,
      migrationsTotal: 1,
      markerHash: C2,
      summary: 'Applied 2 migration(s)',
      advancedRef: { name: 'db', hash: C2 },
    });
  });

  describe('the db ref', () => {
    async function dbRefHash(cwd: string): Promise<string | undefined> {
      const path = join(refsDirOf(cwd), 'db.json');
      if (!existsSync(path)) return undefined;
      return (JSON.parse(await readFile(path, 'utf-8')) as { hash: string }).hash;
    }

    it('advances to the marker when the connection comes from the config', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({ advancedRef: { name: 'db', hash: C2 } });
      expect(await dbRefHash(cwd)).toBe(C2);
      const storeDir = contractSnapshotDir(join(cwd, 'migrations'), C2);
      expect(await readFile(join(storeDir, 'contract.d.ts'), 'utf-8')).toBe(SNAPSHOT_CONTRACT_DTS);
    });

    it('is not advanced when the connection is passed with --db', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--db', 'postgres://other/db', '--json'],
        { cwd },
      );

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({ advancedRef: null });
      expect(existsSync(refsDirOf(cwd))).toBe(false);
      expect(mocks.renderContractDts).not.toHaveBeenCalled();
    });

    it('is not advanced when the CI variable is set, and says why', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], {
        cwd,
        env: { CI: 'true' },
      });

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({ advancedRef: null });
      expect(existsSync(refsDirOf(cwd))).toBe(false);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: true,
        diagnostics: [
          {
            code: 'MIGRATION.REF_NOT_ADVANCED_IN_CI',
            severity: 'info',
            summary: 'Ref "db" was not advanced: the CLI detected CI',
            why: expect.stringContaining('--no-advance-ref silences this notice'),
            nextActions: [
              {
                kind: 'user-choice',
                label:
                  'If this is your development machine and not CI: unset the variable that made the CLI detect CI, or set CI=false, so later runs advance the db ref',
              },
              {
                kind: 'run-command',
                label: 'If this is your development machine and not CI: advance ref "db" now',
                command: 'prisma-test db migrate --advance-ref db',
              },
              {
                kind: 'user-choice',
                label: 'In a pipeline: pass --no-advance-ref to silence this notice',
              },
            ],
          },
        ],
      });
    });

    it('is not advanced when a CI service variable is set without CI', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], {
        cwd,
        env: { BUILD_NUMBER: '17' },
      });

      expect(run.presented?.data).toMatchObject({ advancedRef: null });
      expect(envelopeOf(run.json)).toMatchObject({
        diagnostics: [{ code: 'MIGRATION.REF_NOT_ADVANCED_IN_CI' }],
      });
    });

    it('prints why it was not advanced in CI', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate'], {
        cwd,
        env: { CI: 'true' },
      });

      const stderr = stripAnsi(run.stderr);
      expect(stderr).toContain('Ref "db" was not advanced: the CLI detected CI');
      expect(stderr).toContain('prisma-test db migrate --advance-ref db');
    });

    it('says nothing about CI when another flag decides', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--db', 'postgres://other/db', '--json'],
        { cwd, env: { CI: 'true' } },
      );

      expect(envelopeOf(run.json)).toMatchObject({ ok: true, diagnostics: [] });
    });

    it('does not render a snapshot the store already holds', async () => {
      const cwd = await buildProject();
      await writeContractSnapshot(join(cwd, 'migrations'), C2, {
        contractJson: { formatVersion: 1, storage: { storageHash: C2, namespaces: {} } },
        contractDts: SNAPSHOT_CONTRACT_DTS,
      });
      mocks.renderContractDts.mockResolvedValue(
        notOk({ code: 'RENDER_FAILED', summary: 'Failed to render contract types' }),
      );

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({ advancedRef: { name: 'db', hash: C2 } });
      expect(await dbRefHash(cwd)).toBe(C2);
      expect(mocks.renderContractDts).not.toHaveBeenCalled();
    });

    it('keeps the code of the error that stopped the ref write', async () => {
      const cwd = await buildProject();
      mocks.migrate.mockResolvedValue(ok({ ...appliedSuccess(), markerHash: C1 }));

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });

      expect(run.exitCode).toBe(0);
      expect(envelopeOf(run.json)).toMatchObject({
        diagnostics: [
          {
            code: 'MIGRATION.REF_NOT_WRITTEN',
            meta: { name: 'db', hash: C1, causeCode: 'MIGRATION.CONTRACT_SNAPSHOT_HASH_MISMATCH' },
          },
        ],
      });
      expect(await dbRefHash(cwd)).toBeUndefined();
    });

    it('is advanced when the CI variable is false', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], {
        cwd,
        env: { CI: 'false' },
      });

      expect(run.presented?.data).toMatchObject({ advancedRef: { name: 'db', hash: C2 } });
    });

    it('is not advanced with --no-advance-ref', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--no-advance-ref', '--json'],
        { cwd },
      );

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({ advancedRef: null });
      expect(existsSync(refsDirOf(cwd))).toBe(false);
      expect(mocks.renderContractDts).not.toHaveBeenCalled();
    });

    it('refuses --advance-ref together with --no-advance-ref before connecting', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--advance-ref', 'staging', '--no-advance-ref', '--json'],
        { cwd },
      );

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: { code: 'CLI.ADVANCE_REF_ARG_CONFLICT' },
      });
      expect(mocks.connect).not.toHaveBeenCalled();
    });

    it('warns and still succeeds when the snapshot cannot be written', async () => {
      const cwd = await buildProject();
      const snapshotsDir = join(cwd, 'migrations', 'snapshots');
      await mkdir(snapshotsDir, { recursive: true });
      await chmod(snapshotsDir, 0o555);

      const run = await harness(ormConfig(cwd))
        .run(['db', 'migrate', '--config', 'prisma.config.ts', '--json'], { cwd })
        .finally(() => chmod(snapshotsDir, 0o755));

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({ ok: true, advancedRef: null });
      expect(envelopeOf(run.json)).toMatchObject({
        ok: true,
        diagnostics: [
          {
            code: 'MIGRATION.REF_NOT_WRITTEN',
            severity: 'warn',
            summary: 'Migrations applied, but ref "db" was not written',
            why: expect.stringContaining('EACCES'),
            nextActions: [
              {
                kind: 'run-command',
                label: 'Write ref "db" and its snapshot once the directory is writable',
                command: 'prisma-test db migrate --advance-ref db --config prisma.config.ts',
              },
            ],
            meta: { name: 'db', hash: C2, causeCode: 'EACCES' },
          },
        ],
      });
      expect(await dbRefHash(cwd)).toBeUndefined();

      const suggested = await runSuggestedCommand(cwd, run.json);
      expect(suggested.exitCode).toBe(0);
      expect(await dbRefHash(cwd)).toBe(C2);
    });

    it('suggests migration ref set when this run wrote the snapshot but not the pointer', async () => {
      const cwd = await buildProject();
      const failingWriter = () => Promise.reject(new Error('disk full'));

      const run = await createOrmTestCli({
        commands: {
          ...commands,
          'db migrate': createMigrateCommand(() => clientDouble, failingWriter),
        },
        groups: BIN_GROUPS,
        orm: ormConfig(cwd),
      }).run(['db', 'migrate', '--json'], { cwd });

      expect(run.exitCode).toBe(0);
      expect(envelopeOf(run.json)).toMatchObject({
        diagnostics: [
          {
            code: 'MIGRATION.REF_NOT_WRITTEN',
            why: expect.stringContaining('disk full'),
            nextActions: [{ command: `prisma-test migration ref set db ${C2}` }],
          },
        ],
      });
      expect(existsSync(contractSnapshotDir(join(cwd, 'migrations'), C2))).toBe(true);
      expect(await dbRefHash(cwd)).toBeUndefined();
      const suggested = await runSuggestedCommand(cwd, run.json);
      expect(suggested.exitCode).toBe(0);
      expect(await dbRefHash(cwd)).toBe(C2);
    });

    it('suggests migration ref set when the snapshot was already stored, and that command works', async () => {
      const cwd = await buildProject();
      await storeSnapshot(cwd, C2);
      await mkdir(refsDirOf(cwd), { recursive: true });
      await chmod(refsDirOf(cwd), 0o555);

      const run = await harness(ormConfig(cwd))
        .run(['db', 'migrate', '--json'], { cwd })
        .finally(() => chmod(refsDirOf(cwd), 0o755));

      expect(envelopeOf(run.json)).toMatchObject({
        diagnostics: [
          {
            code: 'MIGRATION.REF_NOT_WRITTEN',
            nextActions: [{ command: `prisma-test migration ref set db ${C2}` }],
          },
        ],
      });
      const suggested = await runSuggestedCommand(cwd, run.json);
      expect(suggested.exitCode).toBe(0);
      expect(await dbRefHash(cwd)).toBe(C2);
    });

    it('warns when the store has no snapshot for the hash the database ended at', async () => {
      const cwd = await buildProject();
      await storeSnapshot(cwd, C2);
      mocks.migrate.mockResolvedValue(ok({ ...appliedSuccess(), markerHash: C1 }));

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });

      expect(run.exitCode).toBe(0);
      expect(envelopeOf(run.json)).toMatchObject({
        diagnostics: [
          {
            code: 'MIGRATION.REF_NOT_WRITTEN',
            why: expect.stringContaining(`the snapshot store holds no contract for ${C1}`),
            nextActions: [
              { kind: 'run-command', command: 'prisma-test db migrate --advance-ref db' },
            ],
          },
        ],
      });
      expect(await dbRefHash(cwd)).toBeUndefined();
    });

    it('lets an internal error during the ref write reach the top level', async () => {
      const cwd = await buildProject();
      await storeSnapshot(cwd, C2);
      const failingWriter = () => Promise.reject(new InternalError('broken invariant'));

      const run = await createOrmTestCli({
        commands: {
          ...commands,
          'db migrate': createMigrateCommand(() => clientDouble, failingWriter),
        },
        groups: BIN_GROUPS,
        orm: ormConfig(cwd),
      }).run(['db', 'migrate', '--json'], { cwd });

      expect(run.exitCode).toBe(1);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: { code: 'CLI.INTERNAL_ERROR' },
      });
      expect(JSON.stringify(run.json)).not.toContain('MIGRATION.REF_NOT_WRITTEN');
    });

    it('refuses an invalid ref name before applying when the snapshot is already stored', async () => {
      const cwd = await buildProject();
      await storeSnapshot(cwd, C2);

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--advance-ref', 'bad ref name', '--json'],
        { cwd },
      );

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: { code: 'MIGRATION.INVALID_REF_NAME' },
      });
      expect(mocks.migrate).not.toHaveBeenCalled();
    });

    describe('when the run brings the database to the empty contract', () => {
      async function projectWithDbRef(): Promise<string> {
        const cwd = await buildProject();
        await writeRef(refsDirOf(cwd), 'db', { hash: C2, invariants: [] });
        mocks.migrate.mockResolvedValue(ok({ ...appliedSuccess(), markerHash: EMPTY }));
        return cwd;
      }

      it('leaves db unchanged and says how to remove it', async () => {
        const cwd = await projectWithDbRef();

        const run = await harness(ormConfig(cwd)).run(
          ['db', 'migrate', '--to', '@empty', '--json'],
          { cwd },
        );

        expect(run.exitCode).toBe(0);
        expect(run.presented?.data).toMatchObject({ advancedRef: null });
        expect(await dbRefHash(cwd)).toBe(C2);
        expect(envelopeOf(run.json)).toMatchObject({
          diagnostics: [
            {
              code: 'MIGRATION.REF_NOT_ADVANCED_TO_EMPTY',
              severity: 'warn',
              summary: `Ref "db" still names ${C2}, but the database is now at the empty contract`,
              nextActions: [
                { kind: 'run-command', command: 'prisma-test migration ref delete db' },
              ],
            },
          ],
        });
        const suggested = await runSuggestedCommand(cwd, run.json);
        expect(suggested.exitCode).toBe(0);
        expect(await dbRefHash(cwd)).toBeUndefined();
      });

      it('says nothing when there is no db ref', async () => {
        const cwd = await buildProject();
        mocks.migrate.mockResolvedValue(ok({ ...appliedSuccess(), markerHash: EMPTY }));

        const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--to', '@empty'], {
          cwd,
          isTty: { stdout: true, stderr: true },
        });

        expect(run.exitCode).toBe(0);
        expect(run.presented?.diagnostics).toEqual([]);
        expect(stripAnsi(run.stderr)).not.toContain('Ref "db"');
        expect(existsSync(refsDirOf(cwd))).toBe(false);
      });

      it('says why in CI too, and not that CI was the reason', async () => {
        const cwd = await projectWithDbRef();

        const run = await harness(ormConfig(cwd)).run(
          ['db', 'migrate', '--to', '@empty', '--json'],
          { cwd, env: { CI: 'true' } },
        );

        expect(envelopeOf(run.json)).toMatchObject({
          diagnostics: [{ code: 'MIGRATION.REF_NOT_ADVANCED_TO_EMPTY' }],
        });
        expect(JSON.stringify(run.json)).not.toContain('MIGRATION.REF_NOT_ADVANCED_IN_CI');
      });

      it('refuses --advance-ref before applying', async () => {
        const cwd = await projectWithDbRef();

        const run = await harness(ormConfig(cwd)).run(
          ['db', 'migrate', '--to', '@empty', '--advance-ref', 'staging', '--json'],
          { cwd },
        );

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run.json)).toMatchObject({
          ok: false,
          error: {
            code: 'MIGRATION.REF_TARGET_EMPTY',
            nextActions: [{ command: 'prisma-test db migrate --to @empty --no-advance-ref' }],
          },
        });
        expect(mocks.migrate).not.toHaveBeenCalled();
        expect(await dbRefHash(cwd)).toBe(C2);
      });
    });
  });

  describe('--advance-ref', () => {
    it('advances the named ref instead of db under --db', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--db', 'postgres://other/db', '--advance-ref', 'staging', '--json'],
        { cwd },
      );

      expect(run.presented?.data).toMatchObject({ advancedRef: { name: 'staging', hash: C2 } });
      expect(existsSync(join(refsDirOf(cwd), 'staging.json'))).toBe(true);
      expect(existsSync(join(refsDirOf(cwd), 'db.json'))).toBe(false);
    });

    it('advances the named ref when the CI variable is set', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--advance-ref', 'staging', '--json'],
        { cwd, env: { CI: 'true' } },
      );

      expect(run.presented?.data).toMatchObject({ advancedRef: { name: 'staging', hash: C2 } });
    });

    it('advances the ref with a snapshot whose types were rendered before applying', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--advance-ref', 'staging', '--json'],
        { cwd },
      );

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({
        advancedRef: { name: 'staging', hash: C2 },
      });
      expect(mocks.renderContractDts).toHaveBeenCalledWith({
        contract: expect.objectContaining({ storage: { storageHash: C2, namespaces: {} } }),
        typesModule: '@acme/orm-db/contract-types',
      });
      expect(mocks.renderContractDts.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.migrate.mock.invocationCallOrder[0]!,
      );
      const storeDir = contractSnapshotDir(join(cwd, 'migrations'), C2);
      expect(await readFile(join(storeDir, 'contract.d.ts'), 'utf-8')).toBe(SNAPSHOT_CONTRACT_DTS);
    });

    it('refuses before applying when the contract types cannot be rendered', async () => {
      const cwd = await buildProject();
      mocks.renderContractDts.mockResolvedValue(
        notOk({
          code: 'RENDER_FAILED',
          summary: 'Failed to render contract types',
          why: 'relation author must declare nullability',
        }),
      );

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--advance-ref', 'staging', '--json'],
        { cwd },
      );

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: { code: 'CONTRACT.TYPES_RENDER_FAILED' },
      });
      expect(mocks.migrate).not.toHaveBeenCalled();
      expect(existsSync(join(cwd, 'migrations', 'app', 'refs'))).toBe(false);
      expect(existsSync(join(cwd, 'migrations', 'snapshots'))).toBe(false);
    });

    it('refuses an invalid ref name before applying', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--advance-ref', 'Not A Ref', '--json'],
        { cwd },
      );

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: { code: 'MIGRATION.INVALID_REF_NAME' },
      });
      expect(mocks.migrate).not.toHaveBeenCalled();
      expect(mocks.renderContractDts).not.toHaveBeenCalled();
    });
  });

  it('reports the control API`s spans as step events rather than printing them', async () => {
    const cwd = await buildProject();
    mocks.migrate.mockImplementation(
      (options: { onProgress?: (event: Record<string, unknown>) => void }) => {
        options.onProgress?.({
          action: 'migrate',
          kind: 'spanStart',
          spanId: 'app',
          label: 'Applying app space',
        });
        options.onProgress?.({ action: 'migrate', kind: 'spanEnd', spanId: 'app', outcome: 'ok' });
        return Promise.resolve(ok(appliedSuccess()));
      },
    );

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });

    expect(stepEvents(run.events)).toEqual([
      { kind: 'step-started', step: 'Applying app space', id: 'app' },
      { kind: 'step-finished', step: 'Applying app space', id: 'app', outcome: 'ok' },
    ]);
  });

  it('lays the applied spaces out as a tree the engine draws', async () => {
    const cwd = await buildProject();

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate'], {
      cwd,
      isTty: { stdout: true },
    });
    const blocks = run.presented?.presentation.human ?? [];

    expect(blocks[0]).toEqual({
      kind: 'fields',
      rail: true,
      rows: [
        { label: 'migrations', value: 'migrations' },
        { label: 'database', value: 'postgres://****:****@localhost:5432/appdb' },
      ],
    });
    expect(blocks[1]).toEqual({
      kind: 'summary',
      status: 'ok',
      text: 'Applied 2 migration(s)',
    });
    expect(blocks[2]).toEqual({
      kind: 'tree',
      roots: [
        {
          label: [{ text: 'App space', tone: 'identifier' }],
          children: [
            { label: 'Create relation users' },
            {
              label: [
                { text: 'marker ', tone: 'muted' },
                { text: C2, tone: 'identifier' },
              ],
            },
          ],
        },
      ],
    });
    expect(run.presented?.presentation.next).toEqual([
      {
        kind: 'run-command',
        label: 'Check every space against the database',
        command: 'prisma-test migration status',
      },
    ]);
  });

  it('repeats --config and --db in the command it says to run next', async () => {
    const cwd = await buildProject();

    const run = await harness(ormConfig(cwd)).run(
      ['db', 'migrate', '--db', 'postgres://localhost/other', '--config', 'app/prisma.config.ts'],
      { cwd, isTty: { stdout: true } },
    );

    expect(run.presented?.presentation.next).toEqual([
      {
        kind: 'run-command',
        label: 'Check every space against the database',
        command: 'prisma-test migration status --config app/prisma.config.ts --db <url>',
      },
    ]);
  });

  it('prints one data line per applied migration: space, name, from, to and operations run', async () => {
    const cwd = await buildProject();

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate'], { cwd });

    expect(run.stdout).toBe(`app\t20260101_100000_111111\t\t${C1}\t1\n`);
  });

  it('writes no data lines when stdout and stderr share one terminal', async () => {
    const cwd = await buildProject();

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate'], {
      cwd,
      isTty: { stdout: true, stderr: true },
    });

    expect(run.stdout).toBe('');
    expect(stripAnsi(run.stderr)).toContain('Applied 2 migration(s)');
  });

  it('takes the connection from --db over the config', async () => {
    const cwd = await buildProject();

    await harness(ormConfig(cwd)).run(['db', 'migrate', '--db', 'postgres://other/db', '--json'], {
      cwd,
    });

    expect(mocks.connect).toHaveBeenCalledWith('postgres://other/db');
  });

  it('errors when the target has no migration runner', async () => {
    const cwd = await buildProject();
    const config = ormConfig(cwd);
    const run = await harness({
      ...config,
      target: { ...(config['target'] as Record<string, unknown>), migrations: undefined },
    }).run(['db', 'migrate', '--json'], { cwd });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'MIGRATION.TARGET_UNSUPPORTED' },
    });
  });

  it('maps an unreachable path to its migration code', async () => {
    const cwd = await buildProject();
    mocks.migrate.mockResolvedValue(
      notOk(
        buildPathNotFoundFailure(
          'app',
          EMPTY_CONTRACT_HASH,
          C2,
          { from: DEFAULT, to: reference(C2) },
          {
            cwd,
            configPath: undefined,
            dbGiven: false,
          },
        ),
      ),
    );

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'MIGRATION.PATH_UNREACHABLE' },
    });
  });

  it('reports a runner failure with the runner code and meta, and the advice', async () => {
    const cwd = await buildProject();
    const runnerFailure = migrationRunnerFailure(
      'MIGRATION.SCHEMA_VERIFY_FAILED',
      'Database schema does not satisfy contract',
      {
        why: schemaCheckWhy([MISSING_COLUMN]),
        meta: { schemaIssues: [MISSING_COLUMN], failingSpace: 'app', databaseUnchanged: true },
      },
    );
    const invocation = { cwd, configPath: undefined, dbGiven: false };
    mocks.migrate.mockResolvedValue(
      notOk(
        migrateRunnerFailureError(
          runnerFailure,
          runnerFailureFacts(runnerFailure, []),
          onDisk({ directory: join(cwd, 'migrations', 'app', '20261015T1200_initial'), from: C1 }),
          invocation,
        ),
      ),
    );

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: {
        code: 'MIGRATION.SCHEMA_VERIFY_FAILED',
        summary: 'Database schema does not satisfy contract',
        why: 'The schema check after apply found: missing: public/event/id.',
        nextActions: [
          {
            kind: 'edit-file',
            label: `If the contract source does not describe the schema you want, change it to resolve the issues listed, re-run \`prisma-test contract emit\`, delete \`migrations/app/20261015T1200_initial\` (copy any code you wrote in its migration.ts first), plan it again with \`prisma-test migration plan --from ${C1} --name initial\`, put any code you copied into the migration.ts it writes, run that migration.ts with the \`node\` command \`migration plan\` prints, and run \`prisma-test db migrate\``,
          },
          {
            kind: 'edit-file',
            label:
              'If `migrations/app/20261015T1200_initial/migration.ts` does not reach its destination contract, for example after a hand edit, change its operations to resolve the issues listed, run `node migrations/app/20261015T1200_initial/migration.ts`, and run `prisma-test db migrate`',
          },
        ],
        meta: {
          schemaIssues: [{ path: ['public', 'event', 'id'] }],
          failingSpace: 'app',
          databaseUnchanged: true,
        },
      },
    });
    expect(stdoutErrorMeta(run.stdout)).toEqual(JSON.parse(JSON.stringify(runnerFailure.meta)));
    expect(mocks.migrate).toHaveBeenCalledWith(
      expect.objectContaining({ invocation: { ...invocation, rerunArgs: [] } }),
    );
  });

  describe('a close that fails on the way out', () => {
    it('reports the connection failure rather than the failure to hang up', async () => {
      const cwd = await buildProject();
      mocks.connect.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432'));
      mocks.close.mockRejectedValue(new Error('close on an unconnected client'));

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });
      const settled = JSON.stringify(run.json.at(-1));

      expect(run.exitCode).toBe(2);
      expect(settled).toContain('ECONNREFUSED 127.0.0.1:5432');
      expect(settled).not.toContain('close on an unconnected client');
    });

    it('does not turn a successful apply into a failure', async () => {
      const cwd = await buildProject();
      mocks.close.mockRejectedValue(new Error('close failed'));

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });

      expect(run.exitCode).toBe(0);
      expect(envelopeOf(run.json)).toMatchObject({ ok: true });
    });
  });
});
