import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Collection } from '@internal/sql-orm-client';
import type { SqlMiddleware } from '@internal/sql-runtime';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import type { Contract } from '../../1-target/test/fixtures/sqlite-contract.d';
import contractJson from '../../1-target/test/fixtures/sqlite-contract.json' with { type: 'json' };
import sqlite from '../src/exports/runtime';
import { contractFromJson } from '../src/exports/static';

class PostCollection extends Collection<Contract, 'Post'> {
  titled(title: string) {
    return this.where({ title });
  }
}

const directory = mkdtempSync(join(tmpdir(), 'sqlite-transaction-members-'));
const path = join(directory, 'dev.db');
const raw = new DatabaseSync(path);
raw.exec(`
  CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL, user_id INTEGER NOT NULL, views INTEGER NOT NULL);
  INSERT INTO posts (id, title, user_id, views) VALUES (1, 'Hello', 1, 5), (2, 'Other', 1, 5);
`);
raw.close();

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

const contract = contractFromJson<Contract>(contractJson);

function activityTracer(started: Array<{ kind: string; parentKind: string | undefined }>) {
  const kindKey = Symbol('kind');
  const tracer: SqlMiddleware = {
    name: 'tracer',
    familyId: 'sql',
    async activityStarted(activity, ctx) {
      ctx.state(kindKey)['kind'] = activity.kind;
      const parentKind = ctx.parent?.state(kindKey)['kind'];
      started.push({
        kind: activity.kind,
        parentKind: typeof parentKind === 'string' ? parentKind : undefined,
      });
    },
  };
  return tracer;
}

describe('a sqlite transaction', () => {
  it('offers sql, raw, prepare and orm, and runs every statement inside the transaction', async () => {
    const started: Array<{ kind: string; parentKind: string | undefined }> = [];
    const db = sqlite({
      contract,
      path,
      verifyMarker: false,
      middleware: [activityTracer(started)],
      collections: { Post: PostCollection },
    });

    const result = await db.transaction(async (tx) => {
      const ids = await tx.query(tx.sql.posts.select('id').build());
      const updated = await tx.execute(
        tx.raw.sql`UPDATE posts SET views = 0`.affectedCount().build(),
      );
      const byId = await tx.prepare({ id: 'sqlite/integer@1' }, (params) =>
        tx.sql.posts
          .select('id')
          .where((f, fns) => fns.eq(f.id, params.id))
          .build(),
      );
      const prepared = await byId.query(tx, { id: 2 });
      const titled = await tx.orm.Post.titled('Hello').select('id', 'views').all();
      return { ids, updated: updated.affectedRows, prepared, titled };
    });
    await db.close();

    expect({ result, started }).toEqual({
      result: {
        ids: [{ id: 1 }, { id: 2 }],
        updated: 2,
        prepared: [{ id: 2 }],
        titled: [{ id: 1, views: 0 }],
      },
      started: [
        { kind: 'transaction', parentKind: undefined },
        { kind: 'statement', parentKind: 'transaction' },
        { kind: 'statement', parentKind: 'transaction' },
        { kind: 'statement', parentKind: 'transaction' },
        { kind: 'orm-call', parentKind: 'transaction' },
        { kind: 'statement', parentKind: 'orm-call' },
      ],
    });
  });
});

describe('a prepared ORM read on a sqlite transaction', () => {
  it('runs inside the transaction it is given', async () => {
    const started: Array<{ kind: string; parentKind: string | undefined }> = [];
    const db = sqlite({
      contract,
      path,
      verifyMarker: false,
      middleware: [activityTracer(started)],
    });
    const ids = await db.prepare({}, () => db.orm.Post.select('id').prepared.all());

    const rows = await db.transaction(async (tx) => ids.query(tx, {}));
    await db.close();

    expect({ rows, started }).toEqual({
      rows: [{ id: 1 }, { id: 2 }],
      started: [
        { kind: 'transaction', parentKind: undefined },
        { kind: 'orm-call', parentKind: 'transaction' },
        { kind: 'statement', parentKind: 'orm-call' },
      ],
    });
  });
});

describe('the sqlite ORM', () => {
  it('offers fragment on db.orm and tx.orm', async () => {
    const db = sqlite({ contract, path, verifyMarker: false });
    const titledHello = db.orm.fragment(
      { title: { codecId: 'sqlite/text@1', nullable: false } },
      (rows) => rows.where((r) => r.title.eq('Hello')),
    );

    const fromClient = await db.orm.Post.with(titledHello).select('id').all();
    const fromTransaction = await db.transaction(async (tx) => {
      const titledOther = tx.orm.fragment(
        { title: { codecId: 'sqlite/text@1', nullable: false } },
        (rows) => rows.where((r) => r.title.eq('Other')),
      );
      return tx.orm.Post.with(titledOther).select('id').all();
    });
    await db.close();

    expect({ fromClient, fromTransaction }).toEqual({
      fromClient: [{ id: 1 }],
      fromTransaction: [{ id: 2 }],
    });
  });
});
