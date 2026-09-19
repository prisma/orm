import postgresAdapter from '@internal/adapter-postgres/runtime';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/runtime';
import pgvectorRuntime from '@internal/extension-pgvector/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import type {
  AsyncIterableResult,
  RuntimeExecuteOptions,
} from '@internal/framework-components/runtime';
import { PostgresRuntimeImpl } from '@internal/postgres/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { RuntimeQueryable } from '@internal/sql-orm-client';
import type { SqlStatementStats } from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type SqlMiddleware,
  type SqlRuntimeExtensionDescriptor,
  type RuntimeQueryable as SqlRuntimeQueryable,
} from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { blindCast } from '@internal/utils/casts';
import { Client } from 'pg';
import { getTestContract } from './helpers';

interface SeedUser {
  id: number;
  name: string;
  email: string;
  invitedById?: number | null;
}

interface SeedPost {
  id: number;
  title: string;
  userId: number | null;
  views: number;
  embedding?: number[] | null;
}

interface SeedProfile {
  id: number;
  userId: number | null;
  bio: string;
}

interface SeedComment {
  id: number;
  body: string;
  postId: number;
}

interface SeedTag {
  id: string;
  name: string;
}

interface SeedUserTag {
  userId: number;
  tagId: string;
}

interface SeedRole {
  id: string;
  name: string;
}

interface SeedUserRole {
  userId: number;
  roleId: string;
  level: number;
}

export interface PgIntegrationRuntime extends RuntimeQueryable {
  readonly executions: readonly SqlExecutionPlan[];
  query<Row>(
    plan: (SqlExecutionPlan | SqlQueryPlan) & { readonly _row?: Row },
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sqlText: string,
    params?: readonly unknown[],
  ): Promise<readonly Row[]>;
  resetExecutions(): void;
  close(): Promise<void>;
}

