import type { JsonValue } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { CodecRef } from '@internal/sql-relational-core/ast';
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
    'writes each element as the codec writes it, beside a NULL element',
    async () => {
      const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
      const list = (name: string, type: string, codecRef: CodecRef, value: JsonValue[]) =>
        col(name, type, { default: lit(value), codecRef: { ...codecRef, many: true } });
      const createTable = await adapter.lowerToExecuteRequest(
        new PostgresCreateTable({
          table: 'lists',
          columns: [
            col('id', 'int4', { notNull: true, primaryKey: true }),
            list('texts', 'text[]', { codecId: 'pg/text@1' }, ['a', null]),
            list('counts', 'int4[]', { codecId: 'pg/int4@1' }, [1, null]),
            list('tokens', 'uuid[]', { codecId: 'pg/uuid@1' }, [
              'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
              null,
            ]),
            list('stamps', 'timestamptz[]', { codecId: 'pg/timestamptz-temporal@1' }, [
              '2020-01-01T00:00:00Z',
              null,
            ]),
            list(
              'hundreds',
              'numeric(5,-2)[]',
              { codecId: 'pg/numeric@1', typeParams: { precision: 5, scale: -2 } },
              ['12300', null],
            ),
            list('bytes', 'bytea[]', { codecId: 'pg/bytea@1' }, ['aGVsbG8=', null]),
          ],
        }),
        { contract: {} as PostgresContract },
      );
      await executeStatement(driver!, createTable);
      await driver!.query('INSERT INTO "lists" (id) VALUES (1)');
      await driver!.query("SET TIME ZONE 'UTC'");

      const read = await driver!.query(
        'SELECT texts::text, counts::text, tokens::text, stamps::text, hundreds::text, bytes::text FROM "lists"',
      );

      expect(read.rows).toEqual([
        {
          texts: '{a,NULL}',
          counts: '{1,NULL}',
          tokens: '{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11,NULL}',
          stamps: '{"2020-01-01 00:00:00+00",NULL}',
          hundreds: '{12300,NULL}',
          bytes: '{"\\\\x68656c6c6f",NULL}',
        },
      ]);
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
