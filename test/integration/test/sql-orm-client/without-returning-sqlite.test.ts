import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { sqliteAdapterCapabilities } from '@internal/adapter-sqlite/adapter';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { orm } from '@internal/sql-orm-client';
import {
  activitySource,
  createExecutionContext,
  createSqlExecutionStack,
  delegatingActivitySource,
  type SqlMiddleware,
} from '@internal/sql-runtime';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import { contractFromJson } from '@internal/sqlite/static';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { InternalError } from '@internal/utils/internal-error';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/without-returning-sqlite/generated/contract';
import contractJson from './fixtures/without-returning-sqlite/generated/contract.json' with {
  type: 'json',
};

/**
 * The ORM's writes on a contract emitted against an adapter that reports neither `returning` nor `insertOnConflictTarget`, as MySQL's does: every write that returns rows runs the write, then reads the rows back by key.
 */

const schema = `
  create table users (id integer primary key autoincrement, email text not null unique, name text not null);
  create table posts (id integer primary key autoincrement, title text not null, author_id integer not null references users(id));
  create table accounts (id integer primary key autoincrement, email text not null unique, handle text not null unique);
  create table tags (code text primary key, label text not null);
  create table badges (id text primary key default (lower(hex(randomblob(16)))), label text not null, user_id integer not null references users(id));
  create table tokens (id text primary key default (lower(hex(randomblob(16)))), label text not null);
`;

interface Harness {
  readonly db: ReturnType<typeof orm<Contract>>[typeof UNBOUND_NAMESPACE_ID];
  readonly database: DatabaseSync;
  readonly statements: string[];
}

const {
  returning: _returning,
  insertOnConflictTarget: _target,
  ...sqlCapabilities
} = sqliteAdapterCapabilities.sql;
const adapterWithoutReturning = { ...sqliteAdapter, capabilities: { sql: sqlCapabilities } };