export async function createPgIntegrationRuntime(
  connectionString: string,
  // The runtime validates each plan's storageHash against this contract, so
  // tests driving a non-base fixture (e.g. the emitted polymorphism contract)
  // must build the runtime against that same contract. Defaults to the base
  // sql-orm-client fixture.
  contractOverride?: Contract<SqlStorage>,
  additionalExtensions: readonly SqlRuntimeExtensionDescriptor<'postgres'>[] = [],
  middleware: readonly SqlMiddleware[] = [],
): Promise<PgIntegrationRuntime> {
  // Use a single client, not a pool: the `@prisma/dev` server is PGlite-backed
  // and allows only one concurrent connection. The mutation path opens a
  // transaction via `connection().transaction()`, which holds the connection
  // across statements; a pool would hand the ORM's read/readback a *second*
  // connection and the single backend would reject it. The direct driver
  // serializes all access onto this one client, so transactions commit/roll back
  // atomically and `query()` shares the same backend.
  const client = new Client({ connectionString });
  await client.connect();
  // Wrap stack/runtime construction so any failure between client connect and
  // a working runtime closes the client. Without this, an early throw
  // (e.g. missing adapter/driver descriptor) leaks the connection until the
  // test process exits.
  const setup = await (async () => {
    try {
      await client.query('select 1');

      const contract = contractOverride ?? getTestContract();

      const stack = createSqlExecutionStack({
        target: postgresTarget,
        adapter: postgresAdapter,
        // Cursor-backed statements through the PGlite-backed `@prisma/dev`
        // server do not preserve this harness's ORM mutation transaction: a
        // failing nested write leaves its parent insert committed. These tests
        // exercise ORM rollback semantics rather than streaming, so buffer rows.
        driver: {
          ...postgresDriver,
          create() {
            return postgresDriver.create({ cursor: { disabled: true } });
          },
        },
        extensions: [pgvectorRuntime, ...additionalExtensions],
      });

      const context = createExecutionContext<Contract<SqlStorage>>({ contract, stack });
      const stackInstance = instantiateExecutionStack(stack);
      // Use the stack-composed adapter (carries `pg/vector@1` via the pgvector
      // extension pack) for both lowering-for-assertion and execution. A bare
      // `createPostgresAdapter()` here would fail at lower-time on any vector
      // ParamRef because the renderer now throws when a codecId is absent
      // from the assembled lookup (see ADR 205).
      const adapter = stackInstance.adapter;
      if (!adapter) {
        throw new Error('Adapter descriptor missing from execution stack');
      }

      const driver = stackInstance.driver;
      if (!driver) {
        throw new Error('Driver descriptor missing from execution stack');
      }
      await driver.connect({ kind: 'pgClient', client });

      const realRuntime = new PostgresRuntimeImpl({
        context,
        adapter: stackInstance.adapter,
        driver,
        middleware,
      });
      return { adapter, realRuntime, contract };
    } catch (err) {
      await client.end();
      throw err;
    }
  })();
  const { adapter, realRuntime, contract } = setup;

  const executions: SqlExecutionPlan[] = [];

  const toLoweredPlan = <Row>(
    plan: SqlExecutionPlan<Row> | SqlQueryPlan<Row>,
  ): SqlExecutionPlan<Row> => {
    if ('sql' in plan) {
      return plan;
    }

    const lowered = adapter.lower(plan.ast, {
      contract,
      params: plan.params,
    });

    return {
      sql: lowered.sql,
      params: lowered.params ?? plan.params,
      ast: plan.ast,
      meta: plan.meta,
    };
  };

  const record = (plan: SqlExecutionPlan | SqlQueryPlan): void => {
    executions.push(toLoweredPlan(plan));
  };

  function createRecordingQuery(target: SqlRuntimeQueryable): SqlRuntimeQueryable['query'] {
    return function query<Row>(
      plan: (SqlExecutionPlan | SqlQueryPlan) & { readonly _row?: Row },
      options?: RuntimeExecuteOptions,
    ): AsyncIterableResult<Row> {
      record(plan);
      return target.query<Row>(plan, options);
    };
  }

  function createRecordingExecute(target: SqlRuntimeQueryable): SqlRuntimeQueryable['execute'] {
    return async function execute(
      plan: SqlExecutionPlan | SqlQueryPlan,
      options?: RuntimeExecuteOptions,
    ): Promise<SqlStatementStats> {
      record(plan);
      return await target.execute(plan, options);
    };
  }

  function query<Row>(
    plan: (SqlExecutionPlan | SqlQueryPlan) & { readonly _row?: Row },
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row>;
  function query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sqlText: string,
    params?: readonly unknown[],
  ): Promise<readonly Row[]>;
  function query(
    planOrSql: SqlExecutionPlan | SqlQueryPlan | string,
    optionsOrParams?: RuntimeExecuteOptions | readonly unknown[],
  ): AsyncIterableResult<unknown> | Promise<readonly Record<string, unknown>[]> {
    if (typeof planOrSql === 'string') {
      const params = blindCast<
        readonly unknown[],
        'raw SQL query overload receives positional parameters rather than execution options'
      >(optionsOrParams ?? []);
      return client
        .query<Record<string, unknown>>(planOrSql, [...params])
        .then((result) => result.rows);
    }
    record(planOrSql);
    return realRuntime.query(
      planOrSql,
      blindCast<
        RuntimeExecuteOptions | undefined,
        'plan query overload receives execution options rather than raw params'
      >(optionsOrParams),
    );
  }

  const runtime: PgIntegrationRuntime = {
    executions,
    query,
    resetExecutions() {
      executions.length = 0;
    },
    async close() {
      await realRuntime.close();
    },
    async execute(
      plan: SqlExecutionPlan | SqlQueryPlan,
      options?: RuntimeExecuteOptions,
    ): Promise<SqlStatementStats> {
      record(plan);
      return await realRuntime.execute(plan, options);
    },
    // Expose a connection so `withMutationScope` takes the transactional path
    // (`connection().transaction()`): nested-write graphs commit/roll back
    // atomically, matching production. Reads also acquire a connection here, so
    // the returned scope (and its transaction) must keep recording executions —
    // otherwise the per-test execution-count assertions would miss them.
    async connection() {
      const conn = await realRuntime.connection();
      type PgConnection = Awaited<ReturnType<typeof realRuntime.connection>>;
      type PgTransaction = Awaited<ReturnType<PgConnection['transaction']>>;

      const recordingConnection: PgConnection = {
        ...conn,
        query: createRecordingQuery(conn),
        execute: createRecordingExecute(conn),
        transaction: async (): Promise<PgTransaction> => {
          const tx = await conn.transaction();
          const recordingTransaction: PgTransaction = {
            ...tx,
            query: createRecordingQuery(tx),
            execute: createRecordingExecute(tx),
          };
          return recordingTransaction;
        },
      };
      return recordingConnection;
    },
  };

  return runtime;
}

