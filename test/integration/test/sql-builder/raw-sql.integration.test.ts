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
import { sql } from '@internal/sql-builder/runtime';
import { param } from '@internal/sql-relational-core/expression';
import type { SqlParamRefMutator } from '@internal/sql-relational-core/middleware';
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDatabase } from '../utils';
import { contract } from './fixtures/contract';
import type { Contract } from './fixtures/generated/contract';

const sqlContract = new PostgresContractSerializer().deserializeContract(contract) as Contract;

type TestStackInstance = ExecutionStackInstance<
  'sql',
  'postgres',
  SqlRuntimeAdapterInstance<'postgres'>,
  RuntimeDriverInstance<'sql', 'postgres'>,
  SqlRuntimeExtensionInstance<'postgres'>
>;

describe('integration: rawSql expression in typed builder', {
  timeout: timeouts.databaseOperation,
}, () => {
  let context: ExecutionContext<typeof sqlContract>;
  let driver: SqlRuntimeDriverInstance<'postgres'>;
  let stackInstance: TestStackInstance;
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
          (1, 'Alice', 'alice@example.com', NULL),
          (2, 'Bob', 'bob@example.com', 1),
          (3, 'Charlie', 'charlie@example.com', 1),
          (4, 'Diana', 'diana@example.com', 2)
      `);
      await c.query(`
        INSERT INTO posts (id, title, user_id, views, embedding) VALUES
          (1, 'Hello World', 1, 100, '[1,0,0]'),
          (2, 'Second Post', 1, 50, '[0,1,0]'),
          (3, 'Bobs Post',   2, 200, '[0,0,1]'),
          (4, 'Another One', 3, 10, '[1,1,0]')
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

  function buildRuntime(middleware?: readonly SqlMiddleware[]): Runtime {
    return new PostgresRuntimeImpl({
      closeRefusal: undefined,
      context,
      adapter: stackInstance.adapter,
      driver,
      verifyMarker: false,
      ...(middleware ? { middleware } : {}),
    });
  }

  describe('rawSql expression survives the full pipeline and returns expected rows', () => {
    it('rawSql in aliased select produces correct computed values from the database', async () => {
      const adapter = postgresRawCodecInferer;
      const db = sql({ context, rawCodecInferer: adapter });
      const runtime = buildRuntime();

      // posts.views values: 100, 50, 200, 10 — doubled they become 200, 100, 400, 20.
      // fns.raw is RawSqlTag (always present) because BuiltinFunctions declares it
      // concretely; the callback receives AggregateFunctions<QC>.
      const rows = await runtime.query(
        db.public.posts
          .select('id')
          .select('doubled', (f, fns) => fns.raw`${f.views} * 2`.returns('pg/int4@1'))
          .orderBy('id')
          .build(),
      );

      expect(rows).toHaveLength(4);
      expect(rows.map((r) => r.doubled)).toEqual([200, 100, 400, 20]);
    });

    it('rawSql with a literal scalar expression returns the same value for every row', async () => {
      const adapter = postgresRawCodecInferer;
      const db = sql({ context, rawCodecInferer: adapter });
      const runtime = buildRuntime();

      const rows = await runtime.query(
        db.public.posts
          .select('id')
          .select('magic', (_f, fns) => fns.raw`42`.returns('pg/int4@1'))
          .orderBy('id')
          .build(),
      );

      expect(rows).toHaveLength(4);
      expect(rows.every((r) => r.magic === 42)).toBe(true);
    });
  });

  describe('ParamRef from rawSql interpolation surfaces in beforeQuery params walk', () => {
    it('param() inside rawSql appears in beforeQuery entries() in canonical order', async () => {
      const capturedEntries: Array<{ codecId: string | undefined; value: unknown }> = [];

      const middleware: SqlMiddleware = {
        name: 'param-capture',
        familyId: 'sql',
        beforeQuery(_plan, _ctx, params?: SqlParamRefMutator) {
          if (!params) return;
          for (const entry of params.entries()) {
            capturedEntries.push({ codecId: entry.codecId, value: entry.value });
          }
        },
      };

      const adapter = postgresRawCodecInferer;
      const db = sql({ context, rawCodecInferer: adapter });
      const runtime = buildRuntime([middleware]);

      // The where clause embeds a param() inside a rawSql expression.
      // After lowering, the plan carries one ParamRef (value 50, codec pg/int4@1).
      // The middleware's beforeQuery should see it via params.entries().
      // fns.raw is RawSqlTag (non-optional) — callable directly as a template tag.
      const result = runtime.query(
        db.public.posts
          .select('id')
          .where((_f, fns) =>
            fns.gt(
              fns.raw`${param(50, { codecId: 'pg/int4@1' })}`.returns('pg/int4@1'),
              fns.raw`0`.returns('pg/int4@1'),
            ),
          )
          .build(),
      );
      await result.toArray();

      // The where predicate gt(rawSql`${param(50)}`, rawSql`0`) produces one ParamRef.
      // The rawSql`0` branch has no interpolations; param(50) introduces one ParamRef.
      expect(capturedEntries.length).toBeGreaterThanOrEqual(1);
      const paramEntry = capturedEntries.find((e) => e.codecId === 'pg/int4@1');
      expect(paramEntry).toBeDefined();
      expect(paramEntry?.value).toBe(50);
    });

    it('param() count in beforeQuery entries matches the number of param() calls in rawSql', async () => {
      const capturedEntries: Array<{ codecId: string | undefined; value: unknown }> = [];

      const middleware: SqlMiddleware = {
        name: 'param-count-capture',
        familyId: 'sql',
        beforeQuery(_plan, _ctx, params?: SqlParamRefMutator) {
          if (!params) return;
          for (const entry of params.entries()) {
            capturedEntries.push({ codecId: entry.codecId, value: entry.value });
          }
        },
      };

      const adapter = postgresRawCodecInferer;
      const db = sql({ context, rawCodecInferer: adapter });
      const runtime = buildRuntime([middleware]);

      // Two param() calls: param(10) and param(200).
      // The where clause: both params embedded in rawSql expressions, surfaced via gt/lt.
      const result = runtime.query(
        db.public.posts
          .select('id')
          .where((_f, fns) =>
            fns.and(
              fns.gt(
                fns.raw`${param(10, { codecId: 'pg/int4@1' })}`.returns('pg/int4@1'),
                fns.raw`0`.returns('pg/int4@1'),
              ),
              fns.lt(
                fns.raw`${param(200, { codecId: 'pg/int4@1' })}`.returns('pg/int4@1'),
                fns.raw`1000`.returns('pg/int4@1'),
              ),
            ),
          )
          .build(),
      );
      await result.toArray();

      const int4Entries = capturedEntries.filter((e) => e.codecId === 'pg/int4@1');
      expect(int4Entries).toHaveLength(2);
      expect(int4Entries.map((e) => e.value).sort()).toEqual([10, 200]);
    });
  });
});
