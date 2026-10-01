import { postgresRawCodecInferer } from '@internal/adapter-postgres/adapter';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import postgresDriver from '@internal/driver-postgres/runtime';
import pgvector from '@internal/extension-pgvector/runtime';
import {
  type ExecutionStackInstance,
  instantiateExecutionStack,
  type RuntimeDriverInstance,
} from '@internal/framework-components/execution';
import { PostgresRuntimeImpl } from '@internal/postgres/runtime';
import { createRawSql } from '@internal/sql-relational-core/expression';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type Runtime,
  type SqlRuntimeAdapterInstance,
  type SqlRuntimeDriverInstance,
  type SqlRuntimeExtensionInstance,
} from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contract } from './sql-builder/fixtures/contract';
import type { Contract } from './sql-builder/fixtures/generated/contract';
import { setupTestDatabase } from './utils';

const sqlContract = new PostgresContractSerializer().deserializeContract(contract) as Contract;

type TestStackInstance = ExecutionStackInstance<
  'sql',
  'postgres',
  SqlRuntimeAdapterInstance<'postgres'>,
  RuntimeDriverInstance<'sql', 'postgres'>,
  SqlRuntimeExtensionInstance<'postgres'>
>;

/**
 * Every case owns its own inviter and invitees, so the mutating case never
 * touches a row a reading case asserts on and the file holds in any order.
 */
const inviters = {
  bumpedTwice: 101,
  bumpedOnce: 102,
  read: 201,
  readAlternate: 202,
} as const;

describe('integration: prepared whole-query raw statements', {
  timeout: timeouts.databaseOperation,
}, () => {
  let context: ExecutionContext<typeof sqlContract>;
  let driver: SqlRuntimeDriverInstance<'postgres'>;
  let stackInstance: TestStackInstance;
  let runtime: Runtime;
  const closeFns: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    const database = await createDevDatabase();
    const client = new Client({ connectionString: database.connectionString });
    await client.connect();

    await setupTestDatabase(client, sqlContract, async (c) => {
      await c.query(`
          CREATE TABLE users (
            id int4 PRIMARY KEY,
            name text NOT NULL,
            email text NOT NULL,
            invited_by_id int4
          )
        `);
      await c.query(`
          INSERT INTO users (id, name, email, invited_by_id) VALUES
            (101, 'Bump Host',  'bump-host@example.com',  NULL),
            (102, 'Bump Guest', 'bump-guest@example.com', NULL),
            (201, 'Read Host',  'read-host@example.com',  NULL),
            (202, 'Read Alt',   'read-alt@example.com',   NULL),
            (111, 'Bumped One', 'bumped-one@example.com', 101),
            (112, 'Bumped Two', 'bumped-two@example.com', 101),
            (121, 'Bumped Solo','bumped-solo@example.com',102),
            (211, 'Readable A', 'readable-a@example.com', 201),
            (212, 'Readable B', 'readable-b@example.com', 201),
            (221, 'Readable C', 'readable-c@example.com', 202)
        `);
    });

    const stack = createSqlExecutionStack({
      target: postgresTarget,
      adapter: postgresAdapter,
      driver: {
        ...postgresDriver,
        create() {
          return postgresDriver.create({ cursor: { disabled: true } });
        },
      },
      extensions: [pgvector],
    });

    stackInstance = instantiateExecutionStack(stack) as TestStackInstance;
    context = createExecutionContext({ contract: sqlContract, stack });
    const resolvedDriver = stackInstance.driver;
    if (!resolvedDriver) throw new Error('Driver missing');
    driver = resolvedDriver as SqlRuntimeDriverInstance<'postgres'>;
    await driver.connect({ kind: 'pgClient', client });

    runtime = new PostgresRuntimeImpl({
      closeRefusal: undefined,
      context,
      adapter: stackInstance.adapter,
      driver,
      verifyMarker: false,
    });

    closeFns.push(
      () => driver.close(),
      () => client.end(),
      () => database.close(),
    );
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    for (const fn of closeFns) {
      try {
        await fn();
      } catch {
        // ignore cleanup errors
      }
    }
  });

  const rawSql = () => createRawSql(postgresRawCodecInferer, { contract: sqlContract });

  it('reuses one prepared statement to report each invocation own count', async () => {
    const prepared = await runtime.prepare({ inviterId: 'pg/int4@1' }, (params) =>
      rawSql()`UPDATE users SET name = name || '*' WHERE invited_by_id = ${params.inviterId}`
        .affectedCount()
        .build(),
    );

    const first = await prepared.execute(runtime, { inviterId: inviters.bumpedTwice });
    const second = await prepared.execute(runtime, { inviterId: inviters.bumpedOnce });

    expect(first).toEqual({ affectedRows: 2 });
    expect(second).toEqual({ affectedRows: 1 });
  });

  it('reuses one prepared statement to stream each invocation own rows', async () => {
    const prepared = await runtime.prepare({ inviterId: 'pg/int4@1' }, (params) =>
      rawSql()`SELECT id, name FROM users WHERE invited_by_id = ${params.inviterId} ORDER BY id`
        .returnsRow({ id: 'pg/int4@1', name: 'pg/text@1' })
        .build(),
    );

    const invited = await prepared.query(runtime, { inviterId: inviters.read });
    const alternate = await prepared.query(runtime, { inviterId: inviters.readAlternate });

    expect(invited).toEqual([
      { id: 211, name: 'Readable A' },
      { id: 212, name: 'Readable B' },
    ]);
    expect(alternate).toEqual([{ id: 221, name: 'Readable C' }]);
  });

  it('decodes prepared rows through the codecs their spec declares', async () => {
    const prepared = await runtime.prepare({ inviterId: 'pg/int4@1' }, (params) =>
      rawSql()`SELECT count(*) AS invited_count FROM users WHERE invited_by_id = ${params.inviterId}`
        .returnsRow({ invited_count: 'pg/int8@1' })
        .build(),
    );

    const rows = await prepared.query(runtime, { inviterId: inviters.read });

    // pg/int8@1 decodes to a bigint, which is what the spec declared.
    expect(rows).toEqual([{ invited_count: 2n }]);
  });
});
