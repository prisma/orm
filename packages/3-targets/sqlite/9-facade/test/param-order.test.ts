import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Contract } from '../../1-target/test/fixtures/sqlite-contract.d';
import contractJson from '../../1-target/test/fixtures/sqlite-contract.json' with { type: 'json' };
import sqlite from '../src/exports/runtime';
import { contractFromJson } from '../src/exports/static';

const contract = contractFromJson<Contract>(contractJson);

function createClient() {
  return sqlite({ contract, path: ':memory:', verifyMarker: false });
}

type Client = ReturnType<typeof createClient>;

async function seed(db: Client): Promise<void> {
  const statements = [
    db.raw
      .sql`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, invited_by_id INTEGER)`,
    db.raw
      .sql`CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL, user_id INTEGER NOT NULL, views INTEGER NOT NULL)`,
    db.raw
      .sql`INSERT INTO users (id, email, name) VALUES (1, 'ada@example.com', 'Ada'), (2, 'bob@example.com', 'Bob'), (3, 'cy@example.com', 'Ada')`,
    db.raw
      .sql`INSERT INTO posts (id, title, user_id, views) VALUES (1, 'a', 1, 10), (2, 'b', 1, 1), (3, 'c', 2, 10), (4, 'd', 3, 10)`,
  ];
  for (const statement of statements) {
    await db.execute(statement.affectedCount().build());
  }
}

describe('parameters bind to the placeholder they belong to on SQLite', () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient();
    await seed(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('binds a join condition parameter and a where parameter', async () => {
    const rows = await db
      .query(
        db.sql.posts
          .innerJoin(db.sql.users, (f, fns) =>
            fns.and(fns.eq(f.posts.user_id, f.users.id), fns.eq(f.users.name, 'Ada')),
          )
          .select('title', 'name')
          .where((f, fns) => fns.gt(f.posts.views, 5))
          .orderBy('title')
          .build(),
      )
      .toArray();

    expect(rows).toEqual([
      { title: 'a', name: 'Ada' },
      { title: 'd', name: 'Ada' },
    ]);
  });

  it('binds a derived join source parameter and a where parameter', async () => {
    const popular = db.sql.posts
      .select('user_id', 'title')
      .where((f, fns) => fns.gt(f.views, 5))
      .as('popular');
    const rows = await db
      .query(
        db.sql.users
          .innerJoin(popular, (f, fns) => fns.eq(f.users.id, f.popular.user_id))
          .select('name', 'title')
          .where((f, fns) => fns.eq(f.users.email, 'ada@example.com'))
          .build(),
      )
      .toArray();

    expect(rows).toEqual([{ name: 'Ada', title: 'a' }]);
  });

  it('binds a group by parameter and a having parameter', async () => {
    const rows = await db
      .query(
        db.sql.posts
          .select('popular', (f, fns) => fns.gt(f.views, 5))
          .select('total', (_f, fns) => fns.count())
          .groupBy((f, fns) => fns.gt(f.views, 5))
          .having((_f, fns) => fns.gt(fns.count(), 2))
          .build(),
      )
      .toArray();

    expect(rows).toEqual([{ popular: 1, total: 3 }]);
  });

  it('binds a distinct-wrapped where parameter and an include where parameter', async () => {
    const rows = await db.orm.User.where({ email: 'ada@example.com' })
      .distinct('name')
      .select('name')
      .include('posts', (posts) => posts.where((post) => post.views.gt(5)).select('title'))
      .all();

    expect(rows).toEqual([{ name: 'Ada', posts: [{ title: 'a' }] }]);
  });
});
