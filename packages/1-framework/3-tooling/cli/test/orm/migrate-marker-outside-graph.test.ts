import { mkdir } from 'node:fs/promises';
import type { LedgerEntryRecord } from '@internal/contract/types';
import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import { writeRef } from '@internal/migration-tools/refs';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeProjectManifest } from '../utils/test-project-dir';
import {
  addExtensionSpace,
  buildProject,
  buildProjectWithoutMigrations,
  C1,
  C2,
  contractEnvelope,
  EXT_C1,
  harness,
  mocks,
  ormConfig,
  pgvectorExtension,
  removeMigrateShowProjects,
  resetMigrateShowMocks,
  UNKNOWN,
} from './fixtures/migrate-show-project';

afterEach(removeMigrateShowProjects);
beforeEach(resetMigrateShowMocks);

const EXTENSION_LEDGER: readonly LedgerEntryRecord[] = [
  {
    space: 'pgvector',
    migrationName: '20260101_100000_eeeeee',
    migrationHash: 'sha256:ext-initial',
    from: null,
    to: EXT_C1,
    appliedAt: new Date(0),
    operationCount: 1,
  },
  {
    space: 'pgvector',
    migrationName: '20260102_100000_dddddd',
    migrationHash: 'sha256:ext-deleted',
    from: EXT_C1,
    to: UNKNOWN,
    appliedAt: new Date(1),
    operationCount: 1,
  },
];

async function projectWithExtensionOffItsGraph(): Promise<string> {
  const cwd = await buildProject();
  writeProjectManifest(cwd);
  await addExtensionSpace(cwd);
  mocks.readAllMarkers.mockResolvedValue(
    new Map([
      ['app', { storageHash: C1, invariants: [] }],
      ['pgvector', { storageHash: UNKNOWN, invariants: [] }],
    ]),
  );
  mocks.readLedger.mockImplementation(async (space: string) =>
    space === 'pgvector' ? EXTENSION_LEDGER : [],
  );
  return cwd;
}

function errorOf(json: readonly unknown[]): unknown {
  const terminal = json.at(-1);
  return typeof terminal === 'object' && terminal !== null && 'envelope' in terminal
    ? terminal.envelope
    : undefined;
}

async function projectWithExtensionShippingNoMigrations(): Promise<string> {
  const cwd = await buildProject();
  writeProjectManifest(cwd);
  const extDir = join(cwd, 'migrations', 'pgvector');
  await mkdir(extDir, { recursive: true });
  await writeRef(join(extDir, 'refs'), 'head', { hash: EXT_C1, invariants: [] });
  await writeContractSnapshot(join(cwd, 'migrations'), EXT_C1, {
    contractJson: contractEnvelope(EXT_C1),
    contractDts: 'export type Contract = unknown;\n',
  });
  return cwd;
}

