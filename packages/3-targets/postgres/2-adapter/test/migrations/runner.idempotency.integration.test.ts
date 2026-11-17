import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  contract,
  controlAdapter,
  createDriver,
  createMigrationPlan,
  createTestDatabase,
  emptySchema,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

describe('PostgresMigrationRunner - Idempotency', { concurrent: false }, () => {
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

  describe('when the operation postcheck is already satisfied before execution (idempotency)', () => {
    it('skips executing the operation and still writes marker and ledger', {
      timeout: testTimeout,
    }, async () => {
      await driver!.query(
        'create table "user" (id uuid primary key, email text not null, constraint "user_email_unique" unique (email))',
      );
      await driver!.query('create index "user_email_idx" on "user"(email)');

      const runner = postgresTargetDescriptor.createRunner(familyInstance);
      const planWithPreSatisfiedPostcheck = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
        spaceId: APP_SPACE_ID,
        origin: null,
        destination: toPlanContractInfo(contract),
        operations: [
          {
            id: 'table.user',
            label: 'Create user table',
            summary: 'Skipped because postcheck is already satisfied',
            operationClass: 'additive',
            target: {
              id: 'postgres',
              details: {
                schema: 'public',
                objectType: 'table',
                name: 'user',
              },
            },
            precheck: [
              {
                description: 'would fail if evaluated',
                sql: 'select false',
              },
            ],
            execute: [
              {
                description: 'would fail if executed',
                sql: 'select 1/0',
              },
            ],
            postcheck: [
              {
                description: 'user table exists',
                sql: `select to_regclass('public."user"') is not null`,
              },
            ],
          },
        ],
        providedInvariants: [],
      });

      const postcheckPreSatisfiedResult = await runner.execute({
        driver: driver!,
        perSpaceOptions: [
          {
            space: planWithPreSatisfiedPostcheck.spaceId ?? APP_SPACE_ID,
            plan: planWithPreSatisfiedPostcheck,
            migrationEdges: synthEdges(planWithPreSatisfiedPostcheck),
            driver: driver!,
            destinationContract: contract,
            policy: INIT_ADDITIVE_POLICY,
            frameworkComponents,
          },
        ],
      });
      expect(postcheckPreSatisfiedResult.ok).toBe(true);
      if (postcheckPreSatisfiedResult.ok) {
        expect(postcheckPreSatisfiedResult.value.perSpaceResults[0]?.value).toMatchObject({
          operationsPlanned: 1,
          operationsExecuted: 0,
        });
      }

      const markerCount = await driver!.query<{ count: string }>(
        'select count(*)::text as count from prisma_contract.marker where space = $1',
        ['app'],
      );
      expect(markerCount.rows[0]?.count).toBe('1');

      const ledgerRow = await driver!.query<{ operations: unknown }>(
        'select operations from prisma_contract.ledger order by id desc limit 1',
      );
      expect(ledgerRow.rows[0]?.operations).toMatchObject([{ id: 'table.user', execute: [] }]);
    });

    it('isolates skip record from mutable operation references', {
      timeout: testTimeout,
    }, async () => {
      await driver!.query(
        'create table "user" (id uuid primary key, email text not null, constraint "user_email_unique" unique (email))',
      );
      await driver!.query('create index "user_email_idx" on "user"(email)');

      const runner = postgresTargetDescriptor.createRunner(familyInstance);

      // Create mutable meta object with nested structure
      const mutableMeta = {
        customField: 'original-value',
        nested: {
          data: 'nested-data',
        },
      };

      const mutableOperation = {
        id: 'table.user',
        label: 'Create user table',
        summary: 'Skipped because postcheck is already satisfied',
        operationClass: 'additive' as const,
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table' as const,
            name: 'user',
          },
        },
        precheck: [
          {
            description: 'would fail if evaluated',
            sql: 'select false',
          },
        ],
        execute: [
          {
            description: 'would fail if executed',
            sql: 'select 1/0',
          },
        ],
        postcheck: [
          {
            description: 'user table exists',
            sql: `select to_regclass('public."user"') is not null`,
          },
        ],
        meta: mutableMeta,
      };

      const planWithPreSatisfiedPostcheck = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
        spaceId: APP_SPACE_ID,
        origin: null,
        destination: toPlanContractInfo(contract),
        operations: [mutableOperation],
        providedInvariants: [],
      });

      const postcheckPreSatisfiedResult = await runner.execute({
        driver: driver!,
        perSpaceOptions: [
          {
            space: planWithPreSatisfiedPostcheck.spaceId ?? APP_SPACE_ID,
            plan: planWithPreSatisfiedPostcheck,
            migrationEdges: synthEdges(planWithPreSatisfiedPostcheck),
            driver: driver!,
            destinationContract: contract,
            policy: INIT_ADDITIVE_POLICY,
            frameworkComponents,
          },
        ],
      });
      expect(postcheckPreSatisfiedResult.ok).toBe(true);

      // Mutate the original operation and meta after execution
      mutableMeta.customField = 'mutated-value';
      mutableMeta.nested.data = 'mutated-nested-data';
      mutableOperation.id = 'mutated-id';
      mutableOperation.label = 'mutated-label';

      // Query ledger and verify stored operations JSON did not change
      const ledgerRow = await driver!.query<{ operations: unknown }>(
        'select operations from prisma_contract.ledger order by id desc limit 1',
      );
      const storedOperations = ledgerRow.rows[0]?.operations as Array<{
        id: string;
        label: string;
        meta?: {
          customField?: string;
          nested?: { data?: string };
          runner?: { skipped?: boolean; reason?: string };
        };
        execute: unknown[];
      }>;

      expect(storedOperations).toHaveLength(1);
      expect(storedOperations[0]).toMatchObject({
        id: 'table.user',
        label: 'Create user table',
        execute: [],
        meta: {
          customField: 'original-value',
          nested: {
            data: 'nested-data',
          },
          runner: {
            skipped: true,
            reason: 'postcheck_pre_satisfied',
          },
        },
      });
    });
  });

  describe('when origin === destination (self-edge plan)', () => {
    it('on a true no-op self-edge (no ops executed, no new invariants), skips both marker and ledger writes', {
      timeout: testTimeout,
    }, async () => {
      const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
      const runner = postgresTargetDescriptor.createRunner(familyInstance);
      const initialPlan = planner.plan({
        contract,
        schema: emptySchema,
        policy: INIT_ADDITIVE_POLICY,
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents,
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: '../../snapshots',
      });
      if (initialPlan.kind !== 'success') {
        throw new Error('expected initial planner success');
      }
      await runner.execute({
        driver: driver!,
        perSpaceOptions: [
          {
            space: initialPlan.plan.spaceId ?? APP_SPACE_ID,
            plan: initialPlan.plan,
            migrationEdges: synthEdges(initialPlan.plan),
            driver: driver!,
            destinationContract: contract,
            policy: INIT_ADDITIVE_POLICY,
            frameworkComponents,
          },
        ],
      });

      // Snapshot ledger count after the init apply.
      const initialLedgerCount = await driver!.query<{ count: string }>(
        'select count(*)::text as count from prisma_contract.ledger',
      );
      const initialUpdatedAt = await driver!.query<{ updated_at: Date }>(
        `select updated_at from prisma_contract.marker where space = 'app'`,
      );

      // Self-edge plan with no operations and no new invariants. This is a
      // true no-op: nothing should be written.
      const noOpSelfEdgePlan = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
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
            space: noOpSelfEdgePlan.spaceId ?? APP_SPACE_ID,
            plan: noOpSelfEdgePlan,
            migrationEdges: synthEdges(noOpSelfEdgePlan),
            driver: driver!,
            destinationContract: contract,
            policy: INIT_ADDITIVE_POLICY,
            frameworkComponents,
          },
        ],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.perSpaceResults[0]?.value).toMatchObject({
          operationsPlanned: 0,
          operationsExecuted: 0,
        });
      }

      // Ledger count unchanged: no spurious entry for the no-op self-edge.
      const ledgerCountAfter = await driver!.query<{ count: string }>(
        'select count(*)::text as count from prisma_contract.ledger',
      );
      expect(ledgerCountAfter.rows[0]?.count).toBe(initialLedgerCount.rows[0]?.count);

      // Marker updated_at unchanged: no churn from the no-op.
      const updatedAtAfter = await driver!.query<{ updated_at: Date }>(
        `select updated_at from prisma_contract.marker where space = 'app'`,
      );
      expect(updatedAtAfter.rows[0]?.updated_at?.toISOString()).toBe(
        initialUpdatedAt.rows[0]?.updated_at?.toISOString(),
      );
    });

    it('runs operations instead of skipping them — the marker matching destination is not a skip signal for self-edges', {
      timeout: testTimeout,
    }, async () => {
      // Apply the schema first so the marker sits at the contract hash.
      const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
      const runner = postgresTargetDescriptor.createRunner(familyInstance);
      const initialPlan = planner.plan({
        contract,
        schema: emptySchema,
        policy: INIT_ADDITIVE_POLICY,
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents,
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: '../../snapshots',
      });
      if (initialPlan.kind !== 'success') {
        throw new Error('expected initial planner success');
      }
      await runner.execute({
        driver: driver!,
        perSpaceOptions: [
          {
            space: initialPlan.plan.spaceId ?? APP_SPACE_ID,
            plan: initialPlan.plan,
            migrationEdges: synthEdges(initialPlan.plan),
            driver: driver!,
            destinationContract: contract,
            policy: INIT_ADDITIVE_POLICY,
            frameworkComponents,
          },
        ],
      });

      // Self-edge plan: origin === destination, single op with a side-effect
      // (insert a row). If the runner skipped this op the way it used to
      // when marker matched destination, the row would be absent.
      await driver!.query('create table "self_edge_proof" (val int not null primary key)');

      const selfEdgePlan = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
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
              id: 'postgres',
              details: {
                schema: 'public',
                objectType: 'table',
                name: 'self_edge_proof',
              },
            },
            precheck: [],
            execute: [
              {
                description: 'insert proof',
                sql: 'insert into "self_edge_proof" (val) values (42)',
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
            driver: driver!,
            destinationContract: contract,
            policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
            frameworkComponents,
            // Side-effect uses a synthetic table outside the contract; relax
            // schema verification so the post-execute drift check doesn't fail.
            strictVerification: false,
          },
        ],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.perSpaceResults[0]?.value).toMatchObject({
          operationsPlanned: 1,
          operationsExecuted: 1,
        });
      }

      // Side-effect proof: the op actually executed against the DB.
      const proof = await driver!.query<{ val: number }>('select val from "self_edge_proof"');
      expect(proof.rows).toEqual([{ val: 42 }]);
    });
  });
});
