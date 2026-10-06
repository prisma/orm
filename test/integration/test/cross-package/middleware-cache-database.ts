import postgresAdapter from '@internal/adapter-postgres/runtime';
import postgresDriver from '@internal/driver-postgres/runtime';
import pgvector from '@internal/extension-pgvector/runtime';
import {
  type ExecutionStackInstance,
  instantiateExecutionStack,
  type RuntimeDriverInstance,
} from '@internal/framework-components/execution';
import { PostgresRuntimeImpl } from '@internal/postgres/runtime';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type Runtime,
  type SqlMiddleware,
  type SqlRuntimeAdapterInstance,
  type SqlRuntimeDriverInstance,
  type SqlRuntimeExtensionInstance,
} from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { Client } from 'pg';
import { afterAll, beforeAll, vi } from 'vitest';
import { contract } from '../sql-builder/fixtures/contract';
import type { Contract } from '../sql-builder/fixtures/generated/contract';
import { setupTestDatabase } from '../utils';

const sqlContract = new PostgresContractSerializer().deserializeContract(contract) as Contract;

type TestStackInstance = ExecutionStackInstance<
  'sql',
  'postgres',
  SqlRuntimeAdapterInstance<'postgres'>,
  RuntimeDriverInstance<'sql', 'postgres'>,
  SqlRuntimeExtensionInstance<'postgres'>
>;

export interface MiddlewareCacheDatabase {
  readonly context: ExecutionContext<typeof sqlContract>;
  readonly client: Client;
  readonly driverQuerySpy: ReturnType<typeof vi.spyOn>;
  buildRuntime(middleware: SqlMiddleware[]): Runtime;
}

/**
 * Registers `beforeAll`/`afterAll` hooks in the calling `describe` that create a Postgres dev
 * database with the users/posts fixture tables, and returns accessors that are valid inside tests.
 */
export function useMiddlewareCacheDatabase(): MiddlewareCacheDatabase {
  let context: ExecutionContext<typeof sqlContract>;
  let driver: SqlRuntimeDriverInstance<'postgres'>;
  let stackInstance: TestStackInstance;
  let driverQuerySpy: ReturnType<typeof vi.spyOn>;
  let client: Client;
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
          CREATE TABLE articles (
            id uuid PRIMARY KEY,
            title text NOT NULL
          )
        `);

      await c.query(`
          INSERT INTO users (id, name, email, invited_by_id) VALUES
            (1, 'Alice',   'alice@example.com',   NULL),
            (2, 'Bob',     'bob@example.com',     1),
            (3, 'Charlie', 'charlie@example.com', 1),
            (4, 'Diana',   'diana@example.com',   2)
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

    // Spy on the driver's query so we can count round-trips. The
    // cache middleware short-circuits via `interceptQuery` upstream of
    // `runDriver`, so a hit shows up here as zero invocations.
    driverQuerySpy = vi.spyOn(driver, 'query');

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

  function buildRuntime(middleware: SqlMiddleware[]): Runtime {
    return new PostgresRuntimeImpl({
      context,
      adapter: stackInstance.adapter,
      driver,
      middleware,
    });
  }

  return {
    get context() {
      return context;
    },
    get client() {
      return client;
    },
    get driverQuerySpy() {
      return driverQuerySpy;
    },
    buildRuntime,
  };
}
