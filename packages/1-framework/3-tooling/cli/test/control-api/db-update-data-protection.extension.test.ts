import { rmSync } from 'node:fs';
import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyInstance,
  DeclaredDatabasePolicies,
  MigrationAccessChange,
  MigrationPlannerResult,
  MigrationPlanOperation,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { writeRef } from '@internal/migration-tools/refs';
import { ok } from '@internal/utils/result';
import { createSqlContract } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDbUpdate } from '../../src/control-api/operations/db-update';
import type { PlanQuestion } from '../../src/control-api/statements/plan-questions';
import { createTestProjectDir } from '../utils/test-project-dir';

const AUDIT_SPACE = 'audit';
const AUDIT_MIGRATION = '20260101T0000_audit';

const APP_CONTRACT = createSqlContract();
const ORIGIN_HASH = APP_CONTRACT.storage.storageHash;
const AUDIT_CONTRACT: Contract = createSqlContract({
  storage: {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: { audit_log: {} } } },
    },
  },
});
const AUDIT_HEAD = AUDIT_CONTRACT.storage.storageHash;

const DROP_AUDIT: MigrationPlanOperation = {
  id: 'table.audit_old.drop',
  label: 'Drop table audit_old',
  operationClass: 'destructive',
};
const DISABLE_RLS: MigrationPlanOperation = {
  id: 'rowLevelSecurity.public.audit_log.disable',
  label: 'Disable row-level security on "audit_log"',
  operationClass: 'widening',
};
const AUDIT_OPS = [DROP_AUDIT, DISABLE_RLS];
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
    contractJson: Object.assign(AUDIT_CONTRACT, { formatVersion: 1 }),
    headRef: { hash: AUDIT_HEAD, invariants: [] },
    migrations: [
      {
        dirName: AUDIT_MIGRATION,
        metadata: {
          ...AUDIT_METADATA,
          migrationHash: computeMigrationHash(AUDIT_METADATA, AUDIT_OPS),
        },
        ops: AUDIT_OPS,
      },
    ],
  },
  create: () => ({ familyId: 'sql', targetId: 'postgres' }),
};

/** The application space plans nothing, so every question is about the audit space's recorded migration. */
const migrations = {
  createPlanner: () => ({
    plan: (options: {
      readonly origin: { readonly storageHash: string } | null;
    }): MigrationPlannerResult => ({
      kind: 'success',
      appliedStatements: [],
      dataLoss: [],
      accessChanges: [],
      temporaryValues: [],
      plan: {
        targetId: 'postgres',
        origin: options.origin,
        destination: { storageHash: APP_CONTRACT.storage.storageHash },
        operations: [],
        renderTypeScript: () => '',
      },
    }),
  }),
  createRunner: () => ({
    execute: vi.fn().mockResolvedValue(ok({ perSpaceResults: [] })),
  }),
} as unknown as TargetMigrationsCapability<
  'sql',
  'postgres',
  ControlFamilyInstance<'sql', unknown>
>;

