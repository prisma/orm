import { rm } from 'node:fs/promises';
import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type {
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyInstance,
  DeclaredDatabasePolicies,
  MigrationAccessChange,
  MigrationPlanOperation,
  MigrationRunner,
  MigrationRunnerPerSpaceOptions,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import type { NamedRef } from '@internal/migration-tools/refs';
import { writeRef } from '@internal/migration-tools/refs';
import { blindCast } from '@internal/utils/casts';
import { ok } from '@internal/utils/result';
import { createSqlContract } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { executeMigrate } from '../../src/control-api/operations/migrate';
import { createTestProjectDir } from '../utils/test-project-dir';

const APP_CONTRACT: Contract = createSqlContract();
const APP_HEAD = APP_CONTRACT.storage.storageHash;
const APP_MIGRATION = '20260101T0000_initial';

const AUDIT_SPACE = 'audit';
const AUDIT_MIGRATION = '20260101T0000_audit';
const AUDIT_CONTRACT: Contract = createSqlContract({
  storage: {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: { audit_log: {} } } },
    },
  },
});
const AUDIT_HEAD = AUDIT_CONTRACT.storage.storageHash;

const CREATE_TABLE: MigrationPlanOperation = {
  id: 'table.post',
  label: 'Create table post',
  operationClass: 'additive',
};
const DROP_COLUMN: MigrationPlanOperation = {
  id: 'column.user.legacy_name.drop',
  label: 'Drop column "legacy_name" from "user"',
  operationClass: 'destructive',
};
const DISABLE_RLS: MigrationPlanOperation = {
  id: 'rowLevelSecurity.public.post.disable',
  label: 'Disable row-level security on "post"',
  operationClass: 'widening',
};
const DROP_AUDIT: MigrationPlanOperation = {
  id: 'table.audit_old.drop',
  label: 'Drop table audit_old',
  operationClass: 'destructive',
};

const KEEP_DATA =
  "This database's data protection policy forbids losing data, so these operations cannot run on it. If another database has already applied this migration, keep it as it is: this database cannot run it until its data protection policy changes. If none has, and a model or field was only renamed or its type changed, delete it and plan it again with --rename or --convert; otherwise remove the operation from the migration. To do it anyway, whoever owns the database must first change its data protection policy.";

const projectDirs: string[] = [];

