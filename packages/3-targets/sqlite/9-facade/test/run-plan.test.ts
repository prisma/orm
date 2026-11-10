import type { SqlMiddleware } from '@internal/sql-runtime';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../../1-target/test/fixtures/sqlite-contract.d';
import contractJson from '../../1-target/test/fixtures/sqlite-contract.json' with { type: 'json' };
import sqlite from '../src/exports/runtime';
import { contractFromJson } from '../src/exports/static';

const contract = contractFromJson<Contract>(contractJson);

function recordMode(): { readonly middleware: SqlMiddleware; readonly modes: string[] } {
  const modes: string[] = [];
  return {
    modes,
    middleware: {
      name: 'record-mode',
      familyId: 'sql',
      async beforeEncode(_plan, ctx) {
        modes.push(ctx.mode);
      },
    },
  };
}

describe('query and execute on a sqlite client', () => {
  it('run a plan outside a transaction', async () => {
    await using db = sqlite({ contract, path: ':memory:', verifyMarker: false });

    await db.execute(
      db.raw
        .sql`CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL, user_id INTEGER NOT NULL, views INTEGER NOT NULL)`
        .affectedCount()
        .build(),
    );
    const inserted = await db.execute(
      db.raw.sql`INSERT INTO posts (id, title, user_id, views) VALUES (1, 'Hello', 1, 5)`
        .affectedCount()
        .build(),
    );
    const rows = await db.query(db.sql.posts.select('id', 'title').build()).toArray();

    expect(inserted).toEqual({ affectedRows: 1, insertId: '1' });
    expect(rows).toEqual([{ id: 1, title: 'Hello' }]);
  });
});

describe('the mode option', () => {
  it('reaches middleware', async () => {
    const { middleware, modes } = recordMode();
    await using strict = sqlite({
      contract,
      path: ':memory:',
      verifyMarker: false,
      middleware: [middleware],
    });
    await using permissive = sqlite({
      contract,
      path: ':memory:',
      verifyMarker: false,
      middleware: [middleware],
      mode: 'permissive',
    });
    const createPosts = (db: typeof strict) =>
      db.execute(db.raw.sql`CREATE TABLE posts (id INTEGER PRIMARY KEY)`.affectedCount().build());

    await createPosts(strict);
    await createPosts(permissive);

    expect(modes).toEqual(['strict', 'permissive']);
  });
});