export async function setupTestSchema(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('create schema if not exists prisma_contract');
  await runtime.query(`create table if not exists prisma_contract.marker (
    space text not null primary key default 'app',
    core_hash text not null,
    profile_hash text not null,
    contract_json jsonb,
    canonical_version int,
    updated_at timestamptz not null default now(),
    app_tag text,
    meta jsonb not null default '{}',
    invariants text[] not null default '{}'
  )`);
  await runtime.query('create extension if not exists vector');

  await runtime.query('drop table if exists user_tags');
  await runtime.query('drop table if exists tags');
  await runtime.query('drop table if exists user_roles');
  await runtime.query('drop table if exists roles');
  await runtime.query('drop table if exists comments');
  await runtime.query('drop table if exists profiles');
  await runtime.query('drop table if exists posts');
  await runtime.query('drop table if exists users');

  await runtime.query(`
    create table users (
      id integer primary key,
      name text not null,
      email text not null,
      invited_by_id integer,
      address jsonb
    )
  `);

  await runtime.query(`
    create table posts (
      id integer primary key,
      title text not null,
      user_id integer,
      views integer not null,
      embedding vector
    )
  `);

  await runtime.query(`
    create table comments (
      id integer primary key,
      body text not null,
      post_id integer not null
    )
  `);

  await runtime.query(`
    create table profiles (
      id integer primary key,
      user_id integer,
      bio text not null
    )
  `);

  await runtime.query(`
    create table tags (
      id text primary key,
      name text not null unique
    )
  `);

  await runtime.query(`
    create table user_tags (
      user_id integer not null,
      tag_id text not null,
      note text,
      created_at text not null default now(),
      primary key (user_id, tag_id)
    )
  `);

  await runtime.query(`
    create table roles (
      id text primary key,
      name text not null unique
    )
  `);

  await runtime.query(`
    create table user_roles (
      user_id integer not null,
      role_id text not null,
      level integer not null,
      primary key (user_id, role_id)
    )
  `);
}

export async function seedUsers(
  runtime: PgIntegrationRuntime,
  users: readonly SeedUser[],
): Promise<void> {
  for (const user of users) {
    await runtime.query(
      'insert into users (id, name, email, invited_by_id) values ($1, $2, $3, $4)',
      [user.id, user.name, user.email, user.invitedById ?? null],
    );
  }
}

export async function seedPosts(
  runtime: PgIntegrationRuntime,
  posts: readonly SeedPost[],
): Promise<void> {
  for (const post of posts) {
    await runtime.query(
      'insert into posts (id, title, user_id, views, embedding) values ($1, $2, $3, $4, $5)',
      [
        post.id,
        post.title,
        post.userId,
        post.views,
        post.embedding ? `[${post.embedding.join(',')}]` : null,
      ],
    );
  }
}

export async function seedProfiles(
  runtime: PgIntegrationRuntime,
  profiles: readonly SeedProfile[],
): Promise<void> {
  for (const profile of profiles) {
    await runtime.query('insert into profiles (id, user_id, bio) values ($1, $2, $3)', [
      profile.id,
      profile.userId,
      profile.bio,
    ]);
  }
}

export async function seedComments(
  runtime: PgIntegrationRuntime,
  comments: readonly SeedComment[],
): Promise<void> {
  for (const comment of comments) {
    await runtime.query('insert into comments (id, body, post_id) values ($1, $2, $3)', [
      comment.id,
      comment.body,
      comment.postId,
    ]);
  }
}

export async function seedTags(
  runtime: PgIntegrationRuntime,
  tags: readonly SeedTag[],
): Promise<void> {
  for (const tag of tags) {
    await runtime.query('insert into tags (id, name) values ($1, $2)', [tag.id, tag.name]);
  }
}

export async function seedUserTags(
  runtime: PgIntegrationRuntime,
  userTags: readonly SeedUserTag[],
): Promise<void> {
  for (const ut of userTags) {
    await runtime.query('insert into user_tags (user_id, tag_id) values ($1, $2)', [
      ut.userId,
      ut.tagId,
    ]);
  }
}

export async function seedRoles(
  runtime: PgIntegrationRuntime,
  roles: readonly SeedRole[],
): Promise<void> {
  for (const role of roles) {
    await runtime.query('insert into roles (id, name) values ($1, $2)', [role.id, role.name]);
  }
}

export async function seedUserRoles(
  runtime: PgIntegrationRuntime,
  userRoles: readonly SeedUserRole[],
): Promise<void> {
  for (const ur of userRoles) {
    await runtime.query('insert into user_roles (user_id, role_id, level) values ($1, $2, $3)', [
      ur.userId,
      ur.roleId,
      ur.level,
    ]);
  }
}
