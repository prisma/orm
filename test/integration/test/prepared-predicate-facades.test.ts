import pgvector from '@internal/extension-pgvector/runtime';
import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import postgres from '@internal/postgres/runtime';
import {
  BinaryExpr,
  CastExpr,
  ColumnRef,
  ExistsExpr,
  type LoweredStatement,
  ProjectionItem,
  RawExpr,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { SqlMiddleware } from '@internal/sql-runtime';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { Client } from 'pg';
import { expect, expectTypeOf, it, vi } from 'vitest';
import { getTestContract } from './sql-orm-client/helpers';

const lower = vi.hoisted(() => vi.fn<(statement: LoweredStatement) => void>());
vi.mock('@internal/adapter-postgres/runtime', async (importOriginal) => {
  const original = await importOriginal<typeof import('@internal/adapter-postgres/runtime')>();
  return {
    ...original,
    default: {
      ...original.default,
      create: (...args: Parameters<typeof original.default.create>) => {
        const adapter = original.default.create(...args);
        return {
          ...adapter,
          lower: (...args: Parameters<typeof adapter.lower>) => {
            const result = adapter.lower(...args);
            lower(result);
            return result;
          },
        };
      },
    },
  };
});

it(
  'prepares ORM predicates through the Postgres facade with fixed bindings and opaque raw SQL',
  async () => {
    const database = await createDevDatabase({ databaseIdleTimeoutMillis: timeouts.spinUpPpgDev });
    const client = new Client({ connectionString: database.connectionString });
    await client.connect();
    await client.query(
      'create table users (id int4 primary key, name text, email text, invited_by_id int4, address jsonb); create table posts (id int4 primary key, user_id int4, title text, views int4)',
    );
    await client.query(
      "insert into users (id, invited_by_id) values (1, 9), (2, 9), (3, null); insert into posts values (11, 1, 'Match', 5), (12, 1, 'Other', 1), (21, 2, 'Match', 6), (31, 3, 'Match', 5)",
    );
    const beforeCompile = vi.fn<NonNullable<SqlMiddleware['beforeCompile']>>(async () => undefined);
    const executions: Array<{ sql: string; params: readonly unknown[] }> = [];
    const db = postgres({
      contract: getTestContract(),
      pg: client,
      extensions: [pgvector],
      verifyMarker: false,
      middleware: [
        {
          name: 'record',
          beforeCompile,
          beforeQuery(plan) {
            executions.push({ sql: plan.sql, params: plan.params });
          },
        },
      ],
    });
    try {
      const runtime = await db.connect();
      const callback = vi.fn();
      const query = await db.prepare(
        {
          first: 'pg/int4@1',
          second: 'pg/int4@1',
          inviter: 'pg/int4@1',
          title: 'pg/text@1',
          minViews: 'pg/int4@1',
        },
        (p) => {
          callback();
          return db.orm.public.User.where({ invitedById: p.inviter })
            .where((user) => user.id.in([p.first, 999, p.second, p.first]))
            .where((user) => user.posts.some({ title: p.title }))
            .include('posts', (posts) =>
              posts
                .where((post) => post.views.gte(p.minViews))
                .orderBy((post) => post.id.asc())
                .select('id'),
            )
            .orderBy((user) => user.id.asc())
            .select('id')
            .prepared.all();
        },
      );
      expectTypeOf(
        query.query(runtime, { first: 1, second: 2, inviter: 9, title: 'Match', minViews: 5 }),
      ).toEqualTypeOf<AsyncIterableResult<{ id: number; posts: { id: number }[] }>>();
      expect(callback).toHaveBeenCalledOnce();
      expect(beforeCompile).toHaveBeenCalledOnce();
      expect(lower).toHaveBeenCalledOnce();
      expect(executions).toEqual([]);
      const first = { first: 1, second: 2, inviter: 9, title: 'Match', minViews: 5 };
      const second = { first: 2, second: 3, inviter: 9, title: 'Match', minViews: 7 };
      expect(await query.query(runtime, first)).toEqual([
        { id: 1, posts: [{ id: 11 }] },
        { id: 2, posts: [{ id: 21 }] },
      ]);
      expect(await query.query(runtime, second)).toEqual([{ id: 2, posts: [] }]);
      expect(executions.map((execution) => execution.params)).toEqual([
        [5, 9, 1, 999, 2, 'Match'],
        [7, 9, 2, 999, 3, 'Match'],
      ]);
      expect(executions[0]?.sql).toBe(executions[1]?.sql);
      expect(lower).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledOnce();
      const terminal = await db.prepare({ id: 'pg/int4@1' }, (p) =>
        db.orm.public.User.select('id').prepared.first({ id: p.id }),
      );
      expect(await terminal.query(runtime, { id: 2 })).toEqual({ id: 2 });
      expect(await terminal.query(runtime, { id: 99 })).toBeNull();
      const count = executions.length;
      const compileCount = beforeCompile.mock.calls.length;
      await expect(
        db.prepare({ value: { codecId: 'pg/int4@1', nullable: true } }, (p) =>
          db.orm.public.User.where({
            toWhereExpr: () =>
              ExistsExpr.exists(
                SelectAst.from(TableSource.named('users'))
                  .withProjection([ProjectionItem.of('id', ColumnRef.of('users', 'id'))])
                  .withWhere(
                    CastExpr.as(
                      BinaryExpr.eq(ColumnRef.of('users', 'invited_by_id'), p.value.buildAst()),
                      'boolean',
                    ),
                  ),
              ),
          })
            .select('id')
            .prepared.all(),
        ),
      ).rejects.toThrow(/nullable prepared parameter/i);
      expect(executions).toHaveLength(count);
      expect(beforeCompile.mock.calls.length).toBe(compileCount);
      const raw = await db.prepare({ value: { codecId: 'pg/int4@1', nullable: true } }, (p) =>
        db.orm.public.User.where({
          toWhereExpr: () =>
            new RawExpr({
              parts: [
                '((CAST(',
                p.value.buildAst(),
                ' AS integer) IS NULL AND users.invited_by_id IS NULL) OR users.invited_by_id = ',
                p.value.buildAst(),
                ')',
              ],
              returns: { codecId: 'pg/bool@1', nullable: false },
            }),
        })
          .orderBy((user) => user.id.asc())
          .select('id')
          .prepared.all(),
      );
      expect(await raw.query(runtime, { value: null })).toEqual([{ id: 3 }]);
      expect(await raw.query(runtime, { value: 9 })).toEqual([{ id: 1 }, { id: 2 }]);
      const sql = await db.prepare({ value: { codecId: 'pg/int4@1', nullable: true } }, (p) =>
        db.sql.public.users
          .select('id')
          .where((user, fns) => fns.eq(user.invited_by_id, p.value))
          .build(),
      );
      expect(await sql.query(runtime, { value: null })).toEqual([]);
    } finally {
      await db.close();
      await client.end();
      await database.close();
    }
  },
  timeouts.spinUpPpgDev,
);
