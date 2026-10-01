import type { LedgerEntryRecord } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import {
  type AggregateMigrationEdgeRef,
  buildFabricatedMigrationEdge,
} from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../../src/core/control-adapter';
import {
  contract,
  controlAdapter,
  createDriver,
  createLedgerTestPlan,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  LEDGER_TEST_SPACE_ID,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

interface LedgerRow {
  readonly space: string;
  readonly migration_name: string;
  readonly migration_hash: string;
  readonly origin_core_hash: string | null;
  readonly destination_core_hash: string;
  readonly contract_json: unknown;
  readonly origin_contract_json: unknown;
  readonly operations: unknown;
}

const ledgerAdapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());

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

async function readLedgerRows(driver: PostgresControlDriver): Promise<LedgerRow[]> {
  const result = await driver.query<LedgerRow>(
    `select l.space, l.migration_name, l.migration_hash, l.origin_core_hash,
      l.destination_core_hash, l.operations,
      ca.contract_json, cb.contract_json as origin_contract_json
     from prisma_contract.ledger l
     left join prisma_contract.contract ca on ca.core_hash = l.destination_core_hash
     left join prisma_contract.contract cb on cb.core_hash = l.origin_core_hash
     order by l.id`,
  );
  return result.rows;
}

async function countContractRows(driver: PostgresControlDriver): Promise<number> {
  const result = await driver.query<{ n: string | number }>(
    'select count(*)::int as n from prisma_contract.contract',
  );
  return Number(result.rows[0]?.n ?? 0);
}

