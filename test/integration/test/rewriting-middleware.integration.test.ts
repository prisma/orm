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
import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  ParamRef,
  type SelectAst,
} from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type Log,
  type Runtime,
  type SqlMiddleware,
  type SqlRuntimeAdapterInstance,
  type SqlRuntimeDriverInstance,
  type SqlRuntimeExtensionInstance,
} from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { contract } from './sql-builder/fixtures/contract';
import type { Contract } from './sql-builder/fixtures/generated/contract';
import { setupTestDatabase } from './utils';

const sqlContract = new PostgresContractSerializer().deserializeContract(contract) as Contract;

function rewriteUserSelects(name: string, rewrite: (ast: SelectAst) => SelectAst): SqlMiddleware {
  return {
    name,
    familyId: 'sql',
    async beforeCompile(draft) {
      if (draft.ast.kind !== 'select') return undefined;
      if (draft.ast.from?.kind !== 'table-source') return undefined;
      if (draft.ast.from.name !== 'users') return undefined;
      return { ...draft, ast: rewrite(draft.ast) };
    },
  };
}

function withPredicate(ast: SelectAst, pred: BinaryExpr): SelectAst {
  return ast.withWhere(ast.where ? AndExpr.of([ast.where, pred]) : pred);
}

type TestStackInstance = ExecutionStackInstance<
  'sql',
  'postgres',
  SqlRuntimeAdapterInstance<'postgres'>,
  RuntimeDriverInstance<'sql', 'postgres'>,
  SqlRuntimeExtensionInstance<'postgres'>
>;

describe('integration: SQL middleware rewriting', { timeout: timeouts.databaseOperation }, () => {
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

  function buildRuntime(middleware: SqlMiddleware[], log?: Log): Runtime {
    return new PostgresRuntimeImpl({
      closeRefusal: undefined,
      context,
      adapter: stackInstance.adapter,
      driver,
      middleware,
      ...(log ? { log } : {}),
    });
  }

  it('single middleware rewrite shapes the result set', async () => {
    const debug = vi.fn<(event: unknown) => void>();
    const idEqOne = BinaryExpr.eq(
      ColumnRef.of('users', 'id'),
      ParamRef.of(1, { name: 'middleware_user_id', codec: { codecId: 'pg/int4@1' } }),
    );
    const onlyAlice = rewriteUserSelects('onlyAlice', (ast) => withPredicate(ast, idEqOne));
    const runtime = buildRuntime([onlyAlice], {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug,
    });

    const db = sql({ context, rawCodecInferer: { inferCodec: () => 'pg/text' } });
    const rows = await runtime.query(db.public.users.select('id').build()).toArray();

    expect(rows.map((r) => r.id)).toEqual([1]);
    expect(debug).toHaveBeenCalledWith({
      event: 'middleware.rewrite',
      middleware: 'onlyAlice',
      lane: 'dsl',
    });
  });

  it('chains multiple middlewares, combining their predicates', async () => {
    const debug = vi.fn<(event: unknown) => void>();
    const idGte = (v: number, suffix: string) =>
      BinaryExpr.gte(
        ColumnRef.of('users', 'id'),
        ParamRef.of(v, { name: `mw_${suffix}`, codec: { codecId: 'pg/int4@1' } }),
      );
    const idLte = (v: number, suffix: string) =>
      BinaryExpr.lte(
        ColumnRef.of('users', 'id'),
        ParamRef.of(v, { name: `mw_${suffix}`, codec: { codecId: 'pg/int4@1' } }),
      );
    const lowerBound = rewriteUserSelects('idGte2', (ast) => withPredicate(ast, idGte(2, 'gte2')));
    const upperBound = rewriteUserSelects('idLte3', (ast) => withPredicate(ast, idLte(3, 'lte3')));

    const runtime = buildRuntime([lowerBound, upperBound], {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug,
    });

    const db = sql({ context, rawCodecInferer: { inferCodec: () => 'pg/text' } });
    const rows = await runtime.query(db.public.users.select('id', 'name').build()).toArray();

    expect(rows.map((r) => r.id).sort()).toEqual([2, 3]);
    expect(debug).toHaveBeenCalledTimes(2);
    expect(debug.mock.calls[0]?.[0]).toMatchObject({ middleware: 'idGte2' });
    expect(debug.mock.calls[1]?.[0]).toMatchObject({ middleware: 'idLte3' });
  });
});
