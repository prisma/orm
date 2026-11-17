import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import sqliteAdapter from '@prisma/orm-sqlite/adapter/runtime';
import { sql as sqlBuilder } from '@prisma/orm-sqlite/builder/runtime';
import type { Db } from '@prisma/orm-sqlite/builder/types';
import { instantiateExecutionStack } from '@prisma/orm-sqlite/components/execution';
import { UNBOUND_NAMESPACE_ID } from '@prisma/orm-sqlite/components/ir';
import sqliteDriver from '@prisma/orm-sqlite/driver/runtime';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type Log,
  type Runtime,
} from '@prisma/orm-sqlite/family-runtime';
import { SqliteRuntimeImpl } from '@prisma/orm-sqlite/runtime';
import sqliteTarget, { SqliteContractSerializer } from '@prisma/orm-sqlite/target/runtime';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

interface Harness {
  readonly db: Db<Contract>;
  readonly runtime: Runtime;
  readonly cleanup: () => Promise<void>;
}

async function buildHarness(log: Log): Promise<Harness> {
  const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8')) as unknown;
  const contract = new SqliteContractSerializer().deserializeContract(contractJson) as Contract;

  const testDir = mkdtempSync(join(tmpdir(), 'prisma-sqlite-verify-marker-'));
  const dbPath = join(testDir, 'test.db');

  // Deliberately skip `_prisma_marker` — exercises the
  // attached-to-uninitialised-DB scenario.
  const rawDb = new DatabaseSync(dbPath);
  rawDb.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      invited_by_id INTEGER
    )
  `);
  rawDb.exec(`
    INSERT INTO users (id, name, email, invited_by_id)
    VALUES (1, 'Alice', 'alice@example.com', NULL)
  `);
  rawDb.close();

  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
    extensions: [],
  });

  const stackInstance = instantiateExecutionStack(stack);
  const context = createExecutionContext({ contract, stack });
  const driver = stackInstance.driver;
  if (!driver) throw new Error('SQLite driver missing from execution stack');
  await driver.connect({ kind: 'path', path: dbPath });

  const runtime = new SqliteRuntimeImpl({
    context,
    adapter: stackInstance.adapter,
    driver,
    log,
    closeRefusal: undefined,
  });
  const db = sqlBuilder<Contract>({
    context,
    rawCodecInferer: stack.adapter.rawCodecInferer,
  });

  return {
    db,
    runtime,
    async cleanup() {
      await runtime.close();
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

describe('sqlite runtime verify-marker: missing marker table', {
  timeout: timeouts.databaseOperation,
}, () => {
  let harness: Harness | undefined;

  beforeEach(() => {
    harness = undefined;
  });

  afterEach(async () => {
    if (harness) {
      await harness.cleanup();
    }
  });

  it('logs warn and proceeds when the marker table is absent', async () => {
    const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8')) as unknown;
    const contract = new SqliteContractSerializer().deserializeContract(contractJson) as Contract;
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Log;

    harness = await buildHarness(log);

    const rows = await harness.runtime
      .query(harness.db[UNBOUND_NAMESPACE_ID].users.select('id').build())
      .toArray();

    expect(rows.map((r) => r.id)).toEqual([1]);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith({
      code: 'CONTRACT.MARKER_MISSING',
      scope: 'marker-verification',
      expected: {
        storageHash: contract.storage.storageHash,
        profileHash: contract.profileHash ?? null,
      },
      actual: null,
      message: 'Contract marker not found in database',
    });
  });
});
