import { DatabaseSync } from 'node:sqlite';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { describe, expect, it } from 'vitest';
import { SqliteControlAdapter } from '../src/core/control-adapter';

interface CapturedCall {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function createCapturingDriver(rows: Record<string, unknown>[] = []) {
  const calls: CapturedCall[] = [];
  return {
    familyId: 'sql' as const,
    targetId: 'sqlite' as const,
    async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      calls.push({ sql, params: params ?? [] });
      return { rows: rows as Row[] };
    },
    async close() {},
    calls,
  };
}

function createMemoryDriver() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return {
    familyId: 'sql' as const,
    targetId: 'sqlite' as const,
    async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...((params ?? []) as Array<string | number | null>)) as Row[];
      return { rows };
    },
    async close() {
      db.close();
    },
  };
}

describe('SqliteControlAdapter marker/ledger write lowering', () => {
  const adapter = new SqliteControlAdapter(createSqliteBuiltinCodecLookup());

  it('insertMarker lowers to a plain insert with DB-side updated_at', async () => {
    const driver = createCapturingDriver();
    await adapter.insertMarker(driver, 'app', {
      storageHash: 'core',
      profileHash: 'prof',
    });

    const { sql, params } = driver.calls[0]!;
    expect(sql).toBe(
      'INSERT INTO "_prisma_marker" ("space", "core_hash", "profile_hash", "contract_json", ' +
        '"canonical_version", "updated_at", "app_tag", "meta", "invariants") ' +
        "VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)",
    );
    expect(sql).not.toContain('ON CONFLICT');
    expect(params[0]).toBe('app');
    expect(params[1]).toBe('core');
    expect(params[2]).toBe('prof');
  });

  it('initMarker lowers to an upsert keyed on space with DB-side updated_at', async () => {
    const driver = createCapturingDriver();
    await adapter.initMarker(driver, 'app', {
      storageHash: 'core',
      profileHash: 'prof',
      invariants: ['inv-a', 'inv-b'],
    });

    const { sql, params } = driver.calls[0]!;
    expect(sql).toBe(
      'INSERT INTO "_prisma_marker" ("space", "core_hash", "profile_hash", "contract_json", ' +
        '"canonical_version", "updated_at", "app_tag", "meta", "invariants") ' +
        "VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?) " +
        'ON CONFLICT ("space") DO UPDATE SET "core_hash" = excluded."core_hash", ' +
        '"profile_hash" = excluded."profile_hash", "contract_json" = excluded."contract_json", ' +
        '"canonical_version" = excluded."canonical_version", ' +
        '"updated_at" = datetime(\'now\'), "app_tag" = excluded."app_tag", ' +
        '"meta" = excluded."meta", "invariants" = excluded."invariants"',
    );
    expect(params[0]).toBe('app');
    expect(params[1]).toBe('core');
    expect(params[2]).toBe('prof');
    expect(params[7]).toBe('["inv-a","inv-b"]');
  });

  it('updateMarker reads the current invariants and writes the deduped union (no overwrite)', async () => {
    // The capturing driver returns this row for the internal readMarker probe
    // and select; SQLite stores invariants as JSON TEXT, so it arrives as a
    // string and is decoded before the merge.
    const driver = createCapturingDriver([
      { core_hash: 'from', profile_hash: 'prof', invariants: '["inv-a","inv-b"]' },
    ]);
    const matched = await adapter.updateMarker(driver, 'app', 'from', {
      storageHash: 'to',
      profileHash: 'prof',
      invariants: ['inv-b', 'inv-c'],
    });

    const update = driver.calls.at(-1)!;
    expect(update.sql).toBe(
      'UPDATE "_prisma_marker" SET "core_hash" = ?, "profile_hash" = ?, ' +
        '"updated_at" = datetime(\'now\'), "invariants" = ? ' +
        'WHERE ("_prisma_marker"."space" = ? AND "_prisma_marker"."core_hash" = ?) ' +
        'RETURNING "_prisma_marker"."space"',
    );
    // union({a,b}, {b,c}) deduped + sorted, JSON-encoded — not the incoming set verbatim.
    expect(update.params).toEqual(['to', 'prof', '["inv-a","inv-b","inv-c"]', 'app', 'from']);
    expect(matched).toBe(true);
  });

  it('updateMarker omits the invariants assignment when none are supplied', async () => {
    const driver = createCapturingDriver([]);
    const matched = await adapter.updateMarker(driver, 'app', 'from', {
      storageHash: 'to',
      profileHash: 'prof',
    });

    const { sql, params } = driver.calls[0]!;
    expect(sql).toBe(
      'UPDATE "_prisma_marker" SET "core_hash" = ?, "profile_hash" = ?, ' +
        '"updated_at" = datetime(\'now\') ' +
        'WHERE ("_prisma_marker"."space" = ? AND "_prisma_marker"."core_hash" = ?) ' +
        'RETURNING "_prisma_marker"."space"',
    );
    expect(params).toEqual(['to', 'prof', 'app', 'from']);
    expect(matched).toBe(false);
  });

  it('writeLedgerEntry lowers to an INSERT with JSON-as-TEXT operations', async () => {
    const driver = createCapturingDriver();
    await adapter.writeLedgerEntry(driver, 'app', {
      edgeId: 'edge-1',
      from: 'from',
      to: 'to',
      migrationName: '001_init',
      migrationHash: 'mig',
      operations: [{ id: 'op-1' }],
    });

    const { sql, params } = driver.calls[0]!;
    expect(sql).toBe(
      'INSERT INTO "_prisma_ledger" ("space", "migration_name", "migration_hash", ' +
        '"origin_core_hash", "destination_core_hash", "operations") VALUES (?, ?, ?, ?, ?, ?)',
    );
    expect(params).toEqual(['app', '001_init', 'mig', 'from', 'to', '[{"id":"op-1"}]']);
  });
});

