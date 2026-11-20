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
import { executeMigrate } from '../../src/control-api/operations/migrate';
import { createTestProjectDir } from '../utils/test-project-dir';

const APP_CONTRACT: Contract = createSqlContract();
export const APP_HEAD = APP_CONTRACT.storage.storageHash;
export const APP_MIGRATION = '20260101T0000_initial';

export const AUDIT_SPACE = 'audit';
export const AUDIT_MIGRATION = '20260101T0000_audit';
const AUDIT_CONTRACT: Contract = createSqlContract({
  storage: {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: { audit_log: {} } } },
    },
  },
});
const AUDIT_HEAD = AUDIT_CONTRACT.storage.storageHash;

export const CREATE_TABLE: MigrationPlanOperation = {
  id: 'table.post',
  label: 'Create table post',
  operationClass: 'additive',
};
export const DROP_COLUMN: MigrationPlanOperation = {
  id: 'column.user.legacy_name.drop',
  label: 'Drop column "legacy_name" from "user"',
  operationClass: 'destructive',
};
export const DISABLE_RLS: MigrationPlanOperation = {
  id: 'rowLevelSecurity.public.post.disable',
  label: 'Disable row-level security on "post"',
  operationClass: 'widening',
};
export const DROP_AUDIT: MigrationPlanOperation = {
  id: 'table.audit_old.drop',
  label: 'Drop table audit_old',
  operationClass: 'destructive',
};

const projectDirs: string[] = [];

/** Removes the project directories the tests in a file created. */
export async function removeProjectDirs(): Promise<void> {
  await Promise.all(projectDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

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
export const LATER_MIGRATION = '20260102T0000_drop_legacy';

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

export function markerAt(
  storageHash: string,
  policies?: DeclaredDatabasePolicies,
): ContractMarkerRecord {
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

export async function migrate(args: {
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

export function forbidding(
  policies: DeclaredDatabasePolicies,
): ReadonlyMap<string, ContractMarkerRecord> {
  return new Map([['app', markerAt(EMPTY_CONTRACT_HASH, policies)]]);
}

export const DATA_LOSS_FORBIDDEN = { dataProtection: { dataLoss: 'data-loss-forbidden' } } as const;
export const ACCESS_FORBIDDEN = {
  dataProtection: { accessWidening: 'access-widening-forbidden' },
} as const;

export function production(policies: DeclaredDatabasePolicies): NamedRef {
  return { name: 'production', hash: APP_HEAD, invariants: [], policies };
}
