import { INIT_ADDITIVE_POLICY, type SqlMigrationPlanOperation } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  contract,
  controlAdapter,
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
} from './fixtures/runner-fixtures';

describe('PostgresMigrationPlanner - integration (existing schemas)', { concurrent: false }, () => {
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

  it('returns an empty plan for superset schemas', { timeout: testTimeout }, async () => {
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
      throw new Error('expected initial plan success');
    }

    const executeResult = await runner.execute({
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
    if (!executeResult.ok) {
      throw new Error(`Runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    await driver!.query('create table "extra" (id uuid primary key)');
    const schema = await introspectSchema(driver!);

    const supersetResult = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    expect(supersetResult).toMatchObject({
      kind: 'success',
      plan: { operations: [] },
    });
  });

  it('plans additive fixes for subset schemas', { timeout: testTimeout }, async () => {
    // Create user table with just id - missing email column, unique, and index
    await driver!.query('create table "user" (id uuid primary key)');
    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);

    const subsetResult = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(subsetResult.kind).toBe('success');
    if (subsetResult.kind !== 'success') {
      throw new Error('expected planner success for subset');
    }
    // Contract only has 'user' table - should plan missing column, unique, and index
    expect((await Promise.all(subsetResult.plan.operations)).map((op) => op.id)).toEqual([
      'column.user.email',
      'unique.user.user_email_key',
      'index.user.user_email_idx',
    ]);
  });

  it('plans the empty-table fallback for a dropped NOT NULL unique column on a non-empty table', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('create table "user" (id uuid primary key)');
    await driver!.query(`INSERT INTO "user" ("id") VALUES
        ('00000000-0000-0000-0000-000000000001'),
        ('00000000-0000-0000-0000-000000000002')`);

    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);

    const planResult = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(planResult.kind).toBe('success');
    if (planResult.kind !== 'success') {
      throw new Error('expected planner success for constrained fallback case');
    }

    const planOps = (await Promise.all(
      planResult.plan.operations,
    )) as SqlMigrationPlanOperation<unknown>[];
    const addEmailOperation = planOps.find((op) => op.id === 'column.user.email');
    expect(addEmailOperation).toBeDefined();
    expect(addEmailOperation?.precheck.map((step) => step.sql)).toContain(
      'SELECT NOT EXISTS (SELECT 1 AS "one" FROM "user" LIMIT 1) AS "result"',
    );
    expect(addEmailOperation?.execute.map((step) => step.sql)).toEqual([
      'ALTER TABLE "user" ADD COLUMN "email" text NOT NULL',
    ]);
    expect(planOps.map((op) => op.id)).toEqual([
      'column.user.email',
      'unique.user.user_email_key',
      'index.user.user_email_idx',
    ]);
  });

  it('fails with conflicts for incompatible schemas', { timeout: testTimeout }, async () => {
    await driver!.query('create table "user" (id uuid primary key, email uuid not null)');
    const schema = await introspectSchema(driver!);
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);

    const conflictResult = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(conflictResult).toMatchObject({
      kind: 'failure',
      conflicts: [
        expect.objectContaining({
          kind: 'typeMismatch',
          location: { entityKind: 'table', entityName: 'user', column: 'email' },
        }),
      ],
    });
  });
});

async function introspectSchema(driver: PostgresControlDriver): Promise<SqlSchemaIRNode> {
  return familyInstance.introspect({
    driver,
    contract: contract,
  });
}
