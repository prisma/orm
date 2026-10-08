import { rmSync } from 'node:fs';
import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyInstance,
  MigrationPlannerResult,
  MigrationPlanOperation,
  ResolvedMigrationStatement,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { writeRef } from '@internal/migration-tools/refs';
import { createSqlContract } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDbUpdate } from '../../src/control-api/operations/db-update';
import { renameStatements } from '../../src/control-api/statements/statement-text';
import { createTestProjectDir } from '../utils/test-project-dir';

const ORIGIN_HASH = 'a'.repeat(64);
const DESTINATION_HASH = 'b'.repeat(64);
const AUDIT_SPACE = 'audit';

function contractWithModels(storageHash: string, models: readonly string[]): Contract {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storage: { storageHash, tables: {}, namespaces: {} },
    domain: {
      namespaces: {
        app: {
          models: Object.fromEntries(
            models.map((model) => [model, { fields: {}, relations: {}, storage: {} }]),
          ),
        },
      },
    },
  } as unknown as Contract;
}

const origin = contractWithModels(ORIGIN_HASH, ['Profile']);
const destination = contractWithModels(DESTINATION_HASH, ['User']);

const AUDIT_CONTRACT: Contract = createSqlContract({
  storage: {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: { audit_log: {} } } },
    },
  },
});
const AUDIT_HEAD = AUDIT_CONTRACT.storage.storageHash;
const AUDIT_OPS: readonly MigrationPlanOperation[] = [
  { id: 'table.audit_log', label: 'Create table audit_log', operationClass: 'additive' },
  { id: 'dropTable.audit_old', label: 'Drop table audit_old', operationClass: 'destructive' },
  { id: 'index.audit_log.at', label: 'Create index on audit_log', operationClass: 'additive' },
];
const AUDIT_METADATA: Omit<MigrationMetadata, 'migrationHash'> = {
  from: EMPTY_CONTRACT_HASH,
  to: AUDIT_HEAD,
  providedInvariants: [],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const RENAME_OP: MigrationPlanOperation = {
  id: 'renameTable.Profile',
  label: 'Rename table "Profile" to "User"',
  operationClass: 'widening',
};

const LOST = { kind: 'storage', name: 'audit_log' } as const;

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

const driver = {
  close: vi.fn(),
  databaseName: async () => 'appdb',
} as unknown as ControlDriverInstance<'sql', 'postgres'>;

const family = {
  familyId: 'sql',
  readAllMarkers: async () => new Map([['app', markerAt(ORIGIN_HASH)]]),
  introspect: async () => ({ tables: {} }),
  deserializeContract: (json: unknown) => json as Contract,
  toOperationPreview: () => ({ statements: [] }),
  storageNameOf: (operation: MigrationPlanOperation) => `stored ${operation.id}`,
} as unknown as ControlFamilyInstance<'sql', unknown>;

const migrations = {
  createPlanner: () => ({
    plan: (options: {
      readonly origin: { readonly storageHash: string } | null;
      readonly statements: readonly ResolvedMigrationStatement[];
    }): MigrationPlannerResult => ({
      kind: 'success',
      appliedStatements: options.statements.map((statement) => ({
        statement,
        operationIndexes: [0],
      })),
      dataLoss: [{ operationIndex: 0, subject: LOST }],
      accessWidening: [{ operationIndex: 0, subject: LOST, widens: true }],
      plan: {
        targetId: 'postgres',
        origin: options.origin,
        destination: { storageHash: DESTINATION_HASH },
        operations: [RENAME_OP],
        renderTypeScript: () => '',
      },
    }),
  }),
  createRunner: () => ({ execute: vi.fn() }),
} as unknown as TargetMigrationsCapability<
  'sql',
  'postgres',
  ControlFamilyInstance<'sql', unknown>
>;

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
        dirName: '20260101T0000_init',
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

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The app's origin snapshot, and an audit extension space with one migration still to apply. */
async function migrationsDirWithPendingExtension(): Promise<string> {
  const dir = createTestProjectDir('db-update-statement-positions');
  tempDirs.push(dir);
  const migrationsDir = join(dir, 'migrations');
  await writeContractSnapshot(migrationsDir, ORIGIN_HASH, {
    contractJson: origin,
    contractDts: '',
  });
  await writeContractSnapshot(migrationsDir, AUDIT_HEAD, {
    contractJson: AUDIT_CONTRACT,
    contractDts: '',
  });
  await writeMigrationPackage(
    join(migrationsDir, AUDIT_SPACE, '20260101T0000_init'),
    { ...AUDIT_METADATA, migrationHash: computeMigrationHash(AUDIT_METADATA, AUDIT_OPS) },
    AUDIT_OPS,
  );
  await writeRef(join(migrationsDir, AUDIT_SPACE, 'refs'), 'head', {
    hash: AUDIT_HEAD,
    invariants: [],
  });
  return migrationsDir;
}

describe('executeDbUpdate statement positions', () => {
  it('index the plan operations of every space, after the operations of spaces applied before the app', async () => {
    const result = await executeDbUpdate({
      driver,
      adapter: {} as unknown as ControlAdapterInstance<'sql', 'postgres'>,
      familyInstance: family,
      contract: destination,
      mode: 'plan',
      migrations,
      frameworkComponents: [],
      migrationsDir: await migrationsDirWithPendingExtension(),
      targetId: 'postgres',
      extensions: [auditExtension],
      answerQuestions: async () => [],
      statements: renameStatements(['Profile:User']),
    });

    if (!result.ok) throw new Error(`expected a plan: ${JSON.stringify(result.failure)}`);
    const { operations } = result.value.plan;
    expect(operations.map((operation) => operation.id)).toEqual([
      ...AUDIT_OPS.map((operation) => operation.id),
      RENAME_OP.id,
    ]);
    expect(
      result.value.appliedStatements.map((applied) =>
        applied.operationIndexes.map((index) => operations[index]?.id),
      ),
    ).toEqual([[RENAME_OP.id]]);
    expect(
      [result.value.dataLoss, result.value.accessWidening].map((entries) =>
        entries.map(({ operationIndex, subject }) => ({
          operation: operations[operationIndex]?.id,
          subject,
        })),
      ),
    ).toEqual([
      [
        {
          operation: 'dropTable.audit_old',
          subject: { kind: 'storage', name: 'stored dropTable.audit_old' },
        },
        { operation: RENAME_OP.id, subject: LOST },
      ],
      [{ operation: RENAME_OP.id, subject: LOST }],
    ]);
    const listed = new Set(result.value.dataLoss.map(({ operationIndex }) => operationIndex));
    expect(
      operations.flatMap((operation, index) =>
        operation.operationClass === 'destructive' && !listed.has(index) ? [operation.id] : [],
      ),
    ).toEqual([]);
  });
});
