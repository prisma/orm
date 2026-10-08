import { rmSync, writeFileSync } from 'node:fs';
import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationPlannerResult,
  ResolvedMigrationStatement,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import {
  contractSnapshotDir,
  type SnapshotContentVerifier,
  writeContractSnapshot,
} from '@internal/migration-tools/contract-snapshot-store';
import { MigrationToolsError } from '@internal/migration-tools/errors';
import { ok } from '@internal/utils/result';
import { join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDbUpdate } from '../../src/control-api/operations/db-update';
import { renameStatements } from '../../src/control-api/statements/statement-text';
import { createTestProjectDir } from '../utils/test-project-dir';

const ORIGIN_HASH = 'a'.repeat(64);
const DESTINATION_HASH = 'b'.repeat(64);

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

/** A family whose serializer refuses the snapshot of the origin hash when `unreadableOrigin` is set. */
function familyWithMarker(
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

interface PlannerCall {
  readonly fromContract: unknown;
  readonly origin: { readonly storageHash: string } | null;
  readonly statements: readonly ResolvedMigrationStatement[];
}

function recordingMigrations(operationClass: 'additive' | 'destructive' = 'additive') {
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

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function migrationsDirWithSnapshot(contract: Contract | undefined): Promise<string> {
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

function update(options: {
  readonly migrationsDir: string;
  readonly marker: ContractMarkerRecord | undefined;
  readonly renames: readonly string[];
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
    driver,
    adapter: {} as unknown as ControlAdapterInstance<'sql', 'postgres'>,
    familyInstance: familyWithMarker(options.marker, {
      unreadableOrigin: options.unreadableOrigin ?? false,
    }),
    contract: destination,
    mode: options.mode ?? 'plan',
    migrations: options.migrations,
    frameworkComponents: [],
    migrationsDir: options.migrationsDir,
    targetId: 'postgres',
    statements: renameStatements(options.renames),
    ...(options.verifySnapshotContent === undefined
      ? {}
      : { verifySnapshotContent: options.verifySnapshotContent }),
  });
}

describe('executeDbUpdate with statements', () => {
  it('plans from the snapshot of the marker hash and hands the planner the resolved statements', async () => {
    const { migrations, calls } = recordingMigrations();
    const result = await update({
      migrationsDir: await migrationsDirWithSnapshot(origin),
      marker: markerAt(ORIGIN_HASH),
      renames: ['Profile:User'],
      migrations,
    });

    expect(calls).toEqual([
      {
        fromContract: origin,
        origin: null,
        statements: [
          {
            kind: 'rename',
            entity: 'model',
            from: { namespaceId: 'app', model: 'Profile' },
            to: { namespaceId: 'app', model: 'User' },
          },
        ],
      },
    ]);
    expect(result.ok && result.value.appliedStatements).toEqual([
      expect.objectContaining({
        description: 'rename model "Profile" to "User"',
        operationIndexes: [0],
      }),
    ]);
  });

  it('hands the runner a plan with no origin, as without statements', async () => {
    const { migrations, execute } = recordingMigrations();
    await update({
      migrationsDir: await migrationsDirWithSnapshot(origin),
      marker: markerAt(ORIGIN_HASH),
      renames: ['Profile:User'],
      mode: 'apply',
      migrations,
    });
    const [runnerOptions] = execute.mock.calls[0] ?? [];
    expect(runnerOptions.perSpaceOptions[0].plan.origin).toBeNull();
  });

  it('refuses statements when the snapshot of the marker hash cannot be read, naming why', async () => {
    const { migrations, calls } = recordingMigrations();
    await expect(
      update({
        migrationsDir: await migrationsDirWithSnapshot(origin),
        marker: markerAt(ORIGIN_HASH),
        renames: ['Profile:User'],
        unreadableOrigin: true,
        migrations,
      }),
    ).rejects.toMatchObject({
      code: 'MIGRATION.STATEMENT_ORIGIN_UNKNOWN',
      why: expect.stringContaining('unknown contract format'),
    });
    expect(calls).toEqual([]);
  });

  it('says the snapshot cannot be read when its contract.json is not JSON, rather than that it is missing', async () => {
    const { migrations, calls } = recordingMigrations();
    const migrationsDir = await migrationsDirWithSnapshot(origin);
    writeFileSync(
      join(contractSnapshotDir(migrationsDir, ORIGIN_HASH), 'contract.json'),
      '{ not json',
    );
    const refusal = await update({
      migrationsDir,
      marker: markerAt(ORIGIN_HASH),
      renames: ['Profile:User'],
      migrations,
    }).catch((error: unknown) => error);
    expect(refusal).toMatchObject({
      code: 'MIGRATION.STATEMENT_ORIGIN_UNKNOWN',
      why: expect.stringMatching(
        /^The contract snapshot for hash "a+" in .* could not be read: Failed to parse/,
      ),
      fix: expect.stringContaining('Restore migrations/snapshots/ from version control'),
      meta: { unreadable: expect.stringContaining('Failed to parse') },
    });
    expect(calls).toEqual([]);
  });

  it('says the snapshot cannot be read when its content does not match its hash', async () => {
    const { migrations } = recordingMigrations();
    const migrationsDir = await migrationsDirWithSnapshot(origin);
    const refusal = await update({
      migrationsDir,
      marker: markerAt(ORIGIN_HASH),
      renames: ['Profile:User'],
      migrations,
      verifySnapshotContent: {
        assertSnapshotContentMatches: (_json, storageHash, jsonPath) => {
          throw new MigrationToolsError(
            'MIGRATION.CONTRACT_SNAPSHOT_CONTENT_MISMATCH',
            'Contract snapshot content does not match its hash',
            {
              why: `The contract snapshot at "${jsonPath}" is addressed by storage hash ${storageHash}, but its content recomputes to ${'c'.repeat(64)}.`,
              fix: 'Restore migrations/snapshots/ from version control.',
            },
          );
        },
      },
    }).catch((error: unknown) => error);
    expect(refusal).toMatchObject({
      code: 'MIGRATION.STATEMENT_ORIGIN_UNKNOWN',
      why: expect.stringContaining('could not be read: The contract snapshot at'),
      meta: { unreadable: expect.stringContaining('its content recomputes to') },
    });
  });

  it('reports the applied statements on an apply', async () => {
    const { migrations } = recordingMigrations();
    const result = await update({
      migrationsDir: await migrationsDirWithSnapshot(origin),
      marker: markerAt(ORIGIN_HASH),
      renames: ['Profile:User'],
      mode: 'apply',
      migrations,
    });
    expect(result.ok && result.value.mode).toBe('apply');
    expect(result.ok && result.value.appliedStatements).toHaveLength(1);
  });

  it('gives the destructive pre-plan the statements, so a rename is not refused as a drop', async () => {
    const { migrations, calls } = recordingMigrations('destructive');
    const result = await update({
      migrationsDir: await migrationsDirWithSnapshot(origin),
      marker: markerAt(ORIGIN_HASH),
      renames: ['Profile:User'],
      mode: 'apply',
      migrations,
    });
    expect(result.ok).toBe(true);
    expect(calls.every((call) => call.statements.length === 1)).toBe(true);
  });

  it('refuses statements when the snapshot store has no contract for the marker hash', async () => {
    const { migrations, calls } = recordingMigrations();
    const migrationsDir = await migrationsDirWithSnapshot(undefined);
    await expect(
      update({
        migrationsDir,
        marker: markerAt(ORIGIN_HASH),
        renames: ['Profile:User'],
        migrations,
      }),
    ).rejects.toMatchObject({
      code: 'MIGRATION.STATEMENT_ORIGIN_UNKNOWN',
      meta: { hash: ORIGIN_HASH, snapshotDirectory: join(migrationsDir, 'snapshots', ORIGIN_HASH) },
      fix: expect.stringContaining('--advance-ref <name>'),
    });
    expect(calls).toEqual([]);
  });

  it('refuses statements when the database has no marker', async () => {
    const { migrations } = recordingMigrations();
    await expect(
      update({
        migrationsDir: await migrationsDirWithSnapshot(undefined),
        marker: undefined,
        renames: ['Profile:User'],
        migrations,
      }),
    ).rejects.toMatchObject({
      code: 'MIGRATION.STATEMENT_ORIGIN_UNKNOWN',
      meta: { hash: null },
      why: expect.stringContaining('no earlier contract'),
      fix: expect.not.stringContaining('--advance-ref'),
    });
  });

  it('refuses the same statements once the database is at the destination', async () => {
    const { migrations } = recordingMigrations();
    await expect(
      update({
        migrationsDir: await migrationsDirWithSnapshot(destination),
        marker: markerAt(DESTINATION_HASH),
        renames: ['Profile:User'],
        migrations,
      }),
    ).rejects.toMatchObject({ code: 'MIGRATION.STATEMENT_UNRESOLVED' });
  });

  it('reads no snapshot without statements, and plans from no origin contract', async () => {
    const withSnapshot = recordingMigrations();
    const result = await update({
      migrationsDir: await migrationsDirWithSnapshot(origin),
      marker: markerAt(ORIGIN_HASH),
      renames: [],
      unreadableOrigin: true,
      migrations: withSnapshot.migrations,
    });
    expect(result.ok).toBe(true);
    expect(withSnapshot.calls).toEqual([{ fromContract: null, origin: null, statements: [] }]);

    const without = recordingMigrations();
    const withoutSnapshot = await update({
      migrationsDir: await migrationsDirWithSnapshot(undefined),
      marker: markerAt(ORIGIN_HASH),
      renames: [],
      migrations: without.migrations,
    });
    expect(without.calls).toEqual([{ fromContract: null, origin: null, statements: [] }]);
    expect(withoutSnapshot.ok && withoutSnapshot.value.appliedStatements).toEqual([]);
  });
});
