import type { LedgerEntryRecord } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import {
  type AggregateMigrationEdgeRef,
  buildFabricatedMigrationEdge,
} from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteControlAdapter } from '../../src/core/control-adapter';
import {
  contract,
  controlAdapter,
  createLedgerTestPlan,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  LEDGER_TEST_SPACE_ID,
  sqliteTargetDescriptor,
  type TestDatabase,
} from './fixtures/runner-fixtures';

interface LedgerRow {
  readonly space: string;
  readonly migration_name: string;
  readonly migration_hash: string;
  readonly origin_core_hash: string | null;
  readonly destination_core_hash: string;
  readonly contract_json_before: string | null;
  readonly contract_json_after: string | null;
  readonly operations: string;
  readonly created_at: string;
}

const ledgerAdapter = new SqliteControlAdapter(createSqliteBuiltinCodecLookup());

type ExpectedLedgerEntry = Omit<LedgerEntryRecord, 'appliedAt'>;

function expectReadLedger(
  entries: readonly LedgerEntryRecord[],
  expected: readonly ExpectedLedgerEntry[],
): void {
  expect(entries).toHaveLength(expected.length);
  for (const entry of entries) {
    expect(entry.appliedAt).toBeInstanceOf(Date);
  }
  expect(entries.map(({ appliedAt: _appliedAt, ...rest }) => rest)).toEqual(expected);
}

async function readLedgerRows(driver: TestDatabase['driver']): Promise<LedgerRow[]> {
  return (
    await driver.query<LedgerRow>(
      `SELECT space, migration_name, migration_hash, origin_core_hash, destination_core_hash,
        contract_json_before, contract_json_after, operations, created_at
       FROM _prisma_ledger ORDER BY id`,
    )
  ).rows;
}

function parseNullableJsonColumn(value: string | null): unknown {
  if (value === null) {
    return null;
  }
  return JSON.parse(value) as unknown;
}