async function withDatabase(
  run: (harness: Harness) => Promise<void>,
  middleware: readonly SqlMiddleware[] = [],
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'pn-sqlite-without-returning-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec(schema);
  const statements: string[] = [];
  const record = async (plan: { readonly sql: string }) => {
    statements.push(plan.sql);
    return undefined;
  };
  const recorder: SqlMiddleware = {
    name: 'statement-recorder',
    async activityStarted(activity) {
      if (activity.kind === 'transaction') statements.push('BEGIN');
    },
    intercept: { onQuery: record, onExecute: record },
  };
  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: adapterWithoutReturning,
    driver: sqliteDriver,
  });
  const context = createExecutionContext({
    contract: contractFromJson<Contract>(contractJson),
    stack,
  });
  const instance = instantiateExecutionStack(stack);
  const { adapter, driver } = instance;
  if (adapter === undefined || driver === undefined) {
    throw new InternalError('SQLite execution stack is missing its adapter or driver');
  }
  await driver.connect({ kind: 'path', path });
  const runtime = new SqliteRuntimeImpl({
    context,
    adapter,
    driver,
    middleware: [recorder, ...middleware],
    closeRefusal: undefined,
  });
  try {
    const db = orm({
      context,
      runtime: {
        query: (plan) => runtime.query(plan),
        execute: (plan) => runtime.execute(plan),
        connection: () => runtime.connection(),
        [activitySource]: delegatingActivitySource(() => runtime),
      },
    });
    await run({ db: db[UNBOUND_NAMESPACE_ID], database, statements });
  } finally {
    await runtime.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function rowsOf(database: DatabaseSync, table: string): unknown[] {
  return database.prepare(`select * from ${table} order by 1`).all();
}

const ada = { email: 'ada@example.com', name: 'Ada' };
const grace = { email: 'grace@example.com', name: 'Grace' };

describe('integration/ORM writes without RETURNING on sqlite', () => {
  it('create() inserts without RETURNING and reads the row back by the id the database generated', async () => {
    await withDatabase(async ({ db, statements }) => {
      expect(await db.User.create(ada)).toEqual({ id: 1, ...ada });
      expect(statements).toEqual([
        'BEGIN',
        'INSERT INTO "users" ("email", "name") VALUES (?1, ?2)',
        'SELECT "users"."email" AS "email", "users"."id" AS "id", "users"."name" AS "name", "users"."id" AS "__written_key_id" FROM "users" WHERE "users"."id" = ?1',
      ]);
    });
  });

  it('create() reads a row with a client-supplied key back by that key', async () => {
    await withDatabase(async ({ db }) => {
      expect(await db.Tag.create({ code: 'orm', label: 'ORM' })).toEqual({
        code: 'orm',
        label: 'ORM',
      });
    });
  });

  it('create() with includes reads the row back with them', async () => {
    await withDatabase(async ({ db }) => {
      expect(await db.User.include('posts').create(ada)).toEqual({ id: 1, ...ada, posts: [] });
    });
  });

  it('createAll() returns every row when the client supplies their keys', async () => {
    await withDatabase(async ({ db }) => {
      expect(
        await db.Tag.createAll([
          { code: 'a', label: 'A' },
          { code: 'b', label: 'B' },
        ]),
      ).toEqual([
        { code: 'a', label: 'A' },
        { code: 'b', label: 'B' },
      ]);
    });
  });

  it('createAll() returns the rows in the order it was given them, not in key order', async () => {
    await withDatabase(async ({ db }) => {
      expect(
        await db.Tag.createAll([
          { code: 'c', label: 'C' },
          { code: 'b', label: 'B' },
          { code: 'a', label: 'A' },
        ]),
      ).toEqual([
        { code: 'c', label: 'C' },
        { code: 'b', label: 'B' },
        { code: 'a', label: 'A' },
      ]);
    });
  });

  it('createAll() of one row reads back its generated id', async () => {
    await withDatabase(async ({ db }) => {
      expect(await db.User.createAll([ada])).toEqual([{ id: 1, ...ada }]);
    });
  });

  it('refuses createAll() of several rows whose ids the database generates, before running, and counts them with createAndCount()', async () => {
    await withDatabase(async ({ db, database, statements }) => {
      expect(() => db.User.createAll([ada, grace])).toThrow(
        expect.objectContaining({
          code: 'ORM.CAPABILITY_MISSING',
          message:
            'createAll() on model "User" cannot return the rows it inserts: their key column "id" is generated, and without capability "returning" the database reports a generated value only for a one-row insert. Use createAndCount(), or create() for each row.',
        }),
      );
      expect(statements).toEqual([]);
      expect(await db.User.createAndCount([ada, grace])).toBe(2);
      expect(rowsOf(database, 'users')).toEqual([
        { id: 1, ...ada },
        { id: 2, ...grace },
      ]);
    });
  });

  it('refuses create() before running when a key column gets a database default other than auto-increment', async () => {
    await withDatabase(async ({ db, database, statements }) => {
      await expect(db.Token.create({ label: 'x' })).rejects.toMatchObject({
        code: 'ORM.CAPABILITY_MISSING',
        message:
          'create() on model "Token" cannot find the row it inserts: key column "id" gets no value from the client and is not an auto-increment column, and the contract does not report capability "returning" to read the value the database chose. Supply the key, or give the column a client-side default.',
      });
      expect({ statements, tokens: rowsOf(database, 'tokens') }).toEqual({
        statements: [],
        tokens: [],
      });
      expect(await db.Token.create({ id: 't1', label: 'x' })).toEqual({ id: 't1', label: 'x' });
    });
  });

  it('refuses a nested create before running when a child key column gets a database default other than auto-increment', async () => {
    await withDatabase(async ({ db, database, statements }) => {
      await expect(
        db.User.create({ ...ada, badges: (badges) => badges.create([{ label: 'First' }]) }),
      ).rejects.toMatchObject({
        code: 'ORM.CAPABILITY_MISSING',
        message: expect.stringContaining(
          'create() on model "Badge" cannot find the row it inserts',
        ),
      });
      expect(statements).toEqual([]);
      const { id } = await db.User.create(ada);
      statements.length = 0;
      await expect(
        db.User.where({ id }).update({ badges: (badges) => badges.create([{ label: 'First' }]) }),
      ).rejects.toMatchObject({ code: 'ORM.CAPABILITY_MISSING' });
      expect({ statements, users: rowsOf(database, 'users').length }).toEqual({
        statements: [],
        users: 1,
      });
    });
  });

  it('a nested create passes the parent id the database generated to its children', async () => {
    await withDatabase(async ({ db }) => {
      const created = await db.User.include('posts', (post) => post.select('title')).create({
        ...ada,
        posts: (posts) => posts.create([{ title: 'First' }, { title: 'Second' }]),
      });
      expect(created).toEqual({
        id: 1,
        ...ada,
        posts: [{ title: 'First' }, { title: 'Second' }],
      });
    });
  });

  it('a nested create of a parent links the child to the id the database generated', async () => {
    await withDatabase(async ({ db, database }) => {
      expect(
        await db.Post.create({ title: 'Hello', author: (author) => author.create(ada) }),
      ).toEqual({ id: 1, title: 'Hello', authorId: 1 });
      expect(rowsOf(database, 'users')).toEqual([{ id: 1, ...ada }]);
    });
  });

  it('update() runs without RETURNING and reads the row back by its key', async () => {
    await withDatabase(async ({ db }) => {
      const { id } = await db.User.create(ada);
      expect(await db.User.where({ id }).update({ name: 'Ada L.' })).toEqual({
        id,
        email: ada.email,
        name: 'Ada L.',
      });
      expect(await db.User.where({ id: 99 }).update({ name: 'Nobody' })).toBeNull();
    });
  });

  it('update() that sets a key column reads the row back by its new key', async () => {
    await withDatabase(async ({ db }) => {
      await db.Tag.create({ code: 'old', label: 'Old' });
      expect(await db.Tag.where({ code: 'old' }).update({ code: 'new' })).toEqual({
        code: 'new',
        label: 'Old',
      });
    });
  });

  it('a nested update reads the row back by its key', async () => {
    await withDatabase(async ({ db }) => {
      const { id } = await db.User.create(ada);
      expect(
        await db.User.where({ id })
          .include('posts', (post) => post.select('title'))
          .update({ name: 'Ada L.', posts: (posts) => posts.create([{ title: 'Note' }]) }),
      ).toEqual({ id, email: ada.email, name: 'Ada L.', posts: [{ title: 'Note' }] });
    });
  });

  it('updateAll() writes with the caller filter and reads the written rows back by key', async () => {
    await withDatabase(async ({ db, statements }) => {
      await db.User.createAndCount([ada, grace, { email: 'edsger@example.com', name: 'Edsger' }]);
      statements.length = 0;
      expect(
        await db.User.where((user) => user.id.lte(2))
          .orderBy((user) => user.id.asc())
          .updateAll({ name: 'Pioneer' }),
      ).toEqual([
        { id: 1, email: ada.email, name: 'Pioneer' },
        { id: 2, email: grace.email, name: 'Pioneer' },
      ]);
      expect(statements).toEqual([
        'BEGIN',
        'SELECT "users"."id" AS "id" FROM "users" WHERE "users"."id" <= ?1 ORDER BY "users"."id" ASC',
        'UPDATE "users" SET "name" = ?1 WHERE "users"."id" <= ?2',
        'SELECT "users"."email" AS "email", "users"."id" AS "id", "users"."name" AS "name" FROM "users" WHERE "users"."id" IN (?1, ?2)',
      ]);
      expect(await db.User.where({ name: 'Pioneer' }).updateAndCount({ name: 'P' })).toBe(2);
    });
  });

  it('delete() and deleteAll() read the rows before deleting them', async () => {
    await withDatabase(async ({ db, database }) => {
      await db.User.createAndCount([ada, grace, { email: 'edsger@example.com', name: 'Edsger' }]);
      expect(await db.User.where({ id: 1 }).delete()).toEqual({ id: 1, ...ada });
      expect(await db.User.where((user) => user.id.gte(2)).deleteAll()).toEqual([
        { id: 2, ...grace },
        { id: 3, email: 'edsger@example.com', name: 'Edsger' },
      ]);
      expect(rowsOf(database, 'users')).toEqual([]);
      expect(await db.User.where({ id: 1 }).delete()).toBeNull();
    });
  });

  it('refuses upsert() when the create values can collide on another unique key', async () => {
    await withDatabase(async ({ db, statements }) => {
      await expect(
        db.Account.upsert({
          create: { email: 'a@example.com', handle: 'a' },
          update: { handle: 'b' },
          conflictOn: { email: 'a@example.com' },
        }),
      ).rejects.toMatchObject({
        code: 'ORM.CAPABILITY_MISSING',
        message:
          'upsert() on model "Account" requires contract capability "insertOnConflictTarget": without it the conflict clause applies to every unique key, and the create values can also collide on (handle), which would update a row other than the one conflictOn names.',
      });
      expect(statements).toEqual([]);
    });
  });

  it('refuses upsert() whose update sets a conflict column, or whose create leaves one out', async () => {
    await withDatabase(async ({ db }) => {
      await expect(
        db.User.upsert({
          create: ada,
          update: { email: 'new@example.com' },
          conflictOn: { email: ada.email },
        }),
      ).rejects.toMatchObject({
        code: 'ORM.CAPABILITY_MISSING',
        message:
          'upsert() on model "User" updates conflict column "email"; without capability "returning" the row is read back by the create\'s values for the conflict columns.',
      });
      await expect(
        db.User.upsert({ create: ada, update: { name: 'x' }, conflictOn: { id: 1 } }),
      ).rejects.toMatchObject({ code: 'ORM.CAPABILITY_MISSING' });
    });
  });

  it('createAll() with onConflict "skip" and conflictOn requires insertOnConflictTarget, and without conflictOn needs returning to return rows', async () => {
    await withDatabase(async ({ db, database }) => {
      await db.User.create(ada);
      expect(() => db.User.createAll([ada], { onConflict: 'skip', conflictOn: ['email'] })).toThrow(
        expect.objectContaining({
          code: 'ORM.CAPABILITY_MISSING',
          message:
            'createAll() requires contract capability "insertOnConflictTarget". Re-emit the contract against an adapter that reports it.',
        }),
      );
      expect(() => db.User.createAll([ada], { onConflict: 'skip' })).toThrow(
        expect.objectContaining({ code: 'ORM.CAPABILITY_MISSING' }),
      );
      expect(await db.User.createAndCount([ada, grace], { onConflict: 'skip' })).toBe(1);
      expect(database.prepare('select email from users order by id').all()).toEqual([
        { email: ada.email },
        { email: grace.email },
      ]);
    });
  });

  it('a create fails with ORM.MUTATION_ROW_MISSING and rolls back when a middleware answers its insert without an insert id', async () => {
    const answersPostInserts: SqlMiddleware = {
      name: 'answers-post-inserts',
      intercept: {
        async onExecute(plan) {
          return plan.sql.startsWith('INSERT INTO "posts"')
            ? { stats: { affectedRows: 1 } }
            : undefined;
        },
      },
    };
    await withDatabase(
      async ({ db, database }) => {
        await expect(
          db.Post.create({ title: 'Hello', author: (author) => author.create(ada) }),
        ).rejects.toMatchObject({
          code: 'ORM.MUTATION_ROW_MISSING',
          message:
            'create() for model "Post" cannot find the row it inserted: the insert\'s result carried no insert id for key column "id". A middleware may have answered the statement in place of the database without one.',
          meta: expect.objectContaining({ phase: 'insert-id', column: 'id', affectedRows: 1 }),
        });
        expect(rowsOf(database, 'users')).toEqual([]);
        const { id } = await db.User.create(ada);
        await expect(
          db.Post.include('author').create({ title: 'Hello', authorId: id }),
        ).rejects.toMatchObject({
          code: 'ORM.MUTATION_ROW_MISSING',
          meta: expect.objectContaining({ phase: 'insert-id' }),
        });
        expect(rowsOf(database, 'posts')).toEqual([]);
      },
      [answersPostInserts],
    );
  });
});
