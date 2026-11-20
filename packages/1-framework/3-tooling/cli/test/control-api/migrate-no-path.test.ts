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
import type { NamedRef } from '@internal/migration-tools/refs';
import { blindCast } from '@internal/utils/casts';
import { createSqlContract } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildPathNotFoundFailure,
  executeMigrate,
  unreachableSpaceFailure,
} from '../../src/control-api/operations/migrate';
import type { CliInvocation } from '../../src/utils/printed-command';
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

/** A project whose app space carries one migration ∅ → `to`; returns its directory. */
async function projectWithOneAppEdge(to: string = APP_HEAD): Promise<string> {
  const projectDir = createTestProjectDir('migrate-no-path');
  projectDirs.push(projectDir);
  const ops = [CREATE_TABLE];
  const base: Omit<MigrationMetadata, 'migrationHash'> = {
    from: EMPTY_CONTRACT_HASH,
    to,
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

function invocationIn(projectDir: string): CliInvocation {
  return { cwd: projectDir, configPath: undefined, dbGiven: true };
}

function migrate(args: {
  readonly projectDir: string;
  readonly markers: ReadonlyMap<string, ContractMarkerRecord>;
  readonly ledger?: readonly LedgerEntryRecord[];
  readonly refHash?: string;
  readonly ref?: NamedRef;
}) {
  return executeMigrate({
    driver: blindCast<
      ControlDriverInstance<'sql', 'postgres'>,
      'no path is found, so nothing reaches the driver'
    >({ familyId: 'sql', targetId: 'postgres', close: async () => {} }),
    invocation: invocationIn(args.projectDir),
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
    ...(args.refHash === undefined ? {} : { target: { kind: 'hash', hash: args.refHash } }),
    ...(args.ref === undefined ? {} : { target: { kind: 'ref', ref: args.ref } }),
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
        'Move it with db update; its data stays:',
        `  {bin} db update --to ${APP_HEAD} --dry-run --db <url>`,
        `  {bin} db update --to ${APP_HEAD} --db <url>`,
      ].join('\n'),
      nextActions: [
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
      ],
      meta: {
        spaceId: 'app',
        markerHash: DELETED,
        targetHash: APP_HEAD,
        change: ['migrate', 'reconcile'],
        lastGraphHash: APP_HEAD,
        missingMigrations: ['20261013T0910_request_description'],
      },
    });
  });

  it('reports MARKER_MISMATCH when every migration was deleted and the database has a marker', async () => {
    const projectDir = createTestProjectDir('migrate-no-path');
    projectDirs.push(projectDir);
    await mkdir(join(projectDir, 'migrations', 'app'), { recursive: true });
    const choice = 'Move it with db update; its data stays:';

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
      fix: [choice, '  {bin} db update --dry-run --db <url>', '  {bin} db update --db <url>'].join(
        '\n',
      ),
      nextActions: [
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
      ],
      meta: {
        spaceId: 'app',
        markerHash: DELETED,
        targetHash: APP_HEAD,
        change: ['migrate', 'reconcile'],
        missingMigrations: [],
      },
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
      buildPathNotFoundFailure(
        'app',
        APP_HEAD,
        ELSEWHERE,
        ELSEWHERE,
        invocationIn(projectDir),
      ).toEnvelope(),
    );
  });

  it('advises planning without --to when the unreachable target is the emitted contract', async () => {
    const projectDir = await projectWithOneAppEdge(ELSEWHERE);

    const result = await migrate({ projectDir, markers: new Map([['app', markerAt(ELSEWHERE)]]) });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toEqual(
      buildPathNotFoundFailure(
        'app',
        ELSEWHERE,
        APP_HEAD,
        undefined,
        invocationIn(projectDir),
      ).toEnvelope(),
    );
  });

  it('advises naming a ref target by its name', async () => {
    const projectDir = await projectWithOneAppEdge();

    const result = await migrate({
      projectDir,
      markers: new Map([['app', markerAt(APP_HEAD)]]),
      ref: { name: 'production', hash: ELSEWHERE, invariants: [] },
    });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toEqual(
      buildPathNotFoundFailure(
        'app',
        APP_HEAD,
        ELSEWHERE,
        'production',
        invocationIn(projectDir),
      ).toEnvelope(),
    );
  });

  it('reports PATH_UNREACHABLE from the empty contract when the database has no marker', async () => {
    const projectDir = await projectWithOneAppEdge();

    const result = await migrate({ projectDir, markers: new Map(), refHash: ELSEWHERE });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toEqual(
      buildPathNotFoundFailure(
        'app',
        EMPTY_CONTRACT_HASH,
        ELSEWHERE,
        ELSEWHERE,
        invocationIn(projectDir),
      ).toEnvelope(),
    );
  });

  it('advises installing another version of the extension when an extension space has no path', () => {
    const failure = unreachableSpaceFailure(
      { spaceId: 'pgvector', fromHash: DELETED, targetHash: ELSEWHERE },
      {
        appSpaceId: 'app',
        target: { kind: 'ref', ref: { name: 'production', hash: APP_HEAD, invariants: [] } },
        invocation: {
          ...invocationIn('/project'),
          rerunArgs: ['--to', 'production', '--advance-ref', 'production'],
        },
      },
    );

    expect(failure.toEnvelope()).toMatchObject({
      code: 'MIGRATION.PATH_UNREACHABLE',
      nextActions: [
        {
          kind: 'user-choice',
          label:
            'Install a version of the extension whose migrations start from the contract the database is at',
        },
        {
          kind: 'run-command',
          label: 'List the migrations of extension space "pgvector"',
          command: '{bin} migration list --space pgvector',
        },
        {
          kind: 'run-command',
          label: 'Run db migrate again',
          command: '{bin} db migrate --to production --advance-ref production --db <url>',
        },
      ],
      meta: {
        kind: 'pathUnreachable',
        spaceId: 'pgvector',
        fromHash: DELETED,
        targetHash: ELSEWHERE,
      },
    });
  });
});
