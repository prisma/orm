import { mkdir } from 'node:fs/promises';
import { executeDbInit, executeDbUpdate } from '@internal/cli/control-api';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type {
  CodecControlHooks,
  SqlControlExtensionDescriptor,
  SqlMigrationPlanOperation,
} from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { MigrationPlanOperation, OpFactoryCall } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { materialiseMigrationPackage } from '@internal/migration-tools/io';
import { emitContractSpaceArtifacts } from '@internal/migration-tools/spaces';
import { SqlStorage } from '@internal/sql-contract/types';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { applicationDomainOf, timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import {
  contract as appContract,
  controlAdapter,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  sqliteTargetDescriptor,
  type TestDatabase,
} from './fixtures/runner-fixtures';
import { textCodecDescriptor } from './fixtures/sqlite-components';

/**
 * End-to-end coverage for the CLI aggregate `db init` / `db update`
 * pipeline against a real SQLite database with on-disk
 * artifacts.
 *
 * Locks the CLI-level half of:
 *
 * - rollback semantics — a failure in any space rolls back every
 *   space's writes and preserves pre-execution markers.
 * - atomic init across spaces.
 * - only the bumped extension advances on a follow-up update.
 * - codec hooks firing through the aggregate-pipeline path
 *   (loader → `planMigration` synth strategy → `frameworkComponents`).
 *
 * Companion to the unit-level tests in `@internal/cli` that mock
 * the planner / runner. The runner-level cross-space coverage lives in
 * `runner.across-spaces.test.ts`.
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 */

const EXT_SPACE_ID = 'test_contract_space_sqlite';
const EXT_BASELINE_DIR = '20260101T0000_create_helper';

// Stable 64-hex-char storage hashes: the contract-snapshot store keys its
// on-disk directory by `storageHashHex(storage.storageHash)`, which requires
// a well-formed 64-hex value.
const EXT_STORAGE_HASH_V1 = '1'.repeat(64);
const EXT_STORAGE_HASH_V2 = '2'.repeat(64);

function buildExtensionContract(version: 1 | 2): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash(`ext-test-v${version}`),
    storage: new SqlStorage({
      storageHash: coreHash(version === 1 ? EXT_STORAGE_HASH_V1 : EXT_STORAGE_HASH_V2),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              _ext_helper: {
                columns: {
                  id: { dataType: 'sqlite/integer', codecId: 'sqlite/integer@1', nullable: false },
                  ...(version === 2
                    ? {
                        note: { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: true },
                      }
                    : {}),
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

const extContractV1 = buildExtensionContract(1);
const extContractV2 = buildExtensionContract(2);

function buildBaselineOps(): readonly MigrationPlanOperation[] {
  return [
    {
      id: 'ext.create-helper',
      label: 'Create extension helper table',
      operationClass: 'additive',
      target: {
        id: 'sqlite',
        details: { schema: 'main', objectType: 'table', name: '_ext_helper' },
      },
      precheck: [],
      execute: [
        {
          description: 'create _ext_helper',
          sql: 'CREATE TABLE _ext_helper (id INTEGER PRIMARY KEY)',
        },
      ],
      postcheck: [],
    } as unknown as MigrationPlanOperation,
  ];
}

function buildAdvanceOps(): readonly MigrationPlanOperation[] {
  return [
    {
      id: 'ext.add-helper.note',
      label: 'Add note column to _ext_helper',
      operationClass: 'additive',
      target: {
        id: 'sqlite',
        details: { schema: 'main', objectType: 'table', name: '_ext_helper' },
      },
      precheck: [],
      execute: [
        {
          description: 'add note column',
          sql: 'ALTER TABLE _ext_helper ADD COLUMN note TEXT',
        },
      ],
      postcheck: [],
    } as unknown as MigrationPlanOperation,
  ];
}

function buildFailingOps(): readonly MigrationPlanOperation[] {
  return [
    {
      id: 'ext.always-fails',
      label: 'Always-failing extension op',
      operationClass: 'additive',
      target: {
        id: 'sqlite',
        details: { schema: 'main', objectType: 'table', name: '_ext_helper' },
      },
      precheck: [],
      execute: [
        {
          description: 'forced failure',
          sql: "SELECT raise(ABORT, 'forced failure')",
        },
      ],
      postcheck: [],
    } as unknown as MigrationPlanOperation,
  ];
}

interface ContractSpaceArtifactSetup {
  readonly migrationsDir: string;
}

async function writeExtensionContractSpaceArtifacts(args: {
  readonly tmpDir: string;
  readonly contract: Contract<SqlStorage>;
  readonly headHash: string;
  readonly invariants: readonly string[];
  readonly migrationDirName: string;
  readonly fromHash: string | null;
  readonly toHash: string;
  readonly ops: readonly MigrationPlanOperation[];
  readonly providedInvariants: readonly string[];
}): Promise<ContractSpaceArtifactSetup> {
  const migrationsDir = join(args.tmpDir, 'migrations');
  await mkdir(migrationsDir, { recursive: true });

  await emitContractSpaceArtifacts(migrationsDir, EXT_SPACE_ID, {
    contract: args.contract,
    contractDts: '// placeholder\nexport {};\n',
    headRef: { hash: args.headHash, invariants: [...args.invariants] },
  });

  const spaceDir = join(migrationsDir, EXT_SPACE_ID);
  const baseMeta = {
    from: args.fromHash,
    to: args.toHash,
    providedInvariants: [...args.providedInvariants],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const migrationHash = computeMigrationHash(baseMeta, [...args.ops]);
  await materialiseMigrationPackage(spaceDir, {
    dirName: args.migrationDirName,
    metadata: { ...baseMeta, migrationHash },
    ops: [...args.ops],
  });

  return { migrationsDir };
}

/**
 * Build a structurally-valid `SqlControlExtensionDescriptor` with the
 * `contractSpace` field the migrate-time seed pass reads. The
 * descriptor's `contractJson` is the same reference the test will pass
 * to the loader, and `headRef.hash` matches the on-disk head ref so
 * the loader's integrity check passes. Other descriptor fields
 * (`create`, `migrations`) are unused on the `db init` / `db update`
 * path — the loader reads migrations from disk and `create()` is only
 * invoked on the `migrate` path. They are stubbed minimally to satisfy
 * the type.
 */
function buildExtensionPack(args: {
  readonly contractJson: Contract<SqlStorage>;
  readonly headHash: string;
}): SqlControlExtensionDescriptor<'sqlite'> {
  const stubInstance = {
    familyId: 'sql' as const,
    targetId: 'sqlite' as const,
  };
  return {
    kind: 'extension',
    id: EXT_SPACE_ID,
    familyId: 'sql',
    targetId: 'sqlite',
    version: '0.0.0-test',
    contractSpace: {
      contractJson: args.contractJson,
      migrations: [],
      headRef: { hash: args.headHash, invariants: [] },
    },
    create: () => stubInstance,
  } as unknown as SqlControlExtensionDescriptor<'sqlite'>;
}

describe('db init / db update aggregate pipeline (CLI) - sqlite', {
  timeout: timeouts.databaseOperation,
}, () => {
  let testDb: TestDatabase | undefined;
  let tmpDirCleanup: (() => void) | undefined;

  afterEach(() => {
    testDb?.cleanup();
    testDb = undefined;
    tmpDirCleanup?.();
    tmpDirCleanup = undefined;
  });

  function createTmpDir(): string {
    const db = createTestDatabase();
    testDb = db;
    tmpDirCleanup = undefined;
    return db.path.replace(/\/test\.db$/, '');
  }

  async function setupBaseline(tmpDir: string): Promise<ContractSpaceArtifactSetup> {
    return writeExtensionContractSpaceArtifacts({
      tmpDir,
      contract: extContractV1,
      headHash: extContractV1.storage.storageHash,
      invariants: [],
      migrationDirName: EXT_BASELINE_DIR,
      fromHash: null,
      toHash: extContractV1.storage.storageHash,
      ops: buildBaselineOps(),
      providedInvariants: [],
    });
  }

  it('initialises both spaces atomically on a fresh database (locks AM9, AM11 prerequisites)', async () => {
    const tmpDir = createTmpDir();
    const { migrationsDir } = await setupBaseline(tmpDir);

    const result = await executeDbInit({
      driver: testDb!.driver,
      adapter: controlAdapter,
      familyInstance,
      contract: appContract,
      mode: 'apply',
      migrations: sqliteTargetDescriptor.migrations,
      frameworkComponents: [...frameworkComponents],
      migrationsDir,
      targetId: 'sqlite',
      extensions: [
        buildExtensionPack({
          contractJson: extContractV1,
          headHash: extContractV1.storage.storageHash,
        }),
      ],
    });

    if (!result.ok) {
      throw new Error(`Expected ok but got failure: ${JSON.stringify(result.failure, null, 2)}`);
    }
    expect(result.ok).toBe(true);

    const markers = await testDb!.driver.query<{ space: string; core_hash: string }>(
      'SELECT space, core_hash FROM _prisma_marker ORDER BY space',
    );
    expect(markers.rows.map((r) => r.space).sort()).toEqual(['app', EXT_SPACE_ID].sort());
    expect(markers.rows.find((r) => r.space === 'app')!.core_hash).toBe(
      appContract.storage.storageHash,
    );
    expect(markers.rows.find((r) => r.space === EXT_SPACE_ID)!.core_hash).toBe(
      extContractV1.storage.storageHash,
    );

    const userTable = await testDb!.driver.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = 'user'",
    );
    expect(userTable.rows[0]!.cnt).toBe(1);

    const helperTable = await testDb!.driver.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = '_ext_helper'",
    );
    expect(helperTable.rows[0]!.cnt).toBe(1);
  });

  it('advances only the bumped extension space when re-running with a new head (locks AM10)', async () => {
    const tmpDir = createTmpDir();
    const baseline = await setupBaseline(tmpDir);

    const initResult = await executeDbInit({
      driver: testDb!.driver,
      adapter: controlAdapter,
      familyInstance,
      contract: appContract,
      mode: 'apply',
      migrations: sqliteTargetDescriptor.migrations,
      frameworkComponents: [...frameworkComponents],
      migrationsDir: baseline.migrationsDir,
      targetId: 'sqlite',
      extensions: [
        buildExtensionPack({
          contractJson: extContractV1,
          headHash: extContractV1.storage.storageHash,
        }),
      ],
    });
    expect(initResult.ok).toBe(true);

    // Bump the extension to v2: emit the v2 head ref + a follow-on
    // migration package. The on-disk graph now has two edges
    // (null→v1, v1→v2); the marker is at v1 so only the second edge
    // walks.
    await emitContractSpaceArtifacts(baseline.migrationsDir, EXT_SPACE_ID, {
      contract: extContractV2,
      contractDts: '// placeholder\nexport {};\n',
      headRef: { hash: extContractV2.storage.storageHash, invariants: [] },
    });
    {
      const baseMeta = {
        from: extContractV1.storage.storageHash,
        to: extContractV2.storage.storageHash,
        providedInvariants: [],
        createdAt: '2026-02-01T00:00:00.000Z',
      };
      const ops = [...buildAdvanceOps()];
      await materialiseMigrationPackage(join(baseline.migrationsDir, EXT_SPACE_ID), {
        dirName: '20260201T0000_add_note',
        metadata: { ...baseMeta, migrationHash: computeMigrationHash(baseMeta, ops) },
        ops,
      });
    }

    const updateResult = await executeDbUpdate({
      answerQuestions: async (questions) =>
        questions.map((question) => ({
          verb: question.verbs.includes('allow') ? ('allow' as const) : ('delete' as const),
          text: question.subject,
        })),
      driver: testDb!.driver,
      adapter: controlAdapter,
      familyInstance,
      contract: appContract,
      mode: 'apply',
      migrations: sqliteTargetDescriptor.migrations,
      frameworkComponents: [...frameworkComponents],
      migrationsDir: baseline.migrationsDir,
      targetId: 'sqlite',
      extensions: [
        buildExtensionPack({
          contractJson: extContractV2,
          headHash: extContractV2.storage.storageHash,
        }),
      ],
      acceptDataLoss: true,
    });
    if (!updateResult.ok) {
      throw new Error(
        `Expected update ok but got failure: ${JSON.stringify(updateResult.failure, null, 2)}`,
      );
    }
    expect(updateResult.ok).toBe(true);

    const markers = await testDb!.driver.query<{ space: string; core_hash: string }>(
      'SELECT space, core_hash FROM _prisma_marker ORDER BY space',
    );
    expect(markers.rows.find((r) => r.space === 'app')!.core_hash).toBe(
      appContract.storage.storageHash,
    );
    expect(markers.rows.find((r) => r.space === EXT_SPACE_ID)!.core_hash).toBe(
      extContractV2.storage.storageHash,
    );

    const helperTables = await testDb!.driver.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='_ext_helper'",
    );
    const helperCols = await testDb!.driver.query<{ name: string }>(
      'PRAGMA table_info(_ext_helper)',
    );
    expect(helperTables.rows.length).toBe(1);
    expect(helperCols.rows.map((c) => c.name).sort()).toEqual(['id', 'note']);
  });

  it('fires the codec onFieldEvent hook on app-space field add through the aggregate pipeline (M2 R1 wiring still flows through the synth strategy)', async () => {
    const tmpDir = createTmpDir();
    const { migrationsDir } = await setupBaseline(tmpDir);

    const HOOKED_CODEC = 'cs/string@1';
    const hookFiredFor: string[] = [];
    const hooks: CodecControlHooks = {
      onFieldEvent: (event, ctx) => {
        hookFiredFor.push(`${event}:${ctx.tableName}.${ctx.fieldName}`);
        const op: SqlMigrationPlanOperation<unknown> = {
          id: `codec.${event}.${ctx.tableName}.${ctx.fieldName}`,
          label: `${event} hook on ${ctx.tableName}.${ctx.fieldName}`,
          operationClass: 'additive',
          invariantId: `cs:${ctx.tableName}.${ctx.fieldName}@${event}`,
          target: { id: 'sqlite' },
          precheck: [],
          execute: [
            {
              description: 'codec side-effect (no-op for test)',
              sql: 'SELECT 1',
            },
          ],
          postcheck: [],
        };
        const call: OpFactoryCall = {
          factoryName: op.id,
          operationClass: op.operationClass,
          label: op.label,
          renderTypeScript: () => `${op.id}()`,
          importRequirements: () => [],
          toOp: () => op,
        };
        return [call];
      },
    };

    const hookedAppContract: Contract<SqlStorage> = {
      ...appContract,
      storage: new SqlStorage({
        storageHash: coreHash('app-with-hooked-email'),
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                user: {
                  columns: {
                    id: {
                      dataType: 'sqlite/integer',
                      codecId: 'sqlite/integer@1',
                      nullable: false,
                    },
                    email: {
                      nativeType: 'text',
                      codecId: HOOKED_CODEC,
                      nullable: false,
                    },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [{ columns: ['email'] }],
                  indexes: [{ name: 'user_email_idx', columns: ['email'], unique: false }],
                  foreignKeys: [],
                },
              },
            },
          }),
        },
      }),
      profileHash: profileHash('app-with-hooked-email'),
    };

    const codecHookComponent: TargetBoundComponentDescriptor<'sql', 'sqlite'> = {
      kind: 'adapter',
      id: 'test-codec-hook',
      familyId: 'sql',
      targetId: 'sqlite',
      version: '0.0.0-test',
      types: {
        codecTypes: {
          codecDescriptors: [textCodecDescriptor(HOOKED_CODEC)],
          controlPlaneHooks: { [HOOKED_CODEC]: hooks },
        },
      },
    } as TargetBoundComponentDescriptor<'sql', 'sqlite'>;

    const result = await executeDbInit({
      driver: testDb!.driver,
      adapter: controlAdapter,
      familyInstance,
      contract: hookedAppContract,
      mode: 'apply',
      migrations: sqliteTargetDescriptor.migrations,
      frameworkComponents: [...frameworkComponents, codecHookComponent],
      migrationsDir,
      targetId: 'sqlite',
      extensions: [
        buildExtensionPack({
          contractJson: extContractV1,
          headHash: extContractV1.storage.storageHash,
        }),
      ],
    });

    if (!result.ok) {
      throw new Error(`Expected ok but got failure: ${JSON.stringify(result.failure, null, 2)}`);
    }
    expect(result.ok).toBe(true);

    expect(hookFiredFor).toContain('added:user.email');

    // The codec-emitted op was included in the aggregate operations
    // surfaced to the caller (proves the codec hook flows through
    // executeDbInit → planMigration (synth strategy) →
    // frameworkComponents).
    const ids = result.value.plan.operations.map((op) => op.id);
    expect(ids).toContain('codec.added.user.email');
  });

  it('collapses cleanly to a single app member when no extensions are declared (n=1 aggregate-path regression)', async () => {
    // Every other test in this file declares at least one extension
    // pack; this one exercises the empty-extensions path through
    // the aggregate loader / planner / runner so a future refactor
    // that breaks app-only SQLite does not slip past CI.
    const tmpDir = createTmpDir();
    const migrationsDir = join(tmpDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const initResult = await executeDbInit({
      driver: testDb!.driver,
      adapter: controlAdapter,
      familyInstance,
      contract: appContract,
      mode: 'apply',
      migrations: sqliteTargetDescriptor.migrations,
      frameworkComponents: [...frameworkComponents],
      migrationsDir,
      targetId: 'sqlite',
      extensions: [],
    });

    if (!initResult.ok) {
      throw new Error(
        `Expected ok but got failure: ${JSON.stringify(initResult.failure, null, 2)}`,
      );
    }

    const markers = await testDb!.driver.query<{ space: string; core_hash: string }>(
      'SELECT space, core_hash FROM _prisma_marker ORDER BY space',
    );
    expect(markers.rows.map((r) => r.space)).toEqual(['app']);
    expect(markers.rows[0]!.core_hash).toBe(appContract.storage.storageHash);

    const userTable = await testDb!.driver.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = 'user'",
    );
    expect(userTable.rows[0]!.cnt).toBe(1);

    // Per-space breakdown surfaced to the caller has exactly one
    // entry, kind `app`, no extension entries.
    expect(initResult.value.perSpace).toBeDefined();
    expect(initResult.value.perSpace!.length).toBe(1);
    expect(initResult.value.perSpace![0]).toMatchObject({ spaceId: 'app', kind: 'app' });

    // Re-running `db update` against the already-applied contract is
    // a no-op — proves the aggregate path's marker / hash check still
    // short-circuits when n=1.
    const updateResult = await executeDbUpdate({
      answerQuestions: async (questions) =>
        questions.map((question) => ({
          verb: question.verbs.includes('allow') ? ('allow' as const) : ('delete' as const),
          text: question.subject,
        })),
      driver: testDb!.driver,
      adapter: controlAdapter,
      familyInstance,
      contract: appContract,
      mode: 'apply',
      migrations: sqliteTargetDescriptor.migrations,
      frameworkComponents: [...frameworkComponents],
      migrationsDir,
      targetId: 'sqlite',
      extensions: [],
    });

    if (!updateResult.ok) {
      throw new Error(
        `Expected ok but got failure: ${JSON.stringify(updateResult.failure, null, 2)}`,
      );
    }
    expect(updateResult.value.execution).toBeDefined();
    expect(updateResult.value.execution!.operationsExecuted).toBe(0);

    const markersAfter = await testDb!.driver.query<{ space: string }>(
      'SELECT space FROM _prisma_marker ORDER BY space',
    );
    expect(markersAfter.rows.map((r) => r.space)).toEqual(['app']);
  });

  it('rolls back ALL spaces and preserves pre-execution markers when any space fails (locks AM4-rollback CLI half)', async () => {
    const tmpDir = createTmpDir();
    const baseline = await setupBaseline(tmpDir);

    const initResult = await executeDbInit({
      driver: testDb!.driver,
      adapter: controlAdapter,
      familyInstance,
      contract: appContract,
      mode: 'apply',
      migrations: sqliteTargetDescriptor.migrations,
      frameworkComponents: [...frameworkComponents],
      migrationsDir: baseline.migrationsDir,
      targetId: 'sqlite',
      extensions: [
        buildExtensionPack({
          contractJson: extContractV1,
          headHash: extContractV1.storage.storageHash,
        }),
      ],
    });
    expect(initResult.ok).toBe(true);

    const markersBefore = await testDb!.driver.query<{ space: string; core_hash: string }>(
      'SELECT space, core_hash FROM _prisma_marker ORDER BY space',
    );
    const appHashBefore = markersBefore.rows.find((r) => r.space === 'app')!.core_hash;
    const extHashBefore = markersBefore.rows.find((r) => r.space === EXT_SPACE_ID)!.core_hash;

    // Bump extension to v2 with a *failing* op.
    await emitContractSpaceArtifacts(baseline.migrationsDir, EXT_SPACE_ID, {
      contract: extContractV2,
      contractDts: '// placeholder\nexport {};\n',
      headRef: { hash: extContractV2.storage.storageHash, invariants: [] },
    });
    {
      const baseMeta = {
        from: extContractV1.storage.storageHash,
        to: extContractV2.storage.storageHash,
        providedInvariants: [],
        createdAt: '2026-02-01T00:00:00.000Z',
      };
      const ops = [...buildFailingOps()];
      await materialiseMigrationPackage(join(baseline.migrationsDir, EXT_SPACE_ID), {
        dirName: '20260201T0000_failing',
        metadata: { ...baseMeta, migrationHash: computeMigrationHash(baseMeta, ops) },
        ops,
      });
    }

    const updateResult = await executeDbUpdate({
      answerQuestions: async (questions) =>
        questions.map((question) => ({
          verb: question.verbs.includes('allow') ? ('allow' as const) : ('delete' as const),
          text: question.subject,
        })),
      driver: testDb!.driver,
      adapter: controlAdapter,
      familyInstance,
      contract: appContract,
      mode: 'apply',
      migrations: sqliteTargetDescriptor.migrations,
      frameworkComponents: [...frameworkComponents],
      migrationsDir: baseline.migrationsDir,
      targetId: 'sqlite',
      extensions: [
        buildExtensionPack({
          contractJson: extContractV2,
          headHash: extContractV2.storage.storageHash,
        }),
      ],
      acceptDataLoss: true,
    });

    expect(updateResult.ok).toBe(false);
    if (updateResult.ok) throw new Error('expected failure');
    expect(updateResult.failure.code).toBe('RUNNER_FAILED');
    expect(updateResult.failure.meta).toMatchObject({ failingSpace: EXT_SPACE_ID });

    const markersAfter = await testDb!.driver.query<{ space: string; core_hash: string }>(
      'SELECT space, core_hash FROM _prisma_marker ORDER BY space',
    );
    expect(markersAfter.rows.find((r) => r.space === 'app')!.core_hash).toBe(appHashBefore);
    expect(markersAfter.rows.find((r) => r.space === EXT_SPACE_ID)!.core_hash).toBe(extHashBefore);
  });
});
