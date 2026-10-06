/**
 * An opaque SQL body whose last line is a `--` comment must not comment out the rest of the statement the planner places it in.
 */
import { checkExpression, col, fn } from '@internal/sql-relational-core/contract-free';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { createTable } from '@internal/target-postgres/contract-free';
import {
  AddCheckConstraintCall,
  CreateIndexCall,
  CreatePostgresRlsPolicyCall,
} from '@internal/target-postgres/op-factory-call';
import { PostgresRlsPolicy } from '@internal/target-postgres/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

const TRAILING_COMMENT = '\n-- trailing comment';

async function applyOp(
  driver: PostgresControlDriver,
  call: { toOp(lowerer: typeof controlAdapter): Promise<{ execute: readonly { sql: string }[] }> },
): Promise<void> {
  const op = await call.toOp(controlAdapter);
  for (const step of op.execute) {
    await driver.query(step.sql);
  }
}

describe('opaque SQL ending in a line comment', { concurrent: false }, () => {
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

  function requireDriver(): PostgresControlDriver {
    if (!driver) throw new Error('driver is not connected');
    return driver;
  }

  async function createItemTable(): Promise<void> {
    await requireDriver().query(
      'CREATE TABLE public.item (id int PRIMARY KEY, price int, email text)',
    );
  }

  it('creates a table with a CHECK', { timeout: testTimeout }, async () => {
    const statement = await controlAdapter.lowerToExecuteRequest(
      createTable({
        schema: 'public',
        table: 'item',
        columns: [
          col('id', 'int4', { primaryKey: true }),
          col('price', 'int4', { notNull: true, default: fn('1') }),
        ],
        constraints: [checkExpression('item_price_positive', `price > 0${TRAILING_COMMENT}`)],
      }),
    );
    await requireDriver().query(statement.sql);

    await requireDriver().query('INSERT INTO public.item (id) VALUES (1)');
    const rows = await requireDriver().query('SELECT id, price FROM public.item');
    expect(rows.rows).toEqual([{ id: 1, price: 1 }]);
    await expect(
      requireDriver().query('INSERT INTO public.item (id, price) VALUES (2, -1)'),
    ).rejects.toThrow(/item_price_positive/);
  });

  it('adds a CHECK constraint to an existing table', { timeout: testTimeout }, async () => {
    await createItemTable();
    await applyOp(
      requireDriver(),
      new AddCheckConstraintCall(
        'public',
        'item',
        'item_price_positive',
        `price > 0${TRAILING_COMMENT}`,
      ),
    );

    await expect(
      requireDriver().query('INSERT INTO public.item (id, price) VALUES (1, -1)'),
    ).rejects.toThrow(/item_price_positive/);
  });

  it('creates a policy with USING and WITH CHECK', { timeout: testTimeout }, async () => {
    await createItemTable();
    await applyOp(
      requireDriver(),
      new CreatePostgresRlsPolicyCall(
        'public',
        'item',
        new PostgresRlsPolicy({
          naming: parseNaming('item_owner_a1b2c3d4', 'item_owner'),
          tableName: 'item',
          namespaceId: 'public',
          operation: 'all',
          roles: ['public'],
          using: `price > 0${TRAILING_COMMENT}`,
          withCheck: `price < 100${TRAILING_COMMENT}`,
          permissive: true,
        }),
      ),
    );

    const policies = await requireDriver().query(
      "SELECT policyname, qual, with_check FROM pg_policies WHERE tablename = 'item'",
    );
    expect(policies.rows).toEqual([
      { policyname: 'item_owner_a1b2c3d4', qual: '(price > 0)', with_check: '(price < 100)' },
    ]);
  });

  it('creates an index whose element list ends in a comment', {
    timeout: testTimeout,
  }, async () => {
    await createItemTable();
    await applyOp(
      requireDriver(),
      new CreateIndexCall('public', 'item', 'item_email_idx', {
        expression: 'lower(email), id -- c',
      }),
    );

    const indexes = await requireDriver().query(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'item_email_idx'",
    );
    expect(indexes.rows).toEqual([
      {
        indexdef: 'CREATE INDEX item_email_idx ON public.item USING btree (lower(email), id)',
      },
    ]);
  });

  it('creates a partial index whose predicate ends in a comment', {
    timeout: testTimeout,
  }, async () => {
    await createItemTable();
    await applyOp(
      requireDriver(),
      new CreateIndexCall(
        'public',
        'item',
        'item_email_partial_idx',
        { columns: ['email'] },
        { where: `email IS NOT NULL${TRAILING_COMMENT}` },
      ),
    );

    const indexes = await requireDriver().query(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'item_email_partial_idx'",
    );
    expect(indexes.rows).toEqual([
      {
        indexdef:
          'CREATE INDEX item_email_partial_idx ON public.item USING btree (email) WHERE (email IS NOT NULL)',
      },
    ]);
  });
});
