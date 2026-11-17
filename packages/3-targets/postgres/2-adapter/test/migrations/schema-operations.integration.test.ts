/**
 * The Postgres schema operations against a real database: moving a table to another schema,
 * renaming a schema and dropping one. Each operation's prechecks hold before it runs, its
 * postchecks fail before and hold after, so the runner skips it on a second run.
 */
import type {
  SqlMigrationPlanOperation,
  SqlMigrationPlanOperationStep,
} from '@internal/family-sql/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  DropSchemaCall,
  DropTableCall,
  RenameSchemaCall,
  SetTableSchemaCall,
} from '@internal/target-postgres/op-factory-call';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  contract,
  controlAdapter,
  createDriver,
  createMigrationPlan,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  LEDGER_TEST_SPACE_ID,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

describe('Postgres schema operations', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    await database?.close();
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
    await driver.query('reset search_path');
    await driver.query('drop schema if exists billing cascade');
    await driver.query('drop schema if exists finance cascade');
  }, testTimeout);

  afterEach(async () => {
    await driver?.close();
  }, testTimeout);

  async function holds(steps: readonly SqlMigrationPlanOperationStep[]): Promise<boolean[]> {
    const results: boolean[] = [];
    for (const step of steps) {
      const result = await driver.query<{ result: boolean }>(step.sql, step.params ?? []);
      results.push(result.rows[0]?.result === true);
    }
    return results;
  }

  async function apply(op: Op): Promise<void> {
    expect(await holds(op.postcheck), 'postchecks before').toContain(false);
    expect(await holds(op.precheck), 'prechecks before').toEqual(op.precheck.map(() => true));
    for (const step of op.execute) await driver.query(step.sql, step.params ?? []);
    expect(await holds(op.postcheck), 'postchecks after').toEqual(op.postcheck.map(() => true));
  }

  /**
   * Runs the operations through the runner in a space other than the application's, so the run
   * does not compare the database with the fixture contract afterwards.
   */
  async function runnerResult(ops: readonly Op[], on: PostgresControlDriver = driver) {
    const plan = createMigrationPlan<PostgresPlanTargetDetails>({
      targetId: 'postgres',
      spaceId: LEDGER_TEST_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: ops,
      providedInvariants: [],
    });
    return postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver: on,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan,
          migrationEdges: synthEdges(plan),
          driver: on,
          destinationContract: contract,
          policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
          frameworkComponents,
        },
      ],
    });
  }

  async function operationsExecuted(
    ops: readonly Op[],
    on: PostgresControlDriver = driver,
  ): Promise<number> {
    const result = await runnerResult(ops, on);
    if (!result.ok) throw new Error(`${result.failure.code}: ${result.failure.message}`);
    return result.value.perSpaceResults.reduce(
      (sum, { value }) => sum + value.operationsExecuted,
      0,
    );
  }

  it('runs each operation once through the runner, and a second run executes nothing', {
    timeout: testTimeout,
  }, async () => {
    await driver.query('create schema billing');
    await driver.query('create schema finance');
    await driver.query('create table billing.invoice (id int primary key)');
    const move = await new SetTableSchemaCall('billing', 'invoice', 'finance').toOp(controlAdapter);
    const rename = await new RenameSchemaCall('finance', 'accounts').toOp(controlAdapter);
    const drop = await new DropSchemaCall('billing').toOp(controlAdapter);

    for (const op of [move, rename, drop]) {
      expect(await operationsExecuted([op]), `first run of ${op.id}`).toBe(1);
      expect(await operationsExecuted([op]), `second run of ${op.id}`).toBe(0);
    }
    expect((await driver.query('select id from accounts.invoice')).rows).toEqual([]);
    await driver.query('drop schema accounts cascade');
  });

  it('moves a table of the unbound namespace into a schema on the search path, and a second run executes nothing', {
    timeout: testTimeout,
  }, async () => {
    await driver.query('create schema billing');
    await driver.query('create table public.invoice (id int primary key)');
    await driver.query('set search_path = billing, public');
    expect((await driver.query('show search_path')).rows).toEqual([
      { search_path: 'billing, public' },
    ]);
    const op = await new SetTableSchemaCall(UNBOUND_NAMESPACE_ID, 'invoice', 'billing').toOp(
      controlAdapter,
    );

    expect(await operationsExecuted([op])).toBe(1);
    expect(await operationsExecuted([op])).toBe(0);
    expect(
      (await driver.query("select to_regclass('billing.invoice') is not null as moved")).rows,
    ).toEqual([{ moved: true }]);
  });

  it('moves a table with its rows, primary key, index and sequence, and a foreign key from another table follows it', {
    timeout: testTimeout,
  }, async () => {
    await driver.query('create schema billing');
    await driver.query('create schema finance');
    await driver.query(
      'create table billing.invoice (id serial primary key, number text not null unique)',
    );
    await driver.query('create index invoice_number_idx on billing.invoice (number)');
    await driver.query(
      'create table public.payment (id int primary key, invoice_id int not null references billing.invoice (id))',
    );
    await driver.query("insert into billing.invoice (number) values ('A-1')");

    await apply(await new SetTableSchemaCall('billing', 'invoice', 'finance').toOp(controlAdapter));

    const moved = await driver.query<{ relname: string; nspname: string }>(
      `select c.relname, n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relname in ('invoice', 'invoice_pkey', 'invoice_number_key', 'invoice_number_idx', 'invoice_id_seq')
       order by c.relname`,
    );
    expect(moved.rows).toEqual([
      { relname: 'invoice', nspname: 'finance' },
      { relname: 'invoice_id_seq', nspname: 'finance' },
      { relname: 'invoice_number_idx', nspname: 'finance' },
      { relname: 'invoice_number_key', nspname: 'finance' },
      { relname: 'invoice_pkey', nspname: 'finance' },
    ]);
    const foreignKey = await driver.query<{ target: string }>(
      `select confrelid::regclass::text as target from pg_constraint
       where conrelid = 'public.payment'::regclass and contype = 'f'`,
    );
    expect(foreignKey.rows).toEqual([{ target: 'finance.invoice' }]);
    await driver.query("insert into finance.invoice (number) values ('A-2')");
    await driver.query('insert into public.payment (id, invoice_id) values (1, 2)');
    const rows = await driver.query('select id, number from finance.invoice order by id');
    expect(rows.rows).toEqual([
      { id: 1, number: 'A-1' },
      { id: 2, number: 'A-2' },
    ]);
  });

  it('moves a table of the unbound namespace, found through the search path', {
    timeout: testTimeout,
  }, async () => {
    await driver.query('create schema billing');
    await driver.query('create table public.invoice (id int primary key)');

    await apply(
      await new SetTableSchemaCall(UNBOUND_NAMESPACE_ID, 'invoice', 'billing').toOp(controlAdapter),
    );

    expect(
      (await driver.query("select to_regclass('billing.invoice') is not null as moved")).rows,
    ).toEqual([{ moved: true }]);
  });

  it('refuses to move a table into a schema that already has a table of that name', {
    timeout: testTimeout,
  }, async () => {
    await driver.query('create schema billing');
    await driver.query('create schema finance');
    await driver.query('create table billing.invoice (id int primary key)');
    await driver.query('create table finance.invoice (id int primary key)');
    const op = await new SetTableSchemaCall('billing', 'invoice', 'finance').toOp(controlAdapter);

    expect(await holds(op.postcheck)).toContain(false);
    expect(await holds(op.precheck)).toEqual([true, true, false]);
  });

  it('renames a schema with its tables', { timeout: testTimeout }, async () => {
    await driver.query('create schema billing');
    await driver.query('create table billing.invoice (id int primary key)');
    await driver.query('insert into billing.invoice (id) values (1)');

    await apply(await new RenameSchemaCall('billing', 'finance').toOp(controlAdapter));

    expect((await driver.query('select id from finance.invoice')).rows).toEqual([{ id: 1 }]);
  });

  it('drops a schema once its tables are dropped', { timeout: testTimeout }, async () => {
    await driver.query('create schema billing');
    await driver.query('create table billing.invoice (id int primary key)');

    await apply(await new DropTableCall('billing', 'invoice').toOp(controlAdapter));
    await apply(await new DropSchemaCall('billing').toOp(controlAdapter));

    expect(
      (await driver.query("select count(*)::int as n from pg_namespace where nspname = 'billing'"))
        .rows,
    ).toEqual([{ n: 0 }]);
  });

  it('fails the schema drop at its precheck while a table remains, and drops nothing', {
    timeout: testTimeout,
  }, async () => {
    await driver.query('create schema billing');
    await driver.query('create table billing.invoice (id int primary key)');

    const result = await runnerResult([await new DropSchemaCall('billing').toOp(controlAdapter)]);

    expect(result.ok).toBe(false);
    expect(result.assertNotOk()).toMatchObject({
      code: 'MIGRATION.PRECHECK_FAILED',
      message: 'Schema "billing" still holds table billing.invoice, so it cannot be dropped.',
      why: 'Operation dropSchema.billing failed during precheck: ensure schema "billing" holds no tables, views, sequences, types or functions. The failed apply changed nothing.',
      meta: { blockingObjects: [{ kind: 'table', name: 'billing.invoice' }] },
    });
    expect(
      (await driver.query("select to_regclass('billing.invoice') is not null as kept")).rows,
    ).toEqual([{ kept: true }]);
  });

  it('names the view that blocks a table drop, and drops nothing', {
    timeout: testTimeout,
  }, async () => {
    await driver.query('create schema billing');
    await driver.query('create table billing.audit_log (id int primary key)');
    await driver.query('create view billing.v_paid as select id from billing.audit_log');

    const result = await runnerResult([
      await new DropTableCall('billing', 'audit_log').toOp(controlAdapter),
    ]);

    expect(result.assertNotOk()).toMatchObject({
      code: 'MIGRATION.EXECUTION_FAILED',
      message:
        'Table "billing"."audit_log" cannot be dropped while view billing.v_paid depends on it.',
      meta: { blockingObjects: [{ kind: 'view', name: 'billing.v_paid' }] },
    });
    expect(
      (await driver.query("select to_regclass('billing.audit_log') is not null as kept")).rows,
    ).toEqual([{ kept: true }]);
  });

  it('names every object that blocks the schema drop', { timeout: testTimeout }, async () => {
    await driver.query('create schema billing');
    await driver.query('create sequence billing.counter');
    await driver.query('create view billing.recent as select 1 as one');
    await driver.query("create function billing.answer() returns int as 'select 42' language sql");

    const result = await runnerResult([await new DropSchemaCall('billing').toOp(controlAdapter)]);

    expect(result.assertNotOk().message).toBe(
      'Schema "billing" still holds function billing.answer, sequence billing.counter and view billing.recent, so it cannot be dropped.',
    );
  });

  it('fails the schema drop at its precheck while it holds a type of its own', {
    timeout: testTimeout,
  }, async () => {
    await driver.query('create schema billing');
    await driver.query("create type billing.status as enum ('open')");

    const op = await new DropSchemaCall('billing').toOp(controlAdapter);

    expect(await holds(op.precheck)).toEqual([false]);
  });
});
