import pgvector from '@internal/extension-pgvector/runtime';
import { type AsyncIterableResult, defineAnnotation } from '@internal/framework-components/runtime';
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
  SubqueryExpr,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { SqlMiddleware } from '@internal/sql-runtime';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { Client } from 'pg';
import { expect, expectTypeOf, it, vi } from 'vitest';
import { getTestContract } from './sql-orm-client/helpers';

const annotation = defineAnnotation<{ label: string }>()({
  namespace: 'prepared-boundary',
  applicableTo: ['read'],
});
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
  'prepares ORM predicates and pagination through the Postgres facade with fixed bindings and opaque raw SQL',
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
    const labels: Array<{ label: string } | undefined> = [];
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
            labels.push(annotation.read(plan));
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
      const authored = await db.prepare({ value: { codecId: 'pg/int4@1', nullable: true } }, (p) =>
        db.orm.public.User.where({
          toWhereExpr: () =>
            ExistsExpr.exists(
              SelectAst.from(TableSource.named('users'))
                .withProjection([ProjectionItem.of('id', ColumnRef.of('users', 'id'))])
                .withWhere(
                  CastExpr.as(
                    BinaryExpr.gt(ColumnRef.of('users', 'invited_by_id'), p.value.buildAst()),
                    'boolean',
                  ),
                ),
            ),
        })
          .select('id')
          .prepared.all(),
      );
      expect(executions).toHaveLength(count);
      expect(beforeCompile.mock.calls.length).toBe(compileCount + 1);
      expect(await authored.query(runtime, { value: null })).toEqual([]);
      const nullableStart = executions.length;
      const nullableLowerCount = lower.mock.calls.length;
      const nullableCallback = vi.fn();
      const equal = await db.prepare({ value: { codecId: 'pg/int4@1', nullable: true } }, (p) => {
        nullableCallback();
        return db.orm.public.User.where({ invitedById: p.value })
          .orderBy((user) => user.id.asc())
          .select('id')
          .prepared.all();
      });
      expect(await equal.query(runtime, { value: null })).toEqual([{ id: 3 }]);
      expect(await equal.query(runtime, { value: 9 })).toEqual([{ id: 1 }, { id: 2 }]);
      expect(await equal.query(runtime, { value: 7 })).toEqual([]);
      const nullRows = equal.query(runtime, { value: null })[Symbol.asyncIterator]();
      const valueRows = equal.query(runtime, { value: 9 })[Symbol.asyncIterator]();
      expect(await nullRows.next()).toEqual({ done: false, value: { id: 3 } });
      expect(await valueRows.next()).toEqual({ done: false, value: { id: 1 } });
      expect(await nullRows.next()).toEqual({ done: true, value: undefined });
      expect(await valueRows.next()).toEqual({ done: false, value: { id: 2 } });
      expect(await valueRows.next()).toEqual({ done: true, value: undefined });
      expect(nullableCallback).toHaveBeenCalledOnce();
      expect(lower.mock.calls.length).toBe(nullableLowerCount + 1);
      const nullableSql = executions.slice(nullableStart).map((execution) => execution.sql);
      expect(new Set(nullableSql).size).toBe(1);
      expect(nullableSql[0]).toContain('IS NOT DISTINCT FROM');
      const different = await db.prepare({ value: { codecId: 'pg/int4@1', nullable: true } }, (p) =>
        db.orm.public.User.where((user) => user.invitedById.neq(p.value))
          .orderBy((user) => user.id.asc())
          .select('id')
          .prepared.all(),
      );
      expect(await different.query(runtime, { value: null })).toEqual([{ id: 1 }, { id: 2 }]);
      expect(await different.query(runtime, { value: 9 })).toEqual([{ id: 3 }]);
      expect(await different.query(runtime, { value: 7 })).toEqual([
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ]);
      const nested = await db.prepare(
        {
          value: { codecId: 'pg/int4@1', nullable: true },
          owner: { codecId: 'pg/int4@1', nullable: true },
        },
        (p) =>
          db.orm.public.User.where((user) => user.invitedById.eq(p.value))
            .include('posts', (posts) =>
              posts
                .where((post) => post.userId.eq(p.owner))
                .orderBy((post) => post.id.asc())
                .select('id'),
            )
            .orderBy((user) => user.id.asc())
            .select('id')
            .prepared.first(),
      );
      expect(await nested.query(runtime, { value: 9, owner: 1 })).toEqual({
        id: 1,
        posts: [{ id: 11 }, { id: 12 }],
      });
      expect(await nested.query(runtime, { value: null, owner: null })).toEqual({
        id: 3,
        posts: [],
      });
      expect(await nested.query(runtime, { value: 7, owner: null })).toBeNull();
      const scalar = await db.prepare({ value: { codecId: 'pg/int4@1', nullable: true } }, (p) =>
        db.orm.public.User.where({
          toWhereExpr: () =>
            BinaryExpr.eq(
              ColumnRef.of('users', 'invited_by_id'),
              SubqueryExpr.of(
                SelectAst.from(TableSource.named('users'))
                  .withProjection([ProjectionItem.of('value', p.value.buildAst())])
                  .withLimit(1),
              ),
            ),
        })
          .orderBy((user) => user.id.asc())
          .select('id')
          .prepared.all(),
      );
      expect(await scalar.query(runtime, { value: null })).toEqual([]);
      expect(await scalar.query(runtime, { value: 9 })).toEqual([{ id: 1 }, { id: 2 }]);
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
      const paginationStart = executions.length;
      const lowerCount = lower.mock.calls.length;
      const paginationCallback = vi.fn();
      const paginated = await db.prepare({ take: 'pg/int4@1', skip: 'pg/int4@1' }, (p) => {
        paginationCallback();
        return db.orm.public.User.distinct('id')
          .orderBy((user) => user.id.asc())
          .limit(p.take)
          .offset(p.skip)
          .include('posts', (posts) => {
            const page = posts
              .distinct('id')
              .orderBy((post) => post.id.asc())
              .limit(p.take)
              .offset(p.skip);
            return posts.combine({
              rows: page.select('id'),
              count: posts.limit(2).offset(p.skip).count(),
              sum: page.sum('views'),
            });
          })
          .select('id')
          .prepared.all();
      });
      expect(executions).toHaveLength(paginationStart);
      expect(lower.mock.calls.length).toBe(lowerCount + 1);
      expectTypeOf(paginated.query(runtime, { take: 2, skip: 0 })).toEqualTypeOf<
        AsyncIterableResult<{
          id: number;
          posts: { rows: { id: number }[]; count: number; sum: number | null };
        }>
      >();
      expect(await paginated.query(runtime, { take: 2, skip: 0 })).toEqual([
        { id: 1, posts: { rows: [{ id: 11 }, { id: 12 }], count: 2, sum: 6 } },
        { id: 2, posts: { rows: [{ id: 21 }], count: 1, sum: 6 } },
      ]);
      expect(await paginated.query(runtime, { take: 1, skip: 0 })).toEqual([
        { id: 1, posts: { rows: [{ id: 11 }], count: 2, sum: 5 } },
      ]);
      expect(await paginated.query(runtime, { take: 1, skip: 1 })).toEqual([
        { id: 2, posts: { rows: [], count: 0, sum: null } },
      ]);
      expect(await paginated.query(runtime, { take: 0, skip: 0 })).toEqual([]);
      expect(await paginated.query(runtime, { take: 2, skip: 9 })).toEqual([]);
      const paginationExecutions = executions.slice(paginationStart);
      expect(new Set(paginationExecutions.map((execution) => execution.sql)).size).toBe(1);
      expect(paginationExecutions.map((execution) => execution.params)).toEqual([
        [2, 0],
        [1, 0],
        [1, 1],
        [0, 0],
        [2, 9],
      ]);
      expect(paginationCallback).toHaveBeenCalledOnce();
      expect(lower.mock.calls.length).toBe(lowerCount + 1);
      const left = paginated.query(runtime, { take: 2, skip: 0 })[Symbol.asyncIterator]();
      const right = paginated.query(runtime, { take: 1, skip: 1 })[Symbol.asyncIterator]();
      expect(await left.next()).toEqual({
        done: false,
        value: { id: 1, posts: { rows: [{ id: 11 }, { id: 12 }], count: 2, sum: 6 } },
      });
      expect(await right.next()).toEqual({
        done: false,
        value: { id: 2, posts: { rows: [], count: 0, sum: null } },
      });
      expect(await left.next()).toEqual({
        done: false,
        value: { id: 2, posts: { rows: [{ id: 21 }], count: 1, sum: 6 } },
      });
      expect(await left.next()).toEqual({ done: true, value: undefined });
      expect(await right.next()).toEqual({ done: true, value: undefined });
      expect(lower.mock.calls.length).toBe(lowerCount + 1);
      const annotated = await db.prepare({ id: 'pg/int4@1' }, (p) =>
        db.orm.public.User.where({ id: p.id })
          .select('id')
          .prepared.first(undefined, (meta) => meta.annotate(annotation({ label: 'first' }))),
      );
      expect(await annotated.query(runtime, { id: 1 })).toEqual({ id: 1 });
      expect(labels.at(-1)).toEqual({ label: 'first' });
      await client.query('create extension if not exists vector');
      await client.query('alter table posts add column embedding vector(3)');
      await client.query("update posts set embedding = '[1,2,3]' where id = 11");
      const decoded = await db.prepare({ id: 'pg/int4@1' }, (p) =>
        db.orm.public.User.where({ id: p.id })
          .select('id')
          .include('posts', (posts) =>
            posts.orderBy((post) => post.id.asc()).select('id', 'embedding'),
          )
          .prepared.all(),
      );
      expect(await decoded.query(runtime, { id: 1 })).toEqual([
        {
          id: 1,
          posts: [
            { id: 11, embedding: [1, 2, 3] },
            { id: 12, embedding: null },
          ],
        },
      ]);
      const decodedFirst = await db.prepare({ id: 'pg/int4@1' }, (p) =>
        db.orm.public.Post.select('id', 'embedding').prepared.first({ id: p.id }),
      );
      expectTypeOf(decodedFirst.query(runtime, { id: 11 })).toEqualTypeOf<
        Promise<{ id: number; embedding: number[] | null } | null>
      >();
      expect(await decodedFirst.query(runtime, { id: 11 })).toEqual({
        id: 11,
        embedding: [1, 2, 3],
      });
      expect(await decodedFirst.query(runtime, { id: 999 })).toBeNull();
      await expect(
        db.prepare({ take: 'pg/int4@1' }, (p) =>
          db.orm.public.User.limit(p.take).select('id').prepared.first(),
        ),
      ).rejects.toThrow(/parameter not referenced.*take/i);
    } finally {
      await db.close();
      await client.end();
      await database.close();
    }
  },
  timeouts.spinUpPpgDev,
);
