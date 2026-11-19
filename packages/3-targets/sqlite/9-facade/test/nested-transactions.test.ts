import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'pathe';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Contract } from '../../1-target/test/fixtures/sqlite-contract.d';
import contractJson from '../../1-target/test/fixtures/sqlite-contract.json' with { type: 'json' };
import sqlite, { type SqliteTransactionContext } from '../src/exports/runtime';
import { contractFromJson } from '../src/exports/static';

const directory = mkdtempSync(join(tmpdir(), 'sqlite-nested-transactions-'));
const path = join(directory, 'dev.db');
const setup = new DatabaseSync(path);
setup.exec(
  'CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL, user_id INTEGER NOT NULL, views INTEGER NOT NULL)',
);
setup.close();

const db = sqlite({
  contract: contractFromJson<Contract>(contractJson),
  path,
  verifyMarker: false,
});

afterAll(async () => {
  await db.close();
  rmSync(directory, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.execute(db.raw.sql`DELETE FROM posts`.affectedCount().build());
});

const create = (tx: SqliteTransactionContext<Contract>, id: number, title: string) =>
  tx.orm.Post.select('id').create({ id, title, userId: 1, views: 0 });

const titles = async (q: Pick<SqliteTransactionContext<Contract>, 'orm'>) =>
  (
    await q.orm.Post.select('title')
      .orderBy((post) => post.title.asc())
      .all()
  ).map((post) => post.title);

describe('tx.transaction on sqlite', () => {
  it('passes the facade context to the nested callback and commits the work around the nested transaction that threw', async () => {
    let inside: string[] = [];
    await db.transaction(async (tx) => {
      await create(tx, 1, 'A');
      await tx
        .transaction(async (inner) => {
          await create(inner, 2, 'B');
          inside = await titles(inner);
          throw new Error('nope');
        })
        .catch(() => undefined);
      await create(tx, 3, 'C');
    });

    expect({ inside, committed: await titles(db) }).toEqual({
      inside: ['A', 'B'],
      committed: ['A', 'C'],
    });
  });

  it('rolls back the innermost of three nested transactions and commits the middle and outer ones', async () => {
    let inside: string[] = [];
    await db.transaction(async (tx) => {
      await create(tx, 1, 'A');
      await tx.transaction(async (middle) => {
        await create(middle, 2, 'B');
        await middle
          .transaction(async (inner) => {
            await create(inner, 3, 'C');
            inside = await titles(inner);
            throw new Error('nope');
          })
          .catch(() => undefined);
      });
    });

    expect({ inside, committed: await titles(db) }).toEqual({
      inside: ['A', 'B', 'C'],
      committed: ['A', 'B'],
    });
  });
});
