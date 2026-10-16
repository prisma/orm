import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sql as sqlBuilder } from '@prisma/orm-sqlite/builder/runtime';
import type { Db } from '@prisma/orm-sqlite/builder/types';
import type { Contract } from '@prisma/orm-sqlite/contract/types';
import type { SqlStorage } from '@prisma/orm-sqlite/family-contract/types';
import type { Runtime } from '@prisma/orm-sqlite/family-runtime';
import { orm } from '@prisma/orm-sqlite/orm-client';
import sqlite from '@prisma/orm-sqlite/runtime';

export interface SqliteTestContext<TContract extends Contract<SqlStorage>> {
  readonly db: Db<TContract>;
  readonly runtime: Runtime;
  readonly ormClient: ReturnType<typeof orm<TContract>>;
  readonly rawDb: DatabaseSync;
}

export async function withSqliteTestRuntime<TContract extends Contract<SqlStorage>>(
  contractJsonPath: string,
  callback: (ctx: SqliteTestContext<TContract>) => Promise<void>,
): Promise<void> {
  const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8')) as unknown;

  const testDir = mkdtempSync(join(tmpdir(), 'prisma-sqlite-e2e-'));
  const dbPath = join(testDir, 'test.db');

  const rawDb = new DatabaseSync(dbPath);
  rawDb.exec('PRAGMA foreign_keys = ON');

  try {
    const client = sqlite<TContract>({ contractJson, path: dbPath });
    createSchema(rawDb, client.contract);
    seedData(rawDb);

    const runtime = await client.connect();
    const context = client.context;

    try {
      const db = sqlBuilder<TContract>({
        context,
        rawCodecInferer: client.stack.adapter.rawCodecInferer,
      });
      const ormClient = orm({ context, runtime });

      await callback({ db, runtime, ormClient, rawDb });
    } finally {
      await client.close();
    }
  } finally {
    rawDb.close();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

export function createSchema<TContract extends Contract<SqlStorage>>(
  db: DatabaseSync,
  contract: TContract,
): void {
  db.exec(`
    CREATE TABLE _prisma_marker (
      space TEXT NOT NULL PRIMARY KEY DEFAULT 'app',
      core_hash TEXT NOT NULL,
      profile_hash TEXT NOT NULL,
      contract_json TEXT,
      canonical_version INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      app_tag TEXT,
      meta TEXT NOT NULL DEFAULT '{}',
      invariants TEXT NOT NULL DEFAULT '[]'
    )
  `);
  db.prepare('INSERT INTO _prisma_marker (space, core_hash, profile_hash) VALUES (?, ?, ?)').run(
    'app',
    contract.storage.storageHash,
    contract.profileHash ?? contract.storage.storageHash,
  );

  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      invited_by_id INTEGER
    )
  `);
  db.exec(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      views INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE comments (
      id INTEGER PRIMARY KEY,
      body TEXT NOT NULL,
      post_id INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE profiles (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      bio TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE typed_rows (
      id INTEGER PRIMARY KEY,
      active INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      metadata TEXT,
      label TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE items (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'unnamed'
    )
  `);
}

export function seedData(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO users (id, name, email, invited_by_id) VALUES
      (1, 'Alice', 'alice@example.com', NULL),
      (2, 'Bob', 'bob@example.com', 1),
      (3, 'Charlie', 'charlie@example.com', 1),
      (4, 'Diana', 'diana@example.com', 2)
  `);
  db.exec(`
    INSERT INTO posts (id, title, user_id, views) VALUES
      (1, 'Hello World', 1, 100),
      (2, 'Second Post', 1, 50),
      (3, 'Bobs Post', 2, 200),
      (4, 'Another One', 3, 10)
  `);
  db.exec(`
    INSERT INTO comments (id, body, post_id) VALUES
      (1, 'Great post!', 1),
      (2, 'Nice work', 1),
      (3, 'Interesting', 3)
  `);
  db.exec(`
    INSERT INTO profiles (id, user_id, bio) VALUES
      (1, 1, 'Alice bio'),
      (2, 2, 'Bob bio')
  `);
}
