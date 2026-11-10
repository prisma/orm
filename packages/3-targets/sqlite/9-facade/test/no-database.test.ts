import sqliteDriver from '@internal/driver-sqlite/runtime';
import { Collection } from '@internal/sql-orm-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contract } from '../../1-target/test/fixtures/sqlite-contract.d';
import contractJson from '../../1-target/test/fixtures/sqlite-contract.json' with { type: 'json' };
import sqlite from '../src/exports/runtime';
import sqliteStatic, { contractFromJson } from '../src/exports/static';

class PostCollection extends Collection<Contract, 'Post'> {
  titled(title: string) {
    return this.where({ title });
  }
}

const contract = contractFromJson<Contract>(contractJson);
const collections = { Post: PostCollection };

const selectIds = { sql: 'SELECT "id" AS "id" FROM "posts" LIMIT 10', params: [] };
const resetViews = { sql: 'UPDATE posts SET views = ?1', params: [0] };
const selectTitled = {
  sql: 'SELECT "posts"."id" AS "id" FROM "posts" WHERE "posts"."title" = ?1',
  params: ['Hello'],
};

let driverCreate: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  driverCreate = vi.spyOn(sqliteDriver, 'create');
});

afterEach(() => {
  driverCreate.mockRestore();
});

describe('a sqlite client with no database', () => {
  it('builds and renders plans from sql, raw and orm without a driver', () => {
    const db = sqlite({ contract, collections });

    expect(db.contract.target).toBe('sqlite');
    expect(db.enums).toBeDefined();
    expect(db.toSql(db.sql.posts.select('id').limit(10).build())).toEqual(selectIds);
    expect(db.toSql(db.raw.sql`UPDATE posts SET views = ${0}`.affectedCount().build())).toEqual(
      resetViews,
    );
    expect(db.toSql(db.orm.Post.titled('Hello').select('id').prepared.all().plan)).toEqual(
      selectTitled,
    );
    expect(driverCreate).not.toHaveBeenCalled();
  });
});

describe('a sqlite client given a path', () => {
  it('creates its driver on the first use', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    db.toSql(db.sql.posts.select('id').build());

    expect(driverCreate).not.toHaveBeenCalled();

    db.runtime();
    await db.close();

    expect(driverCreate).toHaveBeenCalledTimes(1);
  });
});

describe('the static entry', () => {
  it('renders plans from sql and raw', () => {
    const db = sqliteStatic({ contract });

    expect(db.toSql(db.sql.posts.select('id').limit(10).build())).toEqual(selectIds);
    expect(db.toSql(db.raw.sql`UPDATE posts SET views = ${0}`.affectedCount().build())).toEqual(
      resetViews,
    );
  });
});