afterEach(async () => {
  await Promise.all(projectDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writePackage(
  migrationsDir: string,
  spaceId: string,
  dirName: string,
  to: string,
  ops: readonly MigrationPlanOperation[],
  from: string = EMPTY_CONTRACT_HASH,
): Promise<void> {
  const base: Omit<MigrationMetadata, 'migrationHash'> = {
    from,
    to,
    providedInvariants: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  await writeMigrationPackage(
    join(migrationsDir, spaceId, dirName),
    { ...base, migrationHash: computeMigrationHash(base, ops) },
    ops,
  );
}

const MIDDLE_HASH = 'c'.repeat(64);
const LATER_MIGRATION = '20260102T0000_drop_legacy';

/** The app's migrations: one to the head, or with `earlierOps` one to a middle contract and a later one to the head. */
async function migrationsDirWith(
  appOps: readonly MigrationPlanOperation[],
  earlierOps: readonly MigrationPlanOperation[] | undefined,
): Promise<string> {
  const projectDir = createTestProjectDir('migrate-data-protection');
  projectDirs.push(projectDir);
  const migrationsDir = join(projectDir, 'migrations');
  if (earlierOps === undefined) {
    await writePackage(migrationsDir, 'app', APP_MIGRATION, APP_HEAD, appOps);
  } else {
    await writePackage(migrationsDir, 'app', APP_MIGRATION, MIDDLE_HASH, earlierOps);
    await writePackage(migrationsDir, 'app', LATER_MIGRATION, APP_HEAD, appOps, MIDDLE_HASH);
  }
  return migrationsDir;
}

async function addAuditSpace(migrationsDir: string): Promise<void> {
  await writePackage(migrationsDir, AUDIT_SPACE, AUDIT_MIGRATION, AUDIT_HEAD, [DROP_AUDIT]);
  await writeRef(join(migrationsDir, AUDIT_SPACE, 'refs'), 'head', {
    hash: AUDIT_HEAD,
    invariants: [],
  });
  await writeContractSnapshot(migrationsDir, AUDIT_HEAD, {
    contractJson: AUDIT_CONTRACT,
    contractDts: 'export type Contract = never;\n',
  });
}

const AUDIT_METADATA: Omit<MigrationMetadata, 'migrationHash'> = {
  from: EMPTY_CONTRACT_HASH,
  to: AUDIT_HEAD,
  providedInvariants: [],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const auditExtension: ControlExtensionDescriptor<'sql', 'postgres'> = {
  kind: 'extension',
  id: AUDIT_SPACE,
  familyId: 'sql',
  targetId: 'postgres',
  version: '1.0.0',
  contractSpace: {
    contractJson: AUDIT_CONTRACT,
    headRef: { hash: AUDIT_HEAD, invariants: [] },
    migrations: [
      {
        dirName: AUDIT_MIGRATION,
        metadata: {
          ...AUDIT_METADATA,
          migrationHash: computeMigrationHash(AUDIT_METADATA, [DROP_AUDIT]),
        },
        ops: [DROP_AUDIT],
      },
    ],
  },
  create: () => ({ familyId: 'sql', targetId: 'postgres' }),
};

function markerAt(storageHash: string, policies?: DeclaredDatabasePolicies): ContractMarkerRecord {
  return {
    storageHash,
    profileHash: '',
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(0),
    appTag: null,
    meta: policies === undefined ? {} : { policies },
    invariants: [],
  };
}

function fakeFamily(
  markers: ReadonlyMap<string, ContractMarkerRecord>,
): ControlFamilyInstance<'sql', unknown> {
  const used: Pick<
    ControlFamilyInstance<'sql', unknown>,
    | 'familyId'
    | 'deserializeContract'
    | 'readAllMarkers'
    | 'markerLocation'
    | 'storageNameOf'
    | 'accessChangesOf'
  > = {
    familyId: 'sql',
    markerLocation: 'prisma_contract.marker',
    deserializeContract: (json) =>
      blindCast<Contract, 'the snapshots in this test are written from Contract values'>(json),
    readAllMarkers: async () => markers,
    storageNameOf: (operation) => `stored ${operation.id}`,
    accessChangesOf: (operations) =>
      operations.flatMap((operation, operationIndex): MigrationAccessChange[] =>
        operation.id === DISABLE_RLS.id
          ? [{ operationIndex, subject: { kind: 'storage', name: 'public.post' }, widens: true }]
          : [],
      ),
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
  readonly appOps: readonly MigrationPlanOperation[];
  readonly markers: ReadonlyMap<string, ContractMarkerRecord>;
  readonly ref?: NamedRef;
  readonly permitPolicyChange?: boolean;
  readonly withAuditSpace?: boolean;
  /** Operations of an earlier pending migration, before the one holding `appOps`. */
  readonly earlierOps?: readonly MigrationPlanOperation[];
}) {
  const migrationsDir = await migrationsDirWith(args.appOps, args.earlierOps);
  if (args.withAuditSpace === true) await addAuditSpace(migrationsDir);
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
    extensions: args.withAuditSpace === true ? [auditExtension] : [],
    targetId: 'postgres',
    ...(args.ref === undefined ? {} : { target: { kind: 'ref', ref: args.ref } }),
    ...(args.permitPolicyChange === undefined
      ? {}
      : { permitPolicyChange: args.permitPolicyChange }),
  });
  return { result, runnerCalls };
}

function forbidding(policies: DeclaredDatabasePolicies): ReadonlyMap<string, ContractMarkerRecord> {
  return new Map([['app', markerAt(EMPTY_CONTRACT_HASH, policies)]]);
}

const DATA_LOSS_FORBIDDEN = { dataProtection: { dataLoss: 'data-loss-forbidden' } } as const;
const ACCESS_FORBIDDEN = {
  dataProtection: { accessWidening: 'access-widening-forbidden' },
} as const;

function production(policies: DeclaredDatabasePolicies): NamedRef {
  return { name: 'production', hash: APP_HEAD, invariants: [], policies };
}

describe('executeMigrate, data protection', () => {
  it('refuses a migration that loses data under data-loss-forbidden, and runs nothing', async () => {
    const { result, runnerCalls } = await migrate({
      appOps: [CREATE_TABLE, DROP_COLUMN],
      markers: forbidding(DATA_LOSS_FORBIDDEN),
    });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toEqual({
      ok: false,
      code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
      severity: 'error',
      summary: "This database's data protection policy forbids data loss",
      why: `The marker records dataLoss: data-loss-forbidden. Drop column "legacy_name" from "user" (stored column.user.legacy_name.drop), in migration ${APP_MIGRATION} of contract space "app".`,
      fix: KEEP_DATA,
      nextActions: [{ kind: 'user-choice', label: KEEP_DATA }],
      meta: {
        spaceId: 'app',
        command: 'db migrate',
        settings: [{ setting: 'dataLoss', level: 'data-loss-forbidden' }],
        operations: [
          {
            setting: 'dataLoss',
            spaceId: 'app',
            migration: APP_MIGRATION,
            operationId: DROP_COLUMN.id,
            subject: 'stored column.user.legacy_name.drop',
            label: DROP_COLUMN.label,
          },
        ],
      },
    });
    expect(runnerCalls).toEqual([]);
  });

  it('refuses a migration that disables row-level security under access-widening-forbidden', async () => {
    const { result, runnerCalls } = await migrate({
      appOps: [CREATE_TABLE, DISABLE_RLS],
      markers: forbidding(ACCESS_FORBIDDEN),
    });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toMatchObject({
      code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
      summary: "This database's data protection policy forbids changing who can read or write data",
      meta: {
        settings: [{ setting: 'accessWidening', level: 'access-widening-forbidden' }],
        operations: [
          {
            setting: 'accessWidening',
            spaceId: 'app',
            migration: APP_MIGRATION,
            operationId: DISABLE_RLS.id,
            subject: 'public.post',
            label: DISABLE_RLS.label,
          },
        ],
      },
    });
    expect(runnerCalls).toEqual([]);
  });

  it('reports both settings in one error when the migration breaks both', async () => {
    const { result } = await migrate({
      appOps: [DROP_COLUMN, DISABLE_RLS],
      markers: forbidding({
        dataProtection: {
          dataLoss: 'data-loss-forbidden',
          accessWidening: 'access-widening-forbidden',
        },
      }),
    });

    expect(result.ok ? undefined : result.failure.toEnvelope().meta).toMatchObject({
      settings: [
        { setting: 'dataLoss', level: 'data-loss-forbidden' },
        { setting: 'accessWidening', level: 'access-widening-forbidden' },
      ],
    });
  });

  it.each([
    { level: 'data-loss-with-consent', markers: new Map<string, ContractMarkerRecord>() },
    {
      level: 'data-loss-permitted',
      markers: forbidding({ dataProtection: { dataLoss: 'data-loss-permitted' } }),
    },
  ])('runs a migration that loses data under $level', async ({ markers }) => {
    const { result, runnerCalls } = await migrate({ appOps: [DROP_COLUMN], markers });

    expect({ ok: result.ok, spaces: runnerCalls.map((call) => call.map((o) => o.space)) }).toEqual({
      ok: true,
      spaces: [['app']],
    });
  });

  it('runs under the settings the ref declares when the run consents to loosening forbidden', async () => {
    const { result, runnerCalls } = await migrate({
      appOps: [DROP_COLUMN],
      markers: forbidding(DATA_LOSS_FORBIDDEN),
      ref: production({ dataProtection: { dataLoss: 'data-loss-with-consent' } }),
      permitPolicyChange: true,
    });

    expect({
      ok: result.ok,
      written: runnerCalls.map((call) =>
        call.map((o) => o.databasePolicies?.dataProtection.dataLoss),
      ),
    }).toEqual({ ok: true, written: [['data-loss-with-consent']] });
  });

  it('refuses, naming the ref, when the run consents to tightening to forbidden with a lossy migration pending', async () => {
    const { result, runnerCalls } = await migrate({
      appOps: [DROP_COLUMN],
      markers: new Map(),
      ref: production(DATA_LOSS_FORBIDDEN),
      permitPolicyChange: true,
    });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toMatchObject({
      code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
      summary: 'production declares a data protection policy that forbids data loss',
      why: expect.stringMatching(/^production declares dataLoss: data-loss-forbidden\. /),
    });
    expect(runnerCalls).toEqual([]);
  });

  it('refuses a migration of an extension space that loses data, naming the space', async () => {
    const { result, runnerCalls } = await migrate({
      appOps: [CREATE_TABLE],
      markers: forbidding(DATA_LOSS_FORBIDDEN),
      withAuditSpace: true,
    });

    expect(result.ok ? undefined : result.failure.toEnvelope().meta).toMatchObject({
      operations: [
        {
          setting: 'dataLoss',
          spaceId: AUDIT_SPACE,
          migration: AUDIT_MIGRATION,
          operationId: DROP_AUDIT.id,
        },
      ],
    });
    expect(runnerCalls).toEqual([]);
  });

  it('records the policies of a run with nothing pending, since it has no operation to refuse', async () => {
    const { result, runnerCalls } = await migrate({
      appOps: [DROP_COLUMN],
      markers: new Map([['app', markerAt(APP_HEAD)]]),
      ref: production(DATA_LOSS_FORBIDDEN),
      permitPolicyChange: true,
    });

    expect({
      summary: result.ok ? result.value.summary : result.failure.code,
      written: runnerCalls.map((call) =>
        call.map((o) => o.databasePolicies?.dataProtection.dataLoss),
      ),
    }).toEqual({
      summary: 'Policies updated: dataProtection.dataLoss: data-loss-forbidden',
      written: [['data-loss-forbidden']],
    });
  });

  it('names the later of two pending migrations when it holds the drop', async () => {
    const { result } = await migrate({
      earlierOps: [CREATE_TABLE],
      appOps: [DROP_COLUMN],
      markers: forbidding(DATA_LOSS_FORBIDDEN),
    });

    const envelope = result.ok ? undefined : result.failure.toEnvelope();
    expect({ why: envelope?.why, meta: envelope?.meta }).toMatchObject({
      why: expect.stringContaining(`in migration ${LATER_MIGRATION} of contract space "app"`),
      meta: { operations: [{ migration: LATER_MIGRATION, operationId: DROP_COLUMN.id }] },
    });
  });
});
