import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { sqliteRawCodecInferer } from '@prisma/orm-sqlite/adapter/adapter';
import { sql } from '@prisma/orm-sqlite/builder/runtime';
import type { Db } from '@prisma/orm-sqlite/builder/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma/orm-sqlite/components/ir';
import type { Runtime, SqlMiddleware } from '@prisma/orm-sqlite/family-runtime';
import { param } from '@prisma/orm-sqlite/relational-core/expression';
import type { SqlParamRefMutator } from '@prisma/orm-sqlite/relational-core/middleware';
import sqlite from '@prisma/orm-sqlite/runtime';
import { contractFromJson } from '@prisma/orm-sqlite/static';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

interface Harness {
  readonly db: Db<Contract>;
  readonly runtime: Runtime;
  readonly close: () => Promise<void>;
}

async function buildHarness(middleware?: readonly SqlMiddleware[]): Promise<Harness> {
  const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8')) as unknown;

  const testDir = mkdtempSync(join(tmpdir(), 'prisma-sqlite-rawsql-'));
  const dbPath = join(testDir, 'test.db');

  const client = sqlite({
    contract: contractFromJson<Contract>(contractJson),
    path: dbPath,
    verifyMarker: false,
    ...(middleware ? { middleware } : {}),
  });
  const contract = client.contract;

  const rawDb = new DatabaseSync(dbPath);
  rawDb.exec('PRAGMA foreign_keys = ON');
  rawDb.exec(`
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
  rawDb
    .prepare('INSERT INTO _prisma_marker (space, core_hash, profile_hash) VALUES (?, ?, ?)')
    .run('app', contract.storage.storageHash, contract.profileHash ?? contract.storage.storageHash);
  rawDb.exec(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      views INTEGER NOT NULL
    )
  `);
  rawDb.exec(`
    INSERT INTO posts (id, title, user_id, views) VALUES
      (1, 'Hello World', 1, 100),
      (2, 'Second Post', 1, 50),
      (3, 'Bobs Post', 2, 200),
      (4, 'Another One', 3, 10)
  `);
  rawDb.close();

  const runtime = await client.connect();

  const db = sql<Contract>({
    context: client.context,
    rawCodecInferer: sqliteRawCodecInferer,
  });

  return {
    db,
    runtime,
    async close() {
      await client.close();
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

describe('e2e: rawSql expression on SQLite', { timeout: timeouts.databaseOperation }, () => {
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(() => {
    cleanup = undefined;
  });

  afterEach(async () => {
    await cleanup?.();
  });

  describe('rawSql expression survives the full pipeline and returns expected rows', () => {
    it('rawSql in aliased select produces correct computed values from the database', async () => {
      const harness = await buildHarness();
      cleanup = harness.close;

      // posts.views values: 100, 50, 200, 10 — doubled they become 200, 100, 400, 20.
      const rows = await harness.runtime.query(
        harness.db[UNBOUND_NAMESPACE_ID].posts
          .select('id')
          .select('doubled', (f, fns) => fns.raw`${f.views} * 2`.returns('sqlite/integer@1'))
          .orderBy('id')
          .build(),
      );

      expect(rows).toHaveLength(4);
      expect(rows.map((r) => r.doubled)).toEqual([200, 100, 400, 20]);
    });

    it('rawSql with a literal scalar expression returns the same value for every row', async () => {
      const harness = await buildHarness();
      cleanup = harness.close;

      const rows = await harness.runtime.query(
        harness.db[UNBOUND_NAMESPACE_ID].posts
          .select('id')
          .select('magic', (_f, fns) => fns.raw`42`.returns('sqlite/integer@1'))
          .orderBy('id')
          .build(),
      );

      expect(rows).toHaveLength(4);
      expect(rows.every((r) => r.magic === 42)).toBe(true);
    });
  });

  describe('ParamRef from rawSql interpolation surfaces in beforeEncode params walk', () => {
    it('param() inside rawSql appears in beforeEncode entries() in canonical order', async () => {
      const capturedEntries: Array<{ codecId: string | undefined; value: unknown }> = [];

      const middleware: SqlMiddleware = {
        name: 'param-capture',
        familyId: 'sql',
        beforeEncode(_plan, _ctx, params?: SqlParamRefMutator) {
          if (!params) return;
          for (const entry of params.entries()) {
            capturedEntries.push({ codecId: entry.codecId, value: entry.value });
          }
        },
      };

      const harness = await buildHarness([middleware]);
      cleanup = harness.close;

      // The where clause embeds a param() inside a rawSql expression.
      // After lowering, the plan carries one ParamRef (value 50, codec sqlite/integer@1).
      // The middleware's beforeEncode should see it via params.entries().
      await harness.runtime.query(
        harness.db[UNBOUND_NAMESPACE_ID].posts
          .select('id')
          .where((_f, fns) =>
            fns.gt(
              fns.raw`${param(50, { codecId: 'sqlite/integer@1' })}`.returns('sqlite/integer@1'),
              fns.raw`0`.returns('sqlite/integer@1'),
            ),
          )
          .build(),
      );

      expect(capturedEntries.length).toBeGreaterThanOrEqual(1);
      const paramEntry = capturedEntries.find((e) => e.codecId === 'sqlite/integer@1');
      expect(paramEntry).toBeDefined();
      expect(paramEntry?.value).toBe(50);
    });

    it('param() count in beforeEncode entries matches the number of param() calls in rawSql', async () => {
      const capturedEntries: Array<{ codecId: string | undefined; value: unknown }> = [];

      const middleware: SqlMiddleware = {
        name: 'param-count-capture',
        familyId: 'sql',
        beforeEncode(_plan, _ctx, params?: SqlParamRefMutator) {
          if (!params) return;
          for (const entry of params.entries()) {
            capturedEntries.push({ codecId: entry.codecId, value: entry.value });
          }
        },
      };

      const harness = await buildHarness([middleware]);
      cleanup = harness.close;

      // Two param() calls: param(10) and param(200).
      await harness.runtime.query(
        harness.db[UNBOUND_NAMESPACE_ID].posts
          .select('id')
          .where((_f, fns) =>
            fns.and(
              fns.gt(
                fns.raw`${param(10, { codecId: 'sqlite/integer@1' })}`.returns('sqlite/integer@1'),
                fns.raw`0`.returns('sqlite/integer@1'),
              ),
              fns.lt(
                fns.raw`${param(200, { codecId: 'sqlite/integer@1' })}`.returns('sqlite/integer@1'),
                fns.raw`1000`.returns('sqlite/integer@1'),
              ),
            ),
          )
          .build(),
      );

      const intEntries = capturedEntries.filter((e) => e.codecId === 'sqlite/integer@1');
      expect(intEntries).toHaveLength(2);
      expect(intEntries.map((e) => e.value).sort()).toEqual([10, 200]);
    });
  });
});
