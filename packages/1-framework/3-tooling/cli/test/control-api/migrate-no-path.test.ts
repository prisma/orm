import { mkdir, rm } from 'node:fs/promises';
import type { Contract, ContractMarkerRecord, LedgerEntryRecord } from '@internal/contract/types';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationPlanOperation,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { blindCast } from '@internal/utils/casts';
import { createSqlContract } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPathNotFoundFailure, executeMigrate } from '../../src/control-api/operations/migrate';
import { createTestProjectDir } from '../utils/test-project-dir';

const APP_CONTRACT: Contract = createSqlContract();
const APP_HEAD = APP_CONTRACT.storage.storageHash;
const DELETED = `sha256:${'d'.repeat(64)}`;
const ELSEWHERE = `sha256:${'e'.repeat(64)}`;

const CREATE_TABLE: MigrationPlanOperation = {
  id: 'table.post',
  label: 'Create table post',
  operationClass: 'additive',
};

const projectDirs: string[] = [];

afterEach(async () => {
  await Promise.all(projectDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A project whose app space carries one migration ∅ → APP_HEAD; returns its directory. */
async function projectWithOneAppEdge(): Promise<string> {
  const projectDir = createTestProjectDir('migrate-no-path');
  projectDirs.push(projectDir);
  const ops = [CREATE_TABLE];
  const base: Omit<MigrationMetadata, 'migrationHash'> = {
    from: EMPTY_CONTRACT_HASH,
    to: APP_HEAD,
    providedInvariants: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  await writeMigrationPackage(
    join(projectDir, 'migrations', 'app', '20260101T0000_initial'),
    { ...base, migrationHash: computeMigrationHash(base, ops) },
    ops,
  );
  return projectDir;
}

function markerAt(storageHash: string): ContractMarkerRecord {
  return {
    storageHash,
    profileHash: '',
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(0),
    appTag: null,
    meta: {},
    invariants: [],
  };
}

function applied(migrationName: string, from: string | null, to: string): LedgerEntryRecord {
  return {
    space: 'app',
    migrationName,
    migrationHash: `sha256:${migrationName}`,
    from,
    to,
    appliedAt: new Date(0),
    operationCount: 1,
  };
}

function fakeFamily(args: {
  readonly markers: ReadonlyMap<string, ContractMarkerRecord>;
  readonly ledger: readonly LedgerEntryRecord[];
}): ControlFamilyInstance<'sql', unknown> {
  const used: Pick<
    ControlFamilyInstance<'sql', unknown>,
    'familyId' | 'deserializeContract' | 'readAllMarkers' | 'readLedger'
  > = {
    familyId: 'sql',
    deserializeContract: (json) =>
      blindCast<Contract, 'the snapshots in this test are written from Contract values'>(json),
    readAllMarkers: async () => args.markers,
    readLedger: async ({ space }) => args.ledger.filter((entry) => entry.space === space),
  };
  return blindCast<
    ControlFamilyInstance<'sql', unknown>,
    'executeMigrate reads only the family members picked above'
  >(used);
}

function migrate(args: {
  readonly projectDir: string;
  readonly markers: ReadonlyMap<string, ContractMarkerRecord>;
  readonly ledger?: readonly LedgerEntryRecord[];
  readonly refHash?: string;
}) {
  return executeMigrate({
    driver: blindCast<
      ControlDriverInstance<'sql', 'postgres'>,
      'no path is found, so nothing reaches the driver'
    >({ familyId: 'sql', targetId: 'postgres', close: async () => {} }),
    invocation: { cwd: args.projectDir, configPath: undefined, dbGiven: true },
    familyInstance: fakeFamily({ markers: args.markers, ledger: args.ledger ?? [] }),
    contract: APP_CONTRACT,
    migrations: blindCast<
      TargetMigrationsCapability<'sql', 'postgres', ControlFamilyInstance<'sql', unknown>>,
      'no path is found, so no runner is created'
    >({}),
    frameworkComponents: [],
    migrationsDir: join(args.projectDir, 'migrations'),
    extensions: [],
    targetId: 'postgres',
    ...(args.refHash === undefined ? {} : { refHash: args.refHash }),
  });
}

describe('executeMigrate with no path to the target', () => {
  it('reports MARKER_MISMATCH, explained by the ledger, when the marker is not in the graph', async () => {
    const projectDir = await projectWithOneAppEdge();

    const result = await migrate({
      projectDir,
      markers: new Map([['app', markerAt(DELETED)]]),
      ledger: [
        applied('20260101T0000_initial', null, APP_HEAD),
        applied('20261013T0910_request_description', APP_HEAD, DELETED),
      ],
    });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toEqual({
      ok: false,
      code: 'MIGRATION.MARKER_MISMATCH',
      severity: 'error',
      summary: 'The database is at a contract that is not in the migration graph',
      why: `The database's marker names ${DELETED}, which no migration in migrations/app starts or ends at. After ${APP_HEAD}, the last graph contract it reached, it applied 20261013T0910_request_description, which is no longer on disk.`,
      fix: [
        'Unless this database changes only through migrations, as production does, move it with db update; its data stays:',
        `  {bin} db update --to ${APP_HEAD} --dry-run --db <url>`,
        `  {bin} db update --to ${APP_HEAD} --db <url>`,
        `Otherwise plan a migration from ${APP_HEAD} to its current contract, then one to ${APP_HEAD}, and deploy again.`,
      ].join('\n'),
      nextActions: [
        {
          kind: 'user-choice',
          label:
            'Unless this database changes only through migrations, as production does, move it with db update; its data stays:',
        },
        {
          kind: 'run-command',
          label: 'Preview the changes',
          command: `{bin} db update --to ${APP_HEAD} --dry-run --db <url>`,
        },
        {
          kind: 'run-command',
          label: 'Reconcile the database',
          command: `{bin} db update --to ${APP_HEAD} --db <url>`,
        },
        {
          kind: 'user-choice',
          label: `Otherwise plan a migration from ${APP_HEAD} to its current contract, then one to ${APP_HEAD}, and deploy again.`,
        },
      ],
      meta: {
        spaceId: 'app',
        markerHash: DELETED,
        targetHash: APP_HEAD,
        lastGraphHash: APP_HEAD,
        missingMigrations: ['20261013T0910_request_description'],
      },
    });
  });

  it('reports MARKER_MISMATCH when every migration was deleted and the database has a marker', async () => {
    const projectDir = createTestProjectDir('migrate-no-path');
    projectDirs.push(projectDir);
    await mkdir(join(projectDir, 'migrations', 'app'), { recursive: true });
    const choice =
      'Unless this database changes only through migrations, as production does, move it with db update; its data stays:';
    const otherwise = `Otherwise plan a migration from the empty contract to its current contract, then one to ${APP_HEAD}, and deploy again.`;

    const result = await migrate({
      projectDir,
      markers: new Map([['app', markerAt(DELETED)]]),
      ledger: [applied('20260101T0000_initial', null, DELETED)],
    });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toEqual({
      ok: false,
      code: 'MIGRATION.MARKER_MISMATCH',
      severity: 'error',
      summary: 'The database is at a contract that is not in the migration graph',
      why: `The database's marker names ${DELETED}, which no migration in migrations/app starts or ends at. A migration it applied was planned again or deleted, or \`db update\` moved it to a contract no migration ends at.`,
      fix: [
        choice,
        '  {bin} db update --dry-run --db <url>',
        '  {bin} db update --db <url>',
        otherwise,
      ].join('\n'),
      nextActions: [
        { kind: 'user-choice', label: choice },
        {
          kind: 'run-command',
          label: 'Preview the changes',
          command: '{bin} db update --dry-run --db <url>',
        },
        {
          kind: 'run-command',
          label: 'Reconcile the database',
          command: '{bin} db update --db <url>',
        },
        { kind: 'user-choice', label: otherwise },
      ],
      meta: { spaceId: 'app', markerHash: DELETED, targetHash: APP_HEAD, missingMigrations: [] },
    });
  });

  it('reports PATH_UNREACHABLE when the marker is in the graph and the target is not reachable', async () => {
    const projectDir = await projectWithOneAppEdge();

    const result = await migrate({
      projectDir,
      markers: new Map([['app', markerAt(APP_HEAD)]]),
      refHash: ELSEWHERE,
    });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toEqual(
      buildPathNotFoundFailure('app', markerAt(APP_HEAD), ELSEWHERE).toEnvelope(),
    );
  });

  it('reports PATH_UNREACHABLE from the empty contract when the database has no marker', async () => {
    const projectDir = await projectWithOneAppEdge();

    const result = await migrate({ projectDir, markers: new Map(), refHash: ELSEWHERE });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toEqual(
      buildPathNotFoundFailure('app', null, ELSEWHERE).toEnvelope(),
    );
  });
});