function markerWith(policies: DeclaredDatabasePolicies | undefined): ContractMarkerRecord {
  return {
    storageHash: ORIGIN_HASH,
    profileHash: '',
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(0),
    appTag: null,
    meta: policies === undefined ? {} : { policies },
    invariants: [],
  };
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function update(policies: DeclaredDatabasePolicies | undefined) {
  const dir = createTestProjectDir('db-update-data-protection-extension');
  tempDirs.push(dir);
  const migrationsDir = join(dir, 'migrations');
  await writeContractSnapshot(migrationsDir, ORIGIN_HASH, {
    contractJson: { formatVersion: 1, ...APP_CONTRACT },
    contractDts: '',
  });
  await writeContractSnapshot(migrationsDir, AUDIT_HEAD, {
    contractJson: { formatVersion: 1, ...AUDIT_CONTRACT },
    contractDts: '',
  });
  await writeMigrationPackage(
    join(migrationsDir, AUDIT_SPACE, AUDIT_MIGRATION),
    { ...AUDIT_METADATA, migrationHash: computeMigrationHash(AUDIT_METADATA, AUDIT_OPS) },
    AUDIT_OPS,
  );
  await writeRef(join(migrationsDir, AUDIT_SPACE, 'refs'), 'head', {
    hash: AUDIT_HEAD,
    invariants: [],
  });
  const asked: (readonly PlanQuestion[])[] = [];
  const result = await executeDbUpdate({
    invocation: { cwd: '/work/app', configPath: undefined, dbGiven: false },
    driver: { close: vi.fn() } as unknown as ControlDriverInstance<'sql', 'postgres'>,
    adapter: {} as unknown as ControlAdapterInstance<'sql', 'postgres'>,
    familyInstance: {
      familyId: 'sql',
      markerLocation: 'prisma_contract.marker',
      readAllMarkers: async () => new Map([['app', markerWith(policies)]]),
      introspect: async () => ({ tables: {} }),
      deserializeContract: (json: unknown) => json as Contract,
      toOperationPreview: () => ({ statements: [] }),
      storageNameOf: (operation: MigrationPlanOperation) => `stored ${operation.id}`,
      accessChangesOf: (operations: readonly MigrationPlanOperation[]) =>
        operations.flatMap((operation, operationIndex): MigrationAccessChange[] =>
          operation.id === DISABLE_RLS.id
            ? [{ operationIndex, subject: { kind: 'storage', name: 'audit_log' }, widens: true }]
            : [],
        ),
    } as unknown as ControlFamilyInstance<'sql', unknown>,
    contract: APP_CONTRACT,
    mode: 'apply',
    migrations,
    frameworkComponents: [],
    migrationsDir,
    extensions: [auditExtension],
    targetId: 'postgres',
    answerQuestions: async (questions) => {
      asked.push(questions);
      return questions.map((question) => ({
        verb: question.verbs.includes('allow') ? 'allow' : 'delete',
        text: question.subject,
      }));
    },
  });
  return { result, asked };
}

describe("executeDbUpdate, an extension space's recorded migration", () => {
  it.each([
    {
      policies: { dataProtection: { dataLoss: 'data-loss-forbidden' } },
      setting: 'dataLoss',
      operation: DROP_AUDIT,
      subject: `stored ${DROP_AUDIT.id}`,
      forbids: 'losing data',
    },
    {
      policies: { dataProtection: { accessWidening: 'access-widening-forbidden' } },
      setting: 'accessWidening',
      operation: DISABLE_RLS,
      subject: 'audit_log',
      forbids: 'changing who can read or write data',
    },
  ] as const)(
    'refuses its $setting under the forbidden level, naming the space and advising the extension, without asking',
    async ({ policies, setting, operation, subject, forbids }) => {
      const { result, asked } = await update(policies);
      const envelope = result.ok ? undefined : result.failure.toEnvelope();

      expect({ fix: envelope?.fix, operations: envelope?.meta?.['operations'], asked }).toEqual({
        fix: `This database's data protection policy forbids ${forbids}, so these operations cannot run on it. Contract space "${AUDIT_SPACE}" belongs to an extension, so do not edit or delete its migrations; ask the extension's author for a version without the operation. To do it anyway, whoever owns the database must first change its data protection policy.`,
        operations: [
          {
            setting,
            spaceId: AUDIT_SPACE,
            operationId: operation.id,
            subject,
            label: operation.label,
          },
        ],
        asked: [],
      });
    },
  );

  it('asks about its loss and its access change under the default levels', async () => {
    const { asked } = await update(undefined);

    expect(
      asked.map((questions) =>
        questions.map(({ subject, verbs }) => ({ subject, allow: verbs.includes('allow') })),
      ),
    ).toEqual([
      [
        { subject: `stored ${DROP_AUDIT.id}`, allow: false },
        { subject: 'audit_log', allow: true },
      ],
    ]);
  });
});