describe('SqliteControlAdapter marker/ledger writes (end-to-end)', () => {
  const adapter: SqlControlAdapter<'sqlite'> = new SqliteControlAdapter(
    createSqliteBuiltinCodecLookup(),
  );

  async function withDb(fn: (driver: ReturnType<typeof createMemoryDriver>) => Promise<void>) {
    const driver = createMemoryDriver();
    for (const ddl of adapter.bootstrapControlTableQueries()) {
      const lowered = await adapter.lowerToExecuteRequest(ddl, { contract: undefined });
      await driver.query(lowered.sql);
    }
    try {
      await fn(driver);
    } finally {
      await driver.close();
    }
  }

  it('initMarker stamps a readable marker row, idempotently', async () => {
    await withDb(async (driver) => {
      await adapter.initMarker(driver, 'app', {
        storageHash: 'core',
        profileHash: 'prof',
        invariants: ['inv-a', 'inv-b'],
      });

      let marker = await adapter.readMarker(driver, 'app');
      expect(marker!.storageHash).toBe('core');
      expect(marker!.invariants).toEqual(['inv-a', 'inv-b']);
      expect(marker!.contractJson).toBeNull();
      expect(marker!.meta).toEqual({});

      await adapter.initMarker(driver, 'app', {
        storageHash: 'core2',
        profileHash: 'prof2',
        invariants: ['inv-x'],
      });
      const all = await adapter.readAllMarkers(driver);
      expect(all.size).toBe(1);
      marker = await adapter.readMarker(driver, 'app');
      expect(marker!.storageHash).toBe('core2');
      expect(marker!.invariants).toEqual(['inv-x']);
    });
  });

  it('updateMarker advances on a matching expectedFrom and refuses a stale one', async () => {
    await withDb(async (driver) => {
      await adapter.initMarker(driver, 'app', {
        storageHash: 'core',
        profileHash: 'prof',
      });

      const stale = await adapter.updateMarker(driver, 'app', 'wrong', {
        storageHash: 'next',
        profileHash: 'prof2',
      });
      expect(stale).toBe(false);
      expect((await adapter.readMarker(driver, 'app'))!.storageHash).toBe('core');

      const matched = await adapter.updateMarker(driver, 'app', 'core', {
        storageHash: 'next',
        profileHash: 'prof2',
        invariants: ['inv-1'],
      });
      expect(matched).toBe(true);
      const marker = await adapter.readMarker(driver, 'app');
      expect(marker!.storageHash).toBe('next');
      expect(marker!.invariants).toEqual(['inv-1']);
    });
  });

  it('updateMarker accumulate-dedupes invariants across advances instead of overwriting', async () => {
    await withDb(async (driver) => {
      await adapter.initMarker(driver, 'app', {
        storageHash: 'core',
        profileHash: 'prof',
        invariants: ['inv-b', 'inv-a'],
      });

      const matched = await adapter.updateMarker(driver, 'app', 'core', {
        storageHash: 'next',
        profileHash: 'prof2',
        invariants: ['inv-c', 'inv-a'],
      });
      expect(matched).toBe(true);

      // Union of the seeded {a,b} and the incoming {a,c}, deduped + sorted.
      // An overwrite would leave only the incoming ['inv-a','inv-c'].
      const marker = await adapter.readMarker(driver, 'app');
      expect(marker!.invariants).toEqual(['inv-a', 'inv-b', 'inv-c']);
    });
  });

  it('writeLedgerEntry appends a readable ledger row', async () => {
    await withDb(async (driver) => {
      await adapter.writeLedgerEntry(driver, 'app', {
        edgeId: 'edge-1',
        from: 'from',
        to: 'to',
        migrationName: '001_init',
        migrationHash: 'mig',
        operations: [{ id: 'op-1' }, { id: 'op-2' }],
      });

      const ledger = await adapter.readLedger(driver, 'app');
      expect(ledger).toHaveLength(1);
      expect(ledger[0]!.migrationName).toBe('001_init');
      expect(ledger[0]!.from).toBe('from');
      expect(ledger[0]!.to).toBe('to');
      expect(ledger[0]!.operationCount).toBe(2);
    });
  });
});
