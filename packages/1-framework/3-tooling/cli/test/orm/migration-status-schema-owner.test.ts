import { writeRef } from '@internal/migration-tools/refs';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import {
  contractJson,
  createOfflineProject,
  type OfflineProject,
  offlineConfig,
  removeOfflineProjects,
  seedContractSnapshot,
  seedMigrationPackage,
} from './fixtures/offline-project';

afterEach(removeOfflineProjects);

const HASH_APP = `c0ffee${'0'.repeat(58)}`;
const HASH_EXT = `beef${'1'.repeat(60)}`;
const HASH_UNKNOWN = `dead${'2'.repeat(60)}`;
const ADVICE = 'Apply the schema change with the owning tool';

const OWNER_ACTIONS = [
  { kind: 'user-choice', label: ADVICE },
  { kind: 'run-command', label: 'Then sign the database again', command: '{bin} db sign' },
];

function postgisExtension(): Record<string, unknown> {
  return {
    kind: 'extension',
    id: 'postgis',
    familyId: 'sql',
    targetId: 'postgres',
    version: '1.0.0',
    create: () => ({}),
    contractSpace: {
      contractJson: contractJson(HASH_EXT),
      headRef: { hash: HASH_EXT, invariants: [] },
      migrations: [],
    },
  };
}

/** A project whose contract source names another tool as owning the schema, over a database holding `markers`. */
function ownedConfig(
  project: OfflineProject,
  markers: ReadonlyMap<
    string,
    { readonly storageHash: string; readonly invariants: readonly string[] }
  >,
  extensions: readonly Record<string, unknown>[] = [],
): Record<string, unknown> {
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
    extensions,
    contract: {
      source: {
        format: 'psl',
        inputs: [],
        load: async () => ({}),
        schemaOwner: { applySchemaChangeAdvice: ADVICE },
      },
      output: project.contractPath,
    },
  };
}

function marker(storageHash: string) {
  return { storageHash, invariants: [] as readonly string[] };
}

describe('migration status on a database whose schema another tool changes', () => {
  it('points an app marker outside the graph at that tool', async () => {
    const project = await createOfflineProject({ storageHash: HASH_APP });
    const config = ownedConfig(project, new Map([['app', marker(HASH_UNKNOWN)]]));

    const run = await createOrmTestCli({
      commands: BIN_COMMANDS,
      groups: BIN_GROUPS,
      orm: config,
    }).run(['migration', 'status', '--json'], { cwd: project.dir });

    expect(
      run.presented?.diagnostics.map(({ code, nextActions }) => ({ code, nextActions })),
    ).toEqual([{ code: 'MIGRATION.MARKER_NOT_IN_HISTORY', nextActions: OWNER_ACTIONS }]);
    expect(run.presented?.data).toMatchObject({
      diagnostics: [
        {
          code: 'MIGRATION.MARKER_NOT_IN_HISTORY',
          hints: [ADVICE, "Then sign the database again: run '{bin} db sign'"],
        },
      ],
    });
  });

  it('keeps that tool out of the advice for an extension space, which the contract source does not describe', async () => {
    const project = await createOfflineProject({ storageHash: HASH_APP });
    await seedMigrationPackage({
      appMigrationsDir: join(project.migrationsDir, 'postgis'),
      dirName: '20260601T0000_install_postgis',
      from: null,
      to: HASH_EXT,
    });
    await writeRef(join(project.migrationsDir, 'postgis', 'refs'), 'head', {
      hash: HASH_EXT,
      invariants: [],
    });
    await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_EXT });
    const config = ownedConfig(
      project,
      new Map([
        ['app', marker(HASH_APP)],
        ['postgis', marker(HASH_UNKNOWN)],
      ]),
      [postgisExtension()],
    );

    const run = await createOrmTestCli({
      commands: BIN_COMMANDS,
      groups: BIN_GROUPS,
      orm: config,
    }).run(['migration', 'status', '--json'], { cwd: project.dir });

    expect(
      run.presented?.diagnostics.map(({ code, meta, nextActions }) => ({
        code,
        meta,
        nextActions,
      })),
    ).toEqual([
      {
        code: 'MIGRATION.MARKER_NOT_IN_HISTORY',
        meta: { space: 'postgis' },
        nextActions: [
          {
            kind: 'user-choice',
            label:
              'Make the database match the "postgis" extension package this project installs, or install the version that matches the database, then verify again',
          },
        ],
      },
    ]);
  });
});
