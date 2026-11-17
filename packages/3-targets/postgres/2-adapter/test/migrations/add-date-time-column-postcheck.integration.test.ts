/**
 * Adding a date or time column with no declared precision passes its postcheck: the check compares `format_type` with the text PostgreSQL prints for the type as written, though the type's normal form counts the omitted precision as 6.
 */
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { col } from '@internal/sql-relational-core/contract-free';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { AddColumnCall } from '@internal/target-postgres/op-factory-call';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

describe('the ADD COLUMN postcheck of a date or time column', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) await database.close();
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

  async function addColumn(type: string) {
    await driver!.query('DROP TABLE IF EXISTS "t"');
    await driver!.query('CREATE TABLE "t" (id int4 PRIMARY KEY)');
    const op = await new AddColumnCall(
      UNBOUND_NAMESPACE_ID,
      't',
      col('c', type),
      postgresDataTypes,
    ).toOp(controlAdapter);
    for (const step of op.execute) await driver!.query(step.sql, step.params ?? []);
    const results = await Promise.all(
      op.postcheck.map((step) => driver!.query<{ result: boolean }>(step.sql, step.params ?? [])),
    );
    return results.every((result) => result.rows[0]?.result === true);
  }

  it('holds with and without a declared precision', { timeout: testTimeout * 2 }, async () => {
    const types = [
      'timestamptz',
      'timestamptz(6)',
      'timestamp',
      'time',
      'timetz',
      'interval',
      'timestamptz(3)',
    ];
    const results: Record<string, boolean> = {};
    for (const type of types) results[type] = await addColumn(type);
    expect(results).toEqual(Object.fromEntries(types.map((type) => [type, true])));
  });
});
