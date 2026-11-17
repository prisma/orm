import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { SqlitePlanTargetDetails } from '@internal/target-sqlite/planner-target-details';
import { timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import {
  contract,
  createMigrationPlan,
  createTestDatabase,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  sqliteTargetDescriptor,
  synthEdges,
  type TestDatabase,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

describe('SqliteMigrationRunner - Idempotency', { timeout: timeouts.databaseOperation }, () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  it('skips operation when postcheck is already satisfied before execution', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;

    // Create the table manually so the postcheck is pre-satisfied
    driver.db.exec(
      'CREATE TABLE "user" (id INTEGER PRIMARY KEY, email TEXT NOT NULL, UNIQUE (email))',
    );
    driver.db.exec('CREATE INDEX "user_email_idx" ON "user"(email)');

    const runner = sqliteTargetDescriptor.createRunner(familyInstance);
    const plan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [
        {
          id: 'table.user',
          label: 'Create user table',
          summary: 'Skipped because postcheck is already satisfied',
          operationClass: 'additive',
          target: { id: 'sqlite', details: { objectType: 'table', name: 'user' } },
          precheck: [
            {
              description: 'would fail if evaluated',
              sql: "SELECT raise(FAIL, 'must not run precheck')",
            },
          ],
          execute: [
            {
              description: 'would fail if executed',
              sql: "SELECT raise(FAIL, 'must not run execute')",
            },
          ],
          postcheck: [
            {
              description: 'user table exists',
              sql: "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = 'user'",
            },
          ],
        },
      ],
      providedInvariants: [],
    });

    const result = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan,
          migrationEdges: synthEdges(plan),
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
        },
      ],
    });
    if (!result.ok) throw new Error(formatRunnerFailure(result.failure));
    expect(result.value.perSpaceResults[0]?.value).toMatchObject({
      operationsPlanned: 1,
      operationsExecuted: 0,
    });

    const markerCount = await driver.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM _prisma_marker WHERE space = ?',
      ['app'],
    );
    expect(markerCount.rows[0]!.cnt).toBe(1);

    const ledgerRow = await driver.query<{ operations: string }>(
      'SELECT operations FROM _prisma_ledger ORDER BY id DESC LIMIT 1',
    );
    const storedOps = JSON.parse(ledgerRow.rows[0]!.operations) as Array<{
      id: string;
      execute: unknown[];
    }>;
    expect(storedOps).toHaveLength(1);
    expect(storedOps[0]).toMatchObject({ id: 'table.user', execute: [] });
  });

  it('on a true no-op self-edge (no ops executed, no new invariants), skips both marker and ledger writes', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;

    // Bring marker to contract hash via a synthetic empty initial apply.
    driver.db.exec(
      'CREATE TABLE "user" (id INTEGER PRIMARY KEY, email TEXT NOT NULL, UNIQUE (email))',
    );
    driver.db.exec('CREATE INDEX "user_email_idx" ON "user"(email)');
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);
    const initPlan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [],
      providedInvariants: [],
    });
    const initResult = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: initPlan.spaceId ?? APP_SPACE_ID,
          plan: initPlan,
          migrationEdges: synthEdges(initPlan),
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
        },
      ],
    });
    if (!initResult.ok) throw new Error(formatRunnerFailure(initResult.failure));

    const initialLedger = await driver.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM _prisma_ledger',
    );
    const initialUpdatedAt = await driver.query<{ updated_at: string }>(
      'SELECT updated_at FROM _prisma_marker WHERE space = ?',
      ['app'],
    );

    // True no-op self-edge: origin === destination, no ops, no invariants.
    const noOpPlan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: toPlanContractInfo(contract),
      destination: toPlanContractInfo(contract),
      operations: [],
      providedInvariants: [],
    });
    const result = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: noOpPlan.spaceId ?? APP_SPACE_ID,
          plan: noOpPlan,
          migrationEdges: synthEdges(noOpPlan),
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
        },
      ],
    });
    if (!result.ok) throw new Error(formatRunnerFailure(result.failure));
    expect(result.value.perSpaceResults[0]?.value).toMatchObject({
      operationsPlanned: 0,
      operationsExecuted: 0,
    });

    const ledgerAfter = await driver.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM _prisma_ledger',
    );
    expect(ledgerAfter.rows[0]!.cnt).toBe(initialLedger.rows[0]!.cnt);

    const updatedAtAfter = await driver.query<{ updated_at: string }>(
      'SELECT updated_at FROM _prisma_marker WHERE space = ?',
      ['app'],
    );
    expect(updatedAtAfter.rows[0]!.updated_at).toBe(initialUpdatedAt.rows[0]!.updated_at);
  });

  it('runs operations on a self-edge plan (origin === destination) — marker matching destination is not a skip signal', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;

    // Apply the schema first so the marker is at the contract hash.
    driver.db.exec(
      'CREATE TABLE "user" (id INTEGER PRIMARY KEY, email TEXT NOT NULL, UNIQUE (email))',
    );
    driver.db.exec('CREATE INDEX "user_email_idx" ON "user"(email)');
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const initPlan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [],
      providedInvariants: [],
    });
    const initResult = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: initPlan.spaceId ?? APP_SPACE_ID,
          plan: initPlan,
          migrationEdges: synthEdges(initPlan),
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
        },
      ],
    });
    if (!initResult.ok) throw new Error(formatRunnerFailure(initResult.failure));

    // Side-effect proof outside the contract.
    driver.db.exec('CREATE TABLE "self_edge_proof" (val INTEGER PRIMARY KEY)');

    const selfEdgePlan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: toPlanContractInfo(contract),
      destination: toPlanContractInfo(contract),
      operations: [
        {
          id: 'self_edge.insert_proof',
          label: 'Insert proof row',
          summary: 'Must execute on a self-edge plan',
          operationClass: 'data',
          target: {
            id: 'sqlite',
            details: { objectType: 'table', name: 'self_edge_proof' },
          },
          precheck: [],
          execute: [
            {
              description: 'insert proof',
              sql: 'INSERT INTO "self_edge_proof" (val) VALUES (42)',
            },
          ],
          postcheck: [],
        },
      ],
      providedInvariants: [],
    });

    const result = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: selfEdgePlan.spaceId ?? APP_SPACE_ID,
          plan: selfEdgePlan,
          migrationEdges: synthEdges(selfEdgePlan),
          driver,
          destinationContract: contract,
          policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
          frameworkComponents,
          strictVerification: false,
        },
      ],
    });
    if (!result.ok) throw new Error(formatRunnerFailure(result.failure));
    expect(result.value.perSpaceResults[0]?.value).toMatchObject({
      operationsPlanned: 1,
      operationsExecuted: 1,
    });

    const proof = await driver.query<{ val: number }>('SELECT val FROM "self_edge_proof"');
    expect(proof.rows).toEqual([{ val: 42 }]);
  });
});