describe('SqliteMigrationRunner - per-edge ledger', { timeout: timeouts.databaseOperation }, () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  it('readLedger returns an empty array when the ledger table does not exist', async () => {
    testDb = createTestDatabase();
    const ledger = await ledgerAdapter.readLedger(testDb.driver, LEDGER_TEST_SPACE_ID);
    expect(ledger).toEqual([]);
  });

  it('writes one ledger row for a single-edge apply with space, name, hash, from/to, and that edge ops', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);
    const destHash = contract.storage.storageHash;
    const edges: readonly AggregateMigrationEdgeRef[] = [
      {
        migrationHash: 'mig-single',
        dirName: '001_single',
        from: EMPTY_CONTRACT_HASH,
        to: destHash,
        operationCount: 1,
      },
    ];
    const plan = createLedgerTestPlan({
      destinationHash: destHash,
      operations: [
        {
          id: 'edge.single.op',
          label: 'single edge op',
          operationClass: 'additive',
          target: {
            id: 'sqlite',
            details: { schema: 'main', objectType: 'table', name: 'user' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT 1' }],
        },
      ],
      migrationEdges: edges,
    });

    const result = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan,
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
          migrationEdges: edges,
        },
      ],
    });
    if (!result.ok) throw new Error(formatRunnerFailure(result.failure));

    const rows = await readLedgerRows(driver);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      space: LEDGER_TEST_SPACE_ID,
      migration_name: '001_single',
      migration_hash: 'mig-single',
      origin_core_hash: EMPTY_CONTRACT_HASH,
      destination_core_hash: destHash,
    });
    const ops = JSON.parse(rows[0]!.operations) as Array<{ id: string }>;
    expect(ops).toHaveLength(1);
    expect(ops[0]?.id).toBe('edge.single.op');
    expect(parseNullableJsonColumn(rows[0]!.contract_json_before)).toBeNull();
    expect(parseNullableJsonColumn(rows[0]!.contract_json_after)).toBeNull();

    const ledger = await ledgerAdapter.readLedger(driver, LEDGER_TEST_SPACE_ID);
    expectReadLedger(ledger, [
      {
        space: LEDGER_TEST_SPACE_ID,
        migrationName: '001_single',
        migrationHash: 'mig-single',
        from: null,
        to: destHash,
        operationCount: 1,
      },
    ]);
    const storedCreatedAt = rows[0]!.created_at;
    expect(storedCreatedAt.endsWith('Z')).toBe(true);
    expect(ledger[0]!.appliedAt.getTime()).toBe(Date.parse(storedCreatedAt));
  });

  it('throws when migrationEdges operationCount sum does not match plan.operations length', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);
    const destHash = contract.storage.storageHash;
    const edges: readonly AggregateMigrationEdgeRef[] = [
      {
        migrationHash: 'mig-single',
        dirName: '001_single',
        from: EMPTY_CONTRACT_HASH,
        to: destHash,
        operationCount: 2,
      },
    ];
    const plan = createLedgerTestPlan({
      destinationHash: destHash,
      operations: [
        {
          id: 'edge.single.op',
          label: 'single edge op',
          operationClass: 'additive',
          target: {
            id: 'sqlite',
            details: { schema: 'main', objectType: 'table', name: 'user' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT 1' }],
        },
      ],
      migrationEdges: edges,
    });

    await expect(
      runner.execute({
        driver,
        perSpaceOptions: [
          {
            space: LEDGER_TEST_SPACE_ID,
            plan,
            driver,
            destinationContract: contract,
            policy: INIT_ADDITIVE_POLICY,
            frameworkComponents,
            strictVerification: false,
            migrationEdges: edges,
          },
        ],
      }),
    ).rejects.toThrow(/does not match sum of migrationEdges operationCount/);
  });

  it('writes N ledger rows in walk order for multi-edge apply with ops and contract_json on endpoints only', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);
    const hashA = 'ledger-mid-a';
    const hashB = 'ledger-mid-b';
    const destHash = contract.storage.storageHash;
    const edges: readonly AggregateMigrationEdgeRef[] = [
      {
        migrationHash: 'mig-a',
        dirName: '001_a',
        from: EMPTY_CONTRACT_HASH,
        to: hashA,
        operationCount: 1,
      },
      {
        migrationHash: 'mig-b',
        dirName: '002_b',
        from: hashA,
        to: hashB,
        operationCount: 2,
      },
      {
        migrationHash: 'mig-c',
        dirName: '003_c',
        from: hashB,
        to: destHash,
        operationCount: 1,
      },
    ];
    const plan = createLedgerTestPlan({
      destinationHash: destHash,
      operations: [
        {
          id: 'edge.a',
          label: 'a',
          operationClass: 'additive',
          target: {
            id: 'sqlite',
            details: { schema: 'main', objectType: 'table', name: 'a' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT 1' }],
        },
        {
          id: 'edge.b1',
          label: 'b1',
          operationClass: 'additive',
          target: {
            id: 'sqlite',
            details: { schema: 'main', objectType: 'table', name: 'b1' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT 1' }],
        },
        {
          id: 'edge.b2',
          label: 'b2',
          operationClass: 'additive',
          target: {
            id: 'sqlite',
            details: { schema: 'main', objectType: 'table', name: 'b2' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT 1' }],
        },
        {
          id: 'edge.c',
          label: 'c',
          operationClass: 'additive',
          target: {
            id: 'sqlite',
            details: { schema: 'main', objectType: 'table', name: 'c' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT 1' }],
        },
      ],
      migrationEdges: edges,
    });

    const result = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan,
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
          migrationEdges: edges,
        },
      ],
    });
    if (!result.ok) throw new Error(formatRunnerFailure(result.failure));

    const rows = await readLedgerRows(driver);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.migration_name)).toEqual(['001_a', '002_b', '003_c']);
    expect(rows.map((r) => r.space)).toEqual([
      LEDGER_TEST_SPACE_ID,
      LEDGER_TEST_SPACE_ID,
      LEDGER_TEST_SPACE_ID,
    ]);
    expect(rows[0]).toMatchObject({
      origin_core_hash: EMPTY_CONTRACT_HASH,
      destination_core_hash: hashA,
    });
    expect(rows[1]).toMatchObject({
      origin_core_hash: hashA,
      destination_core_hash: hashB,
    });
    expect(rows[2]).toMatchObject({
      origin_core_hash: hashB,
      destination_core_hash: destHash,
    });

    const opCounts = rows.map((r) => (JSON.parse(r.operations) as unknown[]).length);
    expect(opCounts).toEqual([1, 2, 1]);
    const opIds = rows.flatMap((r) =>
      (JSON.parse(r.operations) as Array<{ id: string }>).map((o) => o.id),
    );
    expect(opIds).toEqual(['edge.a', 'edge.b1', 'edge.b2', 'edge.c']);

    expect(parseNullableJsonColumn(rows[0]!.contract_json_before)).toBeNull();
    expect(parseNullableJsonColumn(rows[0]!.contract_json_after)).toBeNull();
    expect(parseNullableJsonColumn(rows[1]!.contract_json_before)).toBeNull();
    expect(parseNullableJsonColumn(rows[1]!.contract_json_after)).toBeNull();
    expect(parseNullableJsonColumn(rows[2]!.contract_json_before)).toBeNull();
    expect(parseNullableJsonColumn(rows[2]!.contract_json_after)).toBeNull();

    const ledger = await ledgerAdapter.readLedger(driver, LEDGER_TEST_SPACE_ID);
    expectReadLedger(ledger, [
      {
        space: LEDGER_TEST_SPACE_ID,
        migrationName: '001_a',
        migrationHash: 'mig-a',
        from: null,
        to: hashA,
        operationCount: 1,
      },
      {
        space: LEDGER_TEST_SPACE_ID,
        migrationName: '002_b',
        migrationHash: 'mig-b',
        from: hashA,
        to: hashB,
        operationCount: 2,
      },
      {
        space: LEDGER_TEST_SPACE_ID,
        migrationName: '003_c',
        migrationHash: 'mig-c',
        from: hashB,
        to: destHash,
        operationCount: 1,
      },
    ]);
  });

  it('writes one synthesised ledger row with space for synth apply with a single synth edge', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const planner = sqliteTargetDescriptor.createPlanner(controlAdapter);
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (result.kind !== 'success') throw new Error('expected planner success');

    const synthEdges = [
      buildFabricatedMigrationEdge({
        currentMarkerStorageHash: null,
        destinationStorageHash: contract.storage.storageHash,
        operationCount: result.plan.operations.length,
      }),
    ];

    const executeResult = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          plan: result.plan,
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
          migrationEdges: synthEdges,
        },
      ],
    });
    if (!executeResult.ok) throw new Error(formatRunnerFailure(executeResult.failure));

    const rows = await readLedgerRows(driver);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      space: APP_SPACE_ID,
      migration_name: '',
      migration_hash: contract.storage.storageHash,
      destination_core_hash: contract.storage.storageHash,
    });

    const ledger = await ledgerAdapter.readLedger(driver, APP_SPACE_ID);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      space: APP_SPACE_ID,
      migrationName: '',
      migrationHash: contract.storage.storageHash,
      from: null,
      to: contract.storage.storageHash,
    });
    const storedSynthOps = JSON.parse(rows[0]!.operations) as unknown[];
    expect(ledger[0]!.operationCount).toBe(storedSynthOps.length);
  });

  it('returns rows for every space when space is omitted', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);
    const destHash = contract.storage.storageHash;
    const edges: readonly AggregateMigrationEdgeRef[] = [
      {
        migrationHash: 'mig-single',
        dirName: '001_single',
        from: EMPTY_CONTRACT_HASH,
        to: destHash,
        operationCount: 1,
      },
    ];
    const plan = createLedgerTestPlan({
      destinationHash: destHash,
      operations: [
        {
          id: 'edge.single.op',
          label: 'single edge op',
          operationClass: 'additive',
          target: {
            id: 'sqlite',
            details: { schema: 'main', objectType: 'table', name: 'user' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT 1' }],
        },
      ],
      migrationEdges: edges,
    });

    const result = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan,
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
          migrationEdges: edges,
        },
      ],
    });
    if (!result.ok) throw new Error(formatRunnerFailure(result.failure));

    await driver.query(
      `INSERT INTO _prisma_ledger (
         space, migration_name, migration_hash, origin_core_hash, destination_core_hash,
         contract_json_before, contract_json_after, operations, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'audit',
        '002_audit',
        'audit-mig',
        EMPTY_CONTRACT_HASH,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        null,
        '[]',
        new Date().toISOString(),
      ],
    );

    const all = await ledgerAdapter.readLedger(driver);
    expect(all).toHaveLength(2);
    expect(all.map((entry) => entry.space)).toEqual([LEDGER_TEST_SPACE_ID, 'audit']);
    expect(await ledgerAdapter.readLedger(driver, LEDGER_TEST_SPACE_ID)).toHaveLength(1);
  });
});