describe('a contract space whose marker is outside its migration graph', () => {
  it('refuses db migrate before applying, sending the extension space to its package', async () => {
    const cwd = await projectWithExtensionOffItsGraph();

    const run = await harness(ormConfig(cwd, { extensions: [pgvectorExtension()] })).run(
      ['db', 'migrate', '--json'],
      { cwd },
    );

    expect(run.exitCode).toBe(2);
    expect(mocks.migrate).not.toHaveBeenCalled();
    expect(mocks.readLedger).toHaveBeenCalledWith('pgvector');
    expect(errorOf(run.json)).toMatchObject({
      ok: false,
      error: {
        code: 'MIGRATION.MARKER_MISMATCH',
        nextActions: [
          {
            kind: 'user-choice',
            label: `Install a version of the extension whose migrations include the contract the database is at (${UNKNOWN}), or ask the extension's maintainers for one.`,
          },
          {
            kind: 'run-command',
            label: 'List the migrations of extension space "pgvector"',
            command: 'prisma-test migration list --space pgvector',
          },
        ],
        meta: {
          spaceId: 'pgvector',
          markerHash: UNKNOWN,
          targetHash: EXT_C1,
          lastGraphHash: EXT_C1,
          missingMigrations: ['20260102_100000_dddddd'],
        },
      },
    });
  });

  it('refuses db migrate --show with the same envelope as db migrate', async () => {
    const cwd = await projectWithExtensionOffItsGraph();
    const cli = harness(ormConfig(cwd, { extensions: [pgvectorExtension()] }));

    const applied = await cli.run(['db', 'migrate', '--json'], { cwd });
    const shown = await cli.run(['db', 'migrate', '--show', '--json'], { cwd });

    expect(shown.exitCode).toBe(2);
    expect(errorOf(shown.json)).toEqual(errorOf(applied.json));
  });

  it('checks the application space first', async () => {
    const cwd = await projectWithExtensionOffItsGraph();
    mocks.readAllMarkers.mockResolvedValue(
      new Map([
        ['app', { storageHash: UNKNOWN, invariants: [] }],
        ['pgvector', { storageHash: UNKNOWN, invariants: [] }],
      ]),
    );

    const run = await harness(ormConfig(cwd, { extensions: [pgvectorExtension()] })).run(
      ['db', 'migrate', '--json'],
      { cwd },
    );

    expect(errorOf(run.json)).toMatchObject({
      error: { code: 'MIGRATION.MARKER_MISMATCH', meta: { spaceId: 'app', targetHash: C2 } },
    });
  });

  it('lets db migrate run when every space marker is on its graph', async () => {
    const cwd = await projectWithExtensionOffItsGraph();
    mocks.readAllMarkers.mockResolvedValue(
      new Map([
        ['app', { storageHash: C1, invariants: [] }],
        ['pgvector', { storageHash: EXT_C1, invariants: [] }],
      ]),
    );

    await harness(ormConfig(cwd, { extensions: [pgvectorExtension()] })).run(
      ['db', 'migrate', '--json'],
      { cwd },
    );

    expect(mocks.migrate).toHaveBeenCalledOnce();
  });

  it.each([
    { case: 'at its head', marker: EXT_C1 },
    { case: 'at the head of an older version', marker: UNKNOWN },
  ])(
    'lets db migrate run for an extension with no migrations whose marker is $case',
    async ({ marker }) => {
      const cwd = await projectWithExtensionShippingNoMigrations();
      mocks.readAllMarkers.mockResolvedValue(
        new Map([
          ['app', { storageHash: C1, invariants: [] }],
          ['pgvector', { storageHash: marker, invariants: [] }],
        ]),
      );

      await harness(ormConfig(cwd, { extensions: [pgvectorExtension()] })).run(
        ['db', 'migrate', '--json'],
        { cwd },
      );

      expect(mocks.migrate).toHaveBeenCalledOnce();
    },
  );

  it('refuses db migrate when every application migration was deleted and the database has a marker', async () => {
    const cwd = await buildProjectWithoutMigrations();
    writeProjectManifest(cwd);
    mocks.readAllMarkers.mockResolvedValue(
      new Map([['app', { storageHash: UNKNOWN, invariants: [] }]]),
    );

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });

    expect(mocks.migrate).not.toHaveBeenCalled();
    expect(errorOf(run.json)).toMatchObject({
      error: {
        code: 'MIGRATION.MARKER_MISMATCH',
        meta: { spaceId: 'app', markerHash: UNKNOWN, targetHash: C2, missingMigrations: [] },
      },
    });
  });

  it('refuses db migrate --to @db with a marker outside the graph, printing no db update', async () => {
    const cwd = await buildProject();
    writeProjectManifest(cwd);
    mocks.readAllMarkers.mockResolvedValue(
      new Map([['app', { storageHash: UNKNOWN, invariants: [] }]]),
    );

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--to', '@db', '--json'], {
      cwd,
    });

    expect(mocks.migrate).not.toHaveBeenCalled();
    expect(errorOf(run.json)).toMatchObject({
      error: {
        code: 'MIGRATION.MARKER_MISMATCH',
        nextActions: [
          {
            kind: 'user-choice',
            label: `The database is already at the target, but no migration ends there: author a migration from the nearest contract in the migration graph to ${UNKNOWN}, commit it, and deploy again.`,
          },
        ],
        meta: { spaceId: 'app', markerHash: UNKNOWN, targetHash: UNKNOWN },
      },
    });
  });
});
