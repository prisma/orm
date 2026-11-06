import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Collection } from '@internal/sql-orm-client';
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

const directory = mkdtempSync(join(tmpdir(), 'sqlite-collections-'));
const path = join(directory, 'dev.db');
const raw = new DatabaseSync(path);
raw.exec(`
  CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL, user_id INTEGER NOT NULL, views INTEGER NOT NULL);
  INSERT INTO posts (id, title, user_id, views) VALUES (1, 'Hello', 1, 0), (2, 'Other', 1, 0);
`);
raw.close();

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

const contract = contractFromJson<Contract>(contractJson);

describe('a sqlite client with custom collection classes', () => {
  it('runs a class method on db.orm and on tx.orm', async () => {
    const db = sqlite({
      contract,
      path,
      verifyMarker: false,
      collections: { Post: PostCollection },
    });

    const fromClient = await db.orm.Post.titled('Hello').select('id', 'title').all();
    const fromTransaction = await db.transaction(async (tx) =>
      tx.orm.Post.titled('Other').select('id', 'title').all(),
    );
    await db.close();

    expect({ fromClient, fromTransaction }).toEqual({
      fromClient: [{ id: 1, title: 'Hello' }],
      fromTransaction: [{ id: 2, title: 'Other' }],
    });
  });
});

describe('a sqlite client given a class for a model the contract does not have', () => {
  it('rejects it when it is created', () => {
    expect(() => sqlite({ contract, path, collections: { NotAModel: PostCollection } })).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: expect.stringContaining("No model found for custom collection 'NotAModel'"),
      }),
    );
  });
});