describe('PostgresMigrationRunner - per-edge ledger', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  it('readLedger returns an empty array when the ledger table does not exist', {
    timeout: testTimeout,
  }, async () => {
    const freshDriver = await createDriver(database.connectionString);
    const ledger = await ledgerAdapter.readLedger(freshDriver, LEDGER_TEST_SPACE_ID);
    expect(ledger).toEqual([]);
    await freshDriver.close();
  });

  it('writes one ledger row for a single-edge apply with space, name, hash, from/to, and that edge ops', {
    timeout: testTimeout,
  }, async () => {
    const runner = postgresTargetDescriptor.createRunner(familyInstance);
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
    const plan = createLedgerTestPlan<PostgresPlanTargetDetails>({
      destinationHash: destHash,
      operations: [
        {
          id: 'edge.single.op',
          label: 'single edge op',
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: 'public', objectType: 'table', name: 'user' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT TRUE' }],
        },
      ],
      migrationEdges: edges,
    });

    const result = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
          migrationEdges: edges,
        },
      ],
    });
    if (!result.ok) throw new Error(formatRunnerFailure(result.failure));

    const rows = await readLedgerRows(driver!);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      space: LEDGER_TEST_SPACE_ID,
      migration_name: '001_single',
      migration_hash: 'mig-single',
      origin_core_hash: EMPTY_CONTRACT_HASH,
      destination_core_hash: destHash,
    });
    const ops = rows[0]!.operations as Array<{ id: string }>;
    expect(ops).toHaveLength(1);
    expect(ops[0]?.id).toBe('edge.single.op');
    expect(rows[0]!.contract_json).toBeNull();
    expect(await countContractRows(driver!)).toBe(0);

    const ledger = await ledgerAdapter.readLedger(driver!, LEDGER_TEST_SPACE_ID);
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
  });

  it('persists each edge destination snapshot in the hash-keyed contract store', {
    timeout: testTimeout,
  }, async () => {
    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const midHash = 'snapshot-mid';
    const destHash = contract.storage.storageHash;
    const midContract = { models: ['user'] };
    const endContract = { models: ['user', 'post'] };
    const edges: readonly AggregateMigrationEdgeRef[] = [
      {
        migrationHash: 'mig-snap-a',
        dirName: '001_snap_a',
        from: EMPTY_CONTRACT_HASH,
        to: midHash,
        operationCount: 1,
        destinationContractJson: midContract,
      },
      {
        migrationHash: 'mig-snap-b',
        dirName: '002_snap_b',
        from: midHash,
        to: destHash,
        operationCount: 1,
        destinationContractJson: endContract,
      },
    ];
    const plan = createLedgerTestPlan<PostgresPlanTargetDetails>({
      destinationHash: destHash,
      operations: [
        {
          id: 'edge.snap.a',
          label: 'snapshot edge a',
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: 'public', objectType: 'table', name: 'user' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT TRUE' }],
        },
        {
          id: 'edge.snap.b',
          label: 'snapshot edge b',
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: 'public', objectType: 'table', name: 'post' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT TRUE' }],
        },
      ],
      migrationEdges: edges,
    });

    const result = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
          migrationEdges: edges,
        },
      ],
    });
    if (!result.ok) throw new Error(formatRunnerFailure(result.failure));

    const rows = await readLedgerRows(driver!);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.contract_json).toEqual(midContract);
    expect(rows[1]!.contract_json).toEqual(endContract);
    // The second edge's *before* state resolves directly through its
    // origin hash — no chain reconstruction; the baseline edge has none.
    expect(rows[0]!.origin_contract_json).toBeNull();
    expect(rows[1]!.origin_contract_json).toEqual(midContract);
    // Content-addressed store: one row per distinct contract, keyed by hash.
    expect(await countContractRows(driver!)).toBe(2);
    const stored = await driver!.query<{ core_hash: string }>(
      'select core_hash from prisma_contract.contract order by core_hash',
    );
    expect(stored.rows.map((row) => row.core_hash).sort()).toEqual([midHash, destHash].sort());
  });

  it('throws when migrationEdges operationCount sum does not match plan.operations length', {
    timeout: testTimeout,
  }, async () => {
    const runner = postgresTargetDescriptor.createRunner(familyInstance);
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
    const plan = createLedgerTestPlan<PostgresPlanTargetDetails>({
      destinationHash: destHash,
      operations: [
        {
          id: 'edge.single.op',
          label: 'single edge op',
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: 'public', objectType: 'table', name: 'user' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT TRUE' }],
        },
      ],
      migrationEdges: edges,
    });

    await expect(
      runner.execute({
        driver: driver!,
        perSpaceOptions: [
          {
            space: LEDGER_TEST_SPACE_ID,
            plan,
            driver: driver!,
            destinationContract: contract,
            policy: INIT_ADDITIVE_POLICY,
            frameworkComponents,
            strictVerification: false,
            migrationEdges: edges,
          },
        ],
      }),
    ).rejects.toThrow(/does not match sum of migrationEdges operationCount/);

    const ledger = await ledgerAdapter.readLedger(driver!, LEDGER_TEST_SPACE_ID);
    expect(ledger).toEqual([]);
  });

  it('writes N ledger rows in walk order for multi-edge apply with ops and no contract rows when edges carry no snapshots', {
    timeout: testTimeout,
  }, async () => {
    const runner = postgresTargetDescriptor.createRunner(familyInstance);
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
    const plan = createLedgerTestPlan<PostgresPlanTargetDetails>({
      destinationHash: destHash,
      operations: [
        {
          id: 'edge.a',
          label: 'a',
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: 'public', objectType: 'table', name: 'a' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT TRUE' }],
        },
        {
          id: 'edge.b1',
          label: 'b1',
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: 'public', objectType: 'table', name: 'b1' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT TRUE' }],
        },
        {
          id: 'edge.b2',
          label: 'b2',
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: 'public', objectType: 'table', name: 'b2' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT TRUE' }],
        },
        {
          id: 'edge.c',
          label: 'c',
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: 'public', objectType: 'table', name: 'c' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT TRUE' }],
        },
      ],
      migrationEdges: edges,
    });

    const result = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
          migrationEdges: edges,
        },
      ],
    });
    if (!result.ok) throw new Error(formatRunnerFailure(result.failure));

    const rows = await readLedgerRows(driver!);
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

    const opCounts = rows.map((r) => (r.operations as unknown[]).length);
    expect(opCounts).toEqual([1, 2, 1]);
    const opIds = rows.flatMap((r) => (r.operations as Array<{ id: string }>).map((o) => o.id));
    expect(opIds).toEqual(['edge.a', 'edge.b1', 'edge.b2', 'edge.c']);

    expect(rows.map((r) => r.contract_json)).toEqual([null, null, null]);
    expect(await countContractRows(driver!)).toBe(0);

    const ledger = await ledgerAdapter.readLedger(driver!, LEDGER_TEST_SPACE_ID);
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

  it('writes one synthesised ledger row with space for synth apply with a single synth edge', {
    timeout: testTimeout,
  }, async () => {
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);

    const planResult = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') throw new Error('expected planner success');

    const synthEdges = [
      buildFabricatedMigrationEdge({
        currentMarkerStorageHash: null,
        destinationStorageHash: contract.storage.storageHash,
        operationCount: planResult.plan.operations.length,
      }),
    ];

    const executeResult = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          plan: planResult.plan,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
          migrationEdges: synthEdges,
        },
      ],
    });
    if (!executeResult.ok) throw new Error(formatRunnerFailure(executeResult.failure));

    const rows = await readLedgerRows(driver!);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      space: APP_SPACE_ID,
      migration_name: '',
      migration_hash: contract.storage.storageHash,
      destination_core_hash: contract.storage.storageHash,
    });

    const ledger = await ledgerAdapter.readLedger(driver!, APP_SPACE_ID);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      space: APP_SPACE_ID,
      migrationName: '',
      migrationHash: contract.storage.storageHash,
      from: null,
      to: contract.storage.storageHash,
    });
    const storedSynthOps = rows[0]!.operations;
    expect(ledger[0]!.operationCount).toBe(
      Array.isArray(storedSynthOps) ? storedSynthOps.length : 0,
    );
  });
});
