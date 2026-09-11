import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sqliteAdapter from '@prisma/orm-sqlite/adapter/runtime';
import type { AsyncIterableResult } from '@prisma/orm-sqlite/components/runtime';
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
  TableSource,
} from '@prisma/orm-sqlite/relational-core/ast';
import sqlite from '@prisma/orm-sqlite/runtime';
import { expect, expectTypeOf, it, vi } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };

const lower = vi.fn<(statement: LoweredStatement) => void>();

it('prepares ORM predicates through the public SQLite facade with fixed bindings and opaque raw SQL', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'prepared-orm-predicates-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec(
    "create table users (id integer primary key, invited_by_id integer); create table posts (id integer primary key, user_id integer, title text, views integer); insert into users values (1, 9), (2, 9), (3, null); insert into posts values (11, 1, 'Match', 5), (12, 1, 'Other', 1), (21, 2, 'Match', 6), (31, 3, 'Match', 5)",
  );
  const beforeCompile = vi.fn<NonNullable<SqlMiddleware['beforeCompile']>>(async () => undefined);
  const executions: Array<{ sql: string; params: readonly unknown[] }> = [];
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
    await expect(
      db.prepare({ value: { codecId: 'sqlite/integer@1', nullable: true } }, (p) =>
        db.orm.User.where({
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
  } finally {
    createSpy.mockRestore();
    await db.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
