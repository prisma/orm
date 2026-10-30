import { rm } from 'node:fs/promises';
import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import {
  type ControlDriverInstance,
  type ControlFamilyInstance,
  type DatabasePolicies,
  DEFAULT_DATABASE_POLICIES,
  type MigrationPlanOperation,
  type MigrationRunner,
  type MigrationRunnerPerSpaceOptions,
  type TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import type { NamedRef } from '@internal/migration-tools/refs';
import { blindCast } from '@internal/utils/casts';
import { ok } from '@internal/utils/result';
import { createSqlContract } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { executeMigrate } from '../../src/control-api/operations/migrate';
import { createTestProjectDir } from '../utils/test-project-dir';

const APP_CONTRACT: Contract = createSqlContract();
const APP_HEAD = APP_CONTRACT.storage.storageHash;

const CREATE_TABLE: MigrationPlanOperation = {
  id: 'table.post',
  label: 'Create table post',
  operationClass: 'additive',
};

const MIGRATE_ONLY_WRITTEN: DatabasePolicies = {
  change: ['migrate'],
  dataProtection: {
    dataLoss: 'data-loss-with-consent',
    accessWidening: 'access-widening-with-consent',
  },
};

const projectDirs: string[] = [];

afterEach(async () => {
  await Promise.all(projectDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function migrationsDirWithOneAppEdge(): Promise<string> {
  const projectDir = createTestProjectDir('migrate-database-policies');
  projectDirs.push(projectDir);
  const migrationsDir = join(projectDir, 'migrations');
  const ops = [CREATE_TABLE];
  const base: Omit<MigrationMetadata, 'migrationHash'> = {
    from: EMPTY_CONTRACT_HASH,
    to: APP_HEAD,
    providedInvariants: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  await writeMigrationPackage(
    join(migrationsDir, 'app', '20260101T0000_initial'),
    { ...base, migrationHash: computeMigrationHash(base, ops) },
    ops,
  );
  return migrationsDir;
}

function markerAt(storageHash: string, meta: Record<string, unknown> = {}): ContractMarkerRecord {
  return {
    storageHash,
    profileHash: '',
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(0),
    appTag: null,
    meta,
    invariants: [],
  };
}

function fakeFamily(
  markers: ReadonlyMap<string, ContractMarkerRecord>,
): ControlFamilyInstance<'sql', unknown> {
  const used: Pick<
    ControlFamilyInstance<'sql', unknown>,
    'familyId' | 'deserializeContract' | 'readAllMarkers' | 'markerLocation'
  > = {
    familyId: 'sql',
    markerLocation: 'prisma_contract.marker',
    deserializeContract: (json) =>
      blindCast<Contract, 'the snapshots in this test are written from Contract values'>(json),
    readAllMarkers: async () => markers,
  };
  return blindCast<
    ControlFamilyInstance<'sql', unknown>,
    'executeMigrate reads only the family members picked above'
  >(used);
}

function recordingMigrations() {
  const runnerCalls: (readonly MigrationRunnerPerSpaceOptions<'sql', 'postgres'>[])[] = [];
  const runner: MigrationRunner<'sql', 'postgres'> = {
    execute: async ({ perSpaceOptions }) => {
      runnerCalls.push(perSpaceOptions);
      return ok({
        perSpaceResults: perSpaceOptions.map((option) => ({
          space: option.space,
          value: {
            operationsPlanned: option.plan.operations.length,
            operationsExecuted: option.plan.operations.length,
          },
        })),
      });
    },
  };
  const migrations = blindCast<
    TargetMigrationsCapability<'sql', 'postgres', ControlFamilyInstance<'sql', unknown>>,
    'executeMigrate only creates a runner'
  >({ createRunner: () => runner });
  return { runnerCalls, migrations };
}

async function migrate(args: {
  readonly markers: ReadonlyMap<string, ContractMarkerRecord>;
  readonly ref?: NamedRef;
  readonly permitPolicyChange?: boolean;
}) {
  const migrationsDir = await migrationsDirWithOneAppEdge();
  const { runnerCalls, migrations } = recordingMigrations();
  const result = await executeMigrate({
    driver: blindCast<
      ControlDriverInstance<'sql', 'postgres'>,
      'the family and runner fakes never touch the driver'
    >({ familyId: 'sql', targetId: 'postgres', close: async () => {} }),
    invocation: { cwd: '/work/app', configPath: undefined, dbGiven: true },
    familyInstance: fakeFamily(args.markers),
    contract: APP_CONTRACT,
    migrations,
    frameworkComponents: [],
    migrationsDir,
    extensions: [],
    targetId: 'postgres',
    ...(args.ref === undefined ? {} : { ref: args.ref }),
    ...(args.permitPolicyChange === undefined
      ? {}
      : { permitPolicyChange: args.permitPolicyChange }),
  });
  return { result, runnerCalls };
}

const PRODUCTION: NamedRef = {
  name: 'production',
  hash: APP_HEAD,
  invariants: [],
  policies: { change: ['migrate'] },
};

const CHANGE_DIFFERENCE = {
  setting: 'change',
  declared: ['migrate'],
  inForce: ['migrate', 'reconcile'],
};

describe('executeMigrate, database policies', () => {
  it('refuses a ref whose policies differ before it runs anything', async () => {
    const { result, runnerCalls } = await migrate({ markers: new Map(), ref: PRODUCTION });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toMatchObject({
      code: 'MIGRATION.POLICY_MISMATCH',
      meta: { spaceId: 'app', refName: 'production', differences: [CHANGE_DIFFERENCE] },
    });
    expect(runnerCalls).toEqual([]);
  });

  it('with consent, applies the migrations and records the ref overlaid on the policies in force', async () => {
    const { result, runnerCalls } = await migrate({
      markers: new Map(),
      ref: PRODUCTION,
      permitPolicyChange: true,
    });

    expect(
      runnerCalls.map((call) =>
        call.map((o) => [o.space, o.databasePolicies, o.expectedDatabasePolicies]),
      ),
    ).toEqual([[['app', MIGRATE_ONLY_WRITTEN, DEFAULT_DATABASE_POLICIES]]]);
    expect(
      result.ok
        ? {
            summary: result.value.summary,
            databasePoliciesUpdated: result.value.databasePoliciesUpdated,
          }
        : result.failure,
    ).toEqual({
      summary:
        'Applied 1 migration(s) (1 operation(s)) across 1 contract space(s); policies updated: change: migrate',
      databasePoliciesUpdated: [CHANGE_DIFFERENCE],
    });
  });

  it('runs the runner with no migrations to record the policies when nothing is pending', async () => {
    const { result, runnerCalls } = await migrate({
      markers: new Map([['app', markerAt(APP_HEAD)]]),
      ref: PRODUCTION,
      permitPolicyChange: true,
    });

    expect(
      runnerCalls.map((call) =>
        call.map((o) => ({
          space: o.space,
          edges: o.migrationEdges,
          operations: o.plan.operations.length,
          databasePolicies: o.databasePolicies,
        })),
      ),
    ).toEqual([
      [{ space: 'app', edges: [], operations: 0, databasePolicies: MIGRATE_ONLY_WRITTEN }],
    ]);
    expect(
      result.ok
        ? {
            summary: result.value.summary,
            migrationsApplied: result.value.migrationsApplied,
            databasePoliciesUpdated: result.value.databasePoliciesUpdated,
          }
        : result.failure,
    ).toEqual({
      summary: 'Policies updated: change: migrate',
      migrationsApplied: 0,
      databasePoliciesUpdated: [CHANGE_DIFFERENCE],
    });
  });

  it('writes nothing when the ref declares the policies already in force', async () => {
    const { result, runnerCalls } = await migrate({
      markers: new Map([['app', markerAt(APP_HEAD)]]),
      ref: { ...PRODUCTION, policies: { change: ['reconcile', 'migrate'] } },
    });

    expect(result.ok ? result.value.summary : result.failure).toBe('Already up to date');
    expect(runnerCalls).toEqual([]);
  });

  it('refuses a database whose change policy does not permit migrations', async () => {
    const { result, runnerCalls } = await migrate({
      markers: new Map([
        ['app', markerAt(EMPTY_CONTRACT_HASH, { policies: { change: ['reconcile'] } })],
      ]),
    });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toMatchObject({
      code: 'MIGRATION.CHANGE_POLICY_FORBIDS',
      summary: "This database's change policy permits only db update",
      nextActions: [
        {
          kind: 'run-command',
          label: 'Reconcile the database',
          command: `{bin} db update --to ${APP_HEAD} --db <url>`,
        },
      ],
      meta: { spaceId: 'app', command: 'db migrate', change: ['reconcile'] },
    });
    expect(runnerCalls).toEqual([]);
  });

  it('refuses a ref that would take migrations away, even with consent', async () => {
    const { result } = await migrate({
      markers: new Map([['app', markerAt(APP_HEAD)]]),
      ref: { ...PRODUCTION, policies: { change: ['reconcile'] } },
      permitPolicyChange: true,
    });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toMatchObject({
      code: 'MIGRATION.CHANGE_POLICY_FORBIDS',
      why: 'production declares change: reconcile, so db migrate may not move it.',
      meta: { change: ['reconcile'] },
    });
  });

  it('reports a marker whose policies are not valid as a corrupt marker row of the application space', async () => {
    await expect(
      migrate({ markers: new Map([['app', markerAt(APP_HEAD, { policies: 'strict' })]]) }),
    ).rejects.toMatchObject({
      code: 'CONTRACT.MARKER_ROW_CORRUPT',
      why: expect.stringContaining("The marker's meta.policies is not a valid policy declaration"),
      meta: { space: 'app' },
    });
  });

  it('reports a marker outside the migration graph before it compares the policies', async () => {
    const { result, runnerCalls } = await migrate({
      markers: new Map([['app', markerAt('d'.repeat(64))]]),
      ref: PRODUCTION,
    });

    expect(result.ok ? undefined : result.failure.code).toBe('MIGRATION.MARKER_MISMATCH');
    expect(runnerCalls).toEqual([]);
  });
});
