import { postgresRawCodecInferer } from '@internal/adapter-postgres/adapter';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import postgresDriver from '@internal/driver-postgres/runtime';
import pgvector from '@internal/extension-pgvector/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { PostgresRuntimeImpl } from '@internal/postgres/runtime';
import { sql } from '@internal/sql-builder/runtime';
import type { Adapter, AnyQueryAst, LoweredStatement } from '@internal/sql-relational-core/ast';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import {
  createExecutionContext,
  createSqlExecutionStack,
  lowerSqlPlan,
  type Runtime,
} from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { blindCast } from '@internal/utils/casts';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { Client } from 'pg';
import { afterAll, beforeAll } from 'vitest';
import { setupTestDatabase } from '../utils';
import { contract } from './fixtures/contract';
import type { Contract } from './fixtures/generated/contract';

export { timeouts };

const sqlContract = blindCast<
  Contract,
  "PostgresContractSerializer.deserializeContract returns the framework's Contract supertype; the test fixture's narrowed Contract type isn't expressible at the deserializer boundary"
>(new PostgresContractSerializer().deserializeContract(contract));

export function setupIntegrationTest() {
  let runtime: Runtime;
  let context: ExecutionContext<typeof sqlContract>;
  let client: Client;
  let adapter: Adapter<AnyQueryAst, typeof sqlContract, LoweredStatement>;
  const closeFns: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    const database = await createDevDatabase();
    client = new Client({ connectionString: database.connectionString });
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
      await c.query('CREATE EXTENSION IF NOT EXISTS vector');
      await c.query(`
        CREATE TABLE posts (
          id int4 PRIMARY KEY,
          title text NOT NULL,
          user_id int4 NOT NULL,
          views int4 NOT NULL,
          embedding vector(3)
        )
      `);
      await c.query(`
        CREATE TABLE comments (
          id int4 PRIMARY KEY,
          body text NOT NULL,
          subject varchar(200) NOT NULL,
          post_id int4 NOT NULL
        )
      `);
      await c.query(`
        CREATE TABLE profiles (
          id int4 PRIMARY KEY,
          user_id int4 NOT NULL,
          bio text NOT NULL
        )
      `);

      await c.query(`
        INSERT INTO users (id, name, email, invited_by_id) VALUES
          (1, 'Alice', 'alice@example.com', NULL),
          (2, 'Bob', 'bob@example.com', 1),
          (3, 'Charlie', 'charlie@example.com', 1),
          (4, 'Diana', 'diana@example.com', 2)
      `);
      await c.query(`
        INSERT INTO posts (id, title, user_id, views, embedding) VALUES
          (1, 'Hello World', 1, 100, '[1,0,0]'),
          (2, 'Second Post', 1, 50, '[0,1,0]'),
          (3, 'Bobs Post', 2, 200, '[0,0,1]'),
          (4, 'Another One', 3, 10, '[1,1,0]')
      `);
      await c.query(`
        INSERT INTO comments (id, body, subject, post_id) VALUES
          (1, 'Great post!', 'praise', 1),
          (2, 'Nice work', 'praise', 1),
          (3, 'Interesting', 'remark', 3),
          (101, 'alice wrote the report', 'alice subject line', 1),
          (102, 'alice met alice and alice again', 'meeting notes', 1),
          (103, 'bob wrote the report', 'bob subject line', 1),
          (104, 'the quick brown fox jumps', 'animals', 1),
          (105, 'a brown dog and a quick cat', 'animals', 1),
          (106, 'alice manuscript draft', 'drafts', 1)
      `);
      await c.query(`
        INSERT INTO profiles (id, user_id, bio) VALUES
          (1, 1, 'Alice bio'),
          (2, 2, 'Bob bio')
      `);
      await c.query(`
        CREATE TABLE articles (
          id uuid PRIMARY KEY,
          title text NOT NULL
        )
      `);
    });

    const cursorDisabledDriver = {
      ...postgresDriver,
      create() {
        return postgresDriver.create({ cursor: { disabled: true } });
      },
    };

    const stack = createSqlExecutionStack({
      target: postgresTarget,
      adapter: postgresAdapter,
      driver: cursorDisabledDriver,
      extensions: [pgvector],
    });

    const stackInstance = instantiateExecutionStack(stack);
    context = createExecutionContext({
      contract: sqlContract,
      stack,
      driver: cursorDisabledDriver,
    });
    const driver = stackInstance.driver!;
    adapter = blindCast<
      Adapter<AnyQueryAst, typeof sqlContract, LoweredStatement>,
      'the stack-composed adapter lowers this contract; the instance type erases the contract parameter'
    >(stackInstance.adapter);
    await driver.connect({ kind: 'pgClient', client });

    runtime = new PostgresRuntimeImpl({
      context,
      adapter: stackInstance.adapter,
      driver,
    });

    closeFns.push(
      () => runtime.close(),
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

  return {
    db: () => sql({ context, rawCodecInferer: postgresRawCodecInferer }),
    runtime: () => runtime,
    /** The contract the fixture emits, for tests that read its storage. */
    contract: () => sqlContract,
    /** The execution context, for tests that drive another lane over the same stack. */
    context: () => context,
    /** The raw connection, for tests that need SQL the DSL does not express (EXPLAIN, DDL). */
    client: () => client,
    /** The SQL and bound params a plan lowers to, exactly as the runtime sends them. */
    lower: <Row>(plan: SqlQueryPlan<Row>) => lowerSqlPlan(adapter, sqlContract, plan),
  };
}
