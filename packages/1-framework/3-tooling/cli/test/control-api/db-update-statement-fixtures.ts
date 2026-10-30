import { rmSync } from 'node:fs';
import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationPlannerResult,
  MigrationPlannerSuccessResult,
  ResolvedMigrationStatement,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import {
  type SnapshotContentVerifier,
  writeContractSnapshot,
} from '@internal/migration-tools/contract-snapshot-store';
import { ok } from '@internal/utils/result';
import { join } from 'pathe';
import { afterEach, type Mock, vi } from 'vitest';
import { executeDbUpdate } from '../../src/control-api/operations/db-update';
import {
  renameStatements,
  type StatementText,
} from '../../src/control-api/statements/statement-text';
import { createTestProjectDir } from '../utils/test-project-dir';

export const TEST_INVOCATION = { cwd: '/work/app', configPath: undefined, dbGiven: false };

export const ORIGIN_HASH = 'a'.repeat(64);
export const DESTINATION_HASH = 'b'.repeat(64);

export function contractWithModels(storageHash: string, models: readonly string[]): Contract {
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

export const origin = contractWithModels(ORIGIN_HASH, ['Profile']);
export const destination = contractWithModels(DESTINATION_HASH, ['User']);

export function markerAt(storageHash: string): ContractMarkerRecord {
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

export const driver = {
  close: vi.fn(),
  databaseName: async () => 'appdb',
} as unknown as ControlDriverInstance<'sql', 'postgres'>;

/** A family whose serializer refuses the snapshot of the origin hash when `unreadableOrigin` is set. */
export function familyWithMarker(
  marker: ContractMarkerRecord | undefined,
  options: { readonly unreadableOrigin?: boolean } = {},
) {
  return {
    familyId: 'sql',
    readAllMarkers: async () => (marker === undefined ? new Map() : new Map([['app', marker]])),
    introspect: async () => ({ tables: {} }),
    deserializeContract: (json: unknown) => {
      if (options.unreadableOrigin && (json as Contract).storage.storageHash === ORIGIN_HASH) {
        throw new Error('unknown contract format');
      }
      return json as Contract;
    },
    toOperationPreview: () => ({ statements: [] }),
  } as unknown as ControlFamilyInstance<'sql', unknown>;
}

export interface PlannerCall {
  readonly fromContract: unknown;
  readonly origin: { readonly storageHash: string } | null;
  readonly statements: readonly ResolvedMigrationStatement[];
}

export function recordingMigrations(
  operationClass: 'additive' | 'destructive' = 'additive',
  dataLoss: MigrationPlannerSuccessResult['dataLoss'] = [],
): {
  readonly migrations: TargetMigrationsCapability<
    'sql',
    'postgres',
    ControlFamilyInstance<'sql', unknown>
  >;
  readonly calls: PlannerCall[];
  readonly execute: Mock;
} {
  const calls: PlannerCall[] = [];
  const execute = vi.fn().mockResolvedValue(
    ok({
      perSpaceResults: [{ space: 'app', value: { operationsPlanned: 1, operationsExecuted: 1 } }],
    }),
  );
  const migrations = {
    createPlanner: () => ({
      plan: (options: PlannerCall): MigrationPlannerResult => {
        calls.push({
          fromContract: options.fromContract,
          origin: options.origin,
          statements: options.statements,
        });
        const renamed = options.statements.length > 0;
        return {
          kind: 'success',
          dataLoss,
          accessChanges: [],
          temporaryValues: [],
          appliedStatements: options.statements.map((statement) => ({
            statement,
            operationIndexes: [0],
          })),
          plan: {
            targetId: 'postgres',
            origin: options.origin,
            destination: { storageHash: DESTINATION_HASH },
            operations: [
              renamed
                ? { id: 'renameTable.Profile', label: 'Rename table', operationClass: 'widening' }
                : { id: 'dropTable.Profile', label: 'Drop table', operationClass },
            ],
            renderTypeScript: () => '',
          },
        };
      },
    }),
    createRunner: () => ({ execute }),
  } as unknown as TargetMigrationsCapability<
    'sql',
    'postgres',
    ControlFamilyInstance<'sql', unknown>
  >;
  return { migrations, calls, execute };
}

export const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export async function migrationsDirWithSnapshot(contract: Contract | undefined): Promise<string> {
  const dir = createTestProjectDir('db-update-statements');
  tempDirs.push(dir);
  const migrationsDir = join(dir, 'migrations');
  if (contract !== undefined) {
    await writeContractSnapshot(migrationsDir, contract.storage.storageHash, {
      contractJson: contract,
      contractDts: '',
    });
  }
  return migrationsDir;
}

export function update(options: {
  readonly migrationsDir: string;
  readonly marker: ContractMarkerRecord | undefined;
  readonly renames: readonly string[];
  readonly fieldStatements?: readonly StatementText[];
  readonly destination?: Contract;
  readonly mode?: 'plan' | 'apply';
  readonly unreadableOrigin?: boolean;
  readonly verifySnapshotContent?: SnapshotContentVerifier;
  readonly migrations: TargetMigrationsCapability<
    'sql',
    'postgres',
    ControlFamilyInstance<'sql', unknown>
  >;
}) {
  return executeDbUpdate({
    invocation: TEST_INVOCATION,
    driver,
    adapter: {} as unknown as ControlAdapterInstance<'sql', 'postgres'>,
    familyInstance: familyWithMarker(options.marker, {
      unreadableOrigin: options.unreadableOrigin ?? false,
    }),
    contract: options.destination ?? destination,
    mode: options.mode ?? 'plan',
    migrations: options.migrations,
    frameworkComponents: [],
    migrationsDir: options.migrationsDir,
    answerQuestions: async () => [],
    targetId: 'postgres',
    statements: [...renameStatements(options.renames), ...(options.fieldStatements ?? [])],
    ...(options.verifySnapshotContent === undefined
      ? {}
      : { verifySnapshotContent: options.verifySnapshotContent }),
  });
}
