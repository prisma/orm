import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { col, lit } from '@internal/sql-relational-core/contract-free';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { PostgresCreateTable } from '@internal/target-postgres/ddl';
import { SetDefaultCall } from '@internal/target-postgres/op-factory-call';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../../src/core/control-adapter';
import type { PostgresContract } from '../../src/core/types';
import {
  createDriver,
  createTestDatabase,
  executeStatement,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

describe('a list default the codecs read applies', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    await database?.close();
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    await driver?.close();
    driver = undefined;
  }, testTimeout);

  it(
    'fills a new row with each list, its NULL element and the empty list',
    async () => {
      const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
      const createTable = await adapter.lowerToExecuteRequest(
        new PostgresCreateTable({
          table: 'lists',
          columns: [
            col('id', 'int4', { notNull: true, primaryKey: true }),
            col('tags', 'text[]', {
              default: lit(['a', null, 'b']),
              codecRef: { codecId: 'pg/text@1', many: true },
            }),
            col('counts', 'int4[]', {
              default: lit([1, 2]),
              codecRef: { codecId: 'pg/int4@1', many: true },
            }),
            col('none', 'text[]', {
              default: lit([]),
              codecRef: { codecId: 'pg/text@1', many: true },
            }),
          ],
        }),
        { contract: {} as PostgresContract },
      );
      await executeStatement(driver!, createTable);
      await driver!.query('INSERT INTO "lists" (id) VALUES (1)');

      const read = await driver!.query(
        'SELECT tags::text, counts::text, "none"::text FROM "lists"',
      );

      expect(read.rows).toEqual([{ tags: '{a,NULL,b}', counts: '{1,2}', none: '{}' }]);
    },
    testTimeout,
  );

  it(
    'sets a changed list default with a NULL element',
    async () => {
      const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
      await driver!.query(
        'CREATE TABLE "lists" (id int4 PRIMARY KEY, tags text[] DEFAULT \'{x}\')',
      );
      const op = await new SetDefaultCall(
        UNBOUND_NAMESPACE_ID,
        'lists',
        col('tags', 'text[]', {
          default: lit(['c', null]),
          codecRef: { codecId: 'pg/text@1', many: true },
        }),
        'widening',
      ).toOp(adapter);
      for (const step of op.execute) await driver!.query(step.sql);
      await driver!.query('INSERT INTO "lists" (id) VALUES (1)');

      const read = await driver!.query('SELECT tags::text FROM "lists"');

      expect(read.rows).toEqual([{ tags: '{c,NULL}' }]);
    },
    testTimeout,
  );
});
