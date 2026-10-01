import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { JsonValue } from '@prisma/orm-sqlite/adapter/codec-types';
import sqliteAdapter from '@prisma/orm-sqlite/adapter/runtime';
import { type AsyncIterableResult, defineAnnotation } from '@prisma/orm-sqlite/components/runtime';
import type { SqlMiddleware } from '@prisma/orm-sqlite/family-runtime';
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
} from '@prisma/orm-sqlite/relational-core/ast';
import sqlite from '@prisma/orm-sqlite/runtime';
import { expect, expectTypeOf, it, vi } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };

const annotation = defineAnnotation<{ label: string }>()({
  namespace: 'prepared-boundary',
  applicableTo: ['read'],
});
const lower = vi.fn<(statement: LoweredStatement) => void>();

it('prepares ORM predicates and pagination through the public SQLite facade with fixed bindings and opaque raw SQL', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'prepared-orm-predicates-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec(
    "create table users (id integer primary key, invited_by_id integer, name text, email text); create table posts (id integer primary key, user_id integer, title text, views integer); insert into users (id, invited_by_id) values (1, 9), (2, 9), (3, null); insert into posts values (11, 1, 'Match', 5), (12, 1, 'Other', 1), (21, 2, 'Match', 6), (31, 3, 'Match', 5)",
  );
  const beforeCompile = vi.fn<NonNullable<SqlMiddleware['beforeCompile']>>(async () => undefined);
  const executions: Array<{ sql: string; params: readonly unknown[] }> = [];
  const labels: Array<{ label: string } | undefined> = [];
  const create = sqliteAdapter.create;
  const createSpy = vi.spyOn(sqliteAdapter, 'create').mockImplementation((...args) => {
    const adapter = create(...args);
    return {
      ...adapter,
      lower: (...args: Parameters<typeof adapter.lower>) => {
        const result = adapter.lower(...args);
        lower(result);
        return result;
      },
    };
  });
  const db = sqlite<Contract>({
    contractJson,
    path,
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
        first: 'sqlite/integer@1',
        second: 'sqlite/integer@1',
        inviter: 'sqlite/integer@1',
        title: 'sqlite/text@1',
        minViews: 'sqlite/integer@1',
      },
      (p) => {
        callback();
        return db.orm.User.where({ invitedById: p.inviter })
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
      [5, 9, 1, 999, 2, 1, 'Match'],
      [7, 9, 2, 999, 3, 2, 'Match'],
    ]);
    expect(executions[0]?.sql).toBe(executions[1]?.sql);
    expect(lower).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledOnce();
    const terminal = await db.prepare({ id: 'sqlite/integer@1' }, (p) =>
      db.orm.User.select('id').prepared.first({ id: p.id }),
    );
    expect(await terminal.query(runtime, { id: 2 })).toEqual({ id: 2 });
    expect(await terminal.query(runtime, { id: 99 })).toBeNull();
    const count = executions.length;
    const authored = await db.prepare(
      { value: { codecId: 'sqlite/integer@1', nullable: true } },
      (p) =>
        db.orm.User.where({
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
          .orderBy((user) => user.id.asc())
          .select('id')
          .prepared.all(),
    );
    expect(executions).toHaveLength(count);
    expect(await authored.query(runtime, { value: null })).toEqual([]);
    expect(await authored.query(runtime, { value: 9 })).toEqual([]);
    expect(await authored.query(runtime, { value: 7 })).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const nullableStart = executions.length;
    const nullableLowerCount = lower.mock.calls.length;
    const nullableCallback = vi.fn();
    const equal = await db.prepare(
      { value: { codecId: 'sqlite/integer@1', nullable: true } },
      (p) => {
        nullableCallback();
        return db.orm.User.where({ invitedById: p.value })
          .orderBy((user) => user.id.asc())
          .select('id')
          .prepared.all();
      },
    );
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
    expect(nullableSql[0]).toContain(' IS ?');
    const different = await db.prepare(
      { value: { codecId: 'sqlite/integer@1', nullable: true } },
      (p) =>
        db.orm.User.where((user) => user.invitedById.neq(p.value))
          .orderBy((user) => user.id.asc())
          .select('id')
          .prepared.all(),
    );
    expect(await different.query(runtime, { value: null })).toEqual([{ id: 1 }, { id: 2 }]);
    expect(await different.query(runtime, { value: 9 })).toEqual([{ id: 3 }]);
    expect(await different.query(runtime, { value: 7 })).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const nested = await db.prepare(
      {
        value: { codecId: 'sqlite/integer@1', nullable: true },
        owner: { codecId: 'sqlite/integer@1', nullable: true },
      },
      (p) =>
        db.orm.User.where((user) => user.invitedById.eq(p.value))
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
    expect(await nested.query(runtime, { value: null, owner: null })).toEqual({ id: 3, posts: [] });
    expect(await nested.query(runtime, { value: 7, owner: null })).toBeNull();
    const scalar = await db.prepare(
      { value: { codecId: 'sqlite/integer@1', nullable: true } },
      (p) =>
        db.orm.User.where({
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
    const raw = await db.prepare({ value: { codecId: 'sqlite/integer@1', nullable: true } }, (p) =>
      db.orm.User.where({
        toWhereExpr: () =>
          new RawExpr({
            parts: [
              '((CAST(',
              p.value.buildAst(),
              ' AS integer) IS NULL AND users.invited_by_id IS NULL) OR users.invited_by_id = ',
              p.value.buildAst(),
              ')',
            ],
            returns: { codecId: 'sqlite/integer@1', nullable: false },
          }),
      })
        .orderBy((user) => user.id.asc())
        .select('id')
        .prepared.all(),
    );
    expect(await raw.query(runtime, { value: null })).toEqual([{ id: 3 }]);
    expect(await raw.query(runtime, { value: 9 })).toEqual([{ id: 1 }, { id: 2 }]);
    const sql = await db.prepare({ value: { codecId: 'sqlite/integer@1', nullable: true } }, (p) =>
      db.sql.users
        .select('id')
        .where((user, fns) => fns.eq(user.invited_by_id, p.value))
        .build(),
    );
    expect(await sql.query(runtime, { value: null })).toEqual([]);
    const paginationStart = executions.length;
    const lowerCount = lower.mock.calls.length;
    const paginationCallback = vi.fn();
    const paginated = await db.prepare(
      { take: 'sqlite/integer@1', skip: 'sqlite/integer@1' },
      (p) => {
        paginationCallback();
        return db.orm.User.distinct('id')
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
      },
    );
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
      [2, 0, 0, 2, 0, 2, 0],
      [1, 0, 0, 1, 0, 1, 0],
      [1, 1, 1, 1, 1, 1, 1],
      [0, 0, 0, 0, 0, 0, 0],
      [2, 9, 9, 2, 9, 2, 9],
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
    const annotated = await db.prepare({ id: 'sqlite/integer@1' }, (p) =>
      db.orm.User.where({ id: p.id })
        .select('id')
        .prepared.all((meta) => meta.annotate(annotation({ label: 'all' }))),
    );
    expect(await annotated.query(runtime, { id: 1 })).toEqual([{ id: 1 }]);
    expect(labels.at(-1)).toEqual({ label: 'all' });
    database.exec(
      "create table typed_rows (id integer primary key, active integer, created_at text, metadata text, label text); insert into typed_rows values (1, 1, '2024-03-15T10:30:00.000Z', '{\"count\":42}', 'typed')",
    );
    const decoded = await db.prepare({ id: 'sqlite/integer@1' }, (p) =>
      db.orm.TypedRow.select('id', 'createdAt', 'metadata').prepared.first({ id: p.id }),
    );
    expectTypeOf(decoded.query(runtime, { id: 1 })).toEqualTypeOf<
      Promise<{ id: number; createdAt: Date; metadata: JsonValue | null } | null>
    >();
    expect(await decoded.query(runtime, { id: 1 })).toEqual({
      id: 1,
      createdAt: new Date('2024-03-15T10:30:00.000Z'),
      metadata: { count: 42 },
    });
    expect(await decoded.query(runtime, { id: 99 })).toBeNull();
    const grouped = await db.prepare(
      { minimum: 'sqlite/bigintnumber@1', take: 'sqlite/integer@1' },
      (p) =>
        db.orm.Post.groupBy('userId')
          .having((h) => h.count().gte(p.minimum))
          .orderBy((post) => post.userId.asc())
          .limit(p.take)
          .prepared.aggregate((agg) => ({ total: agg.countBigInt(), views: agg.sum('views') })),
    );
    expectTypeOf<ReturnType<typeof grouped.query>>().toEqualTypeOf<
      Promise<Array<{ userId: number; total: bigint; views: number | null }>>
    >();
    expect(await grouped.query(runtime, { minimum: 2, take: 1 })).toEqual([
      { userId: 1, total: 2n, views: 6 },
    ]);
    expect(await grouped.query(runtime, { minimum: 3, take: 1 })).toEqual([]);
    expect(
      await db.orm.Post.groupBy('userId')
        .having((h) => h.count().gte(2))
        .orderBy((post) => post.userId.asc())
        .limit(1)
        .aggregate((agg) => ({ total: agg.countBigInt(), views: agg.sum('views') })),
    ).toEqual([{ userId: 1, total: 2n, views: 6 }]);
    await expect(
      db.prepare({ take: 'sqlite/integer@1' }, (p) =>
        db.orm.User.limit(p.take).select('id').prepared.first(),
      ),
    ).rejects.toThrow(/parameter not referenced.*take/i);
  } finally {
    createSpy.mockRestore();
    await db.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
