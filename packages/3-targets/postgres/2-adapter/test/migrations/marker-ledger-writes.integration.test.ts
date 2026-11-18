import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import {
  type DatabasePolicies,
  DEFAULT_DATABASE_POLICIES,
} from '@internal/framework-components/control';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { createPostgresBuiltinDataTypeLookup } from '@internal/target-postgres/data-types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPostgresControlAdapter } from '../helpers/test-control-adapter';
import {
  createDriver,
  createTestDatabase,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

const adapter: SqlControlAdapter<'postgres'> = createTestPostgresControlAdapter(
  createPostgresBuiltinCodecLookup(),
  createPostgresBuiltinDataTypeLookup(),
);

const MIGRATE_ONLY: DatabasePolicies = {
  change: ['migrate'],
  dataProtection: {
    dataLoss: 'data-loss-forbidden',
    accessWidening: 'access-widening-forbidden',
  },
};

async function bootstrap(driver: PostgresControlDriver): Promise<void> {
  for (const ddl of adapter.bootstrapControlTableQueries()) {
    const lowered = await adapter.lowerToExecuteRequest(ddl, { contract: undefined });
    await driver.query(lowered.sql);
  }
}

describe('PostgresControlAdapter marker/ledger writes (end-to-end)', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
    await bootstrap(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  it('initMarker stamps a readable marker row', { timeout: testTimeout }, async () => {
    await adapter.initMarker(driver!, 'app', {
      storageHash: 'core',
      profileHash: 'prof',
      invariants: ['inv-a', 'inv-b'],
    });

    const marker = await adapter.readMarker(driver!, 'app');
    expect(marker).not.toBeNull();
    expect(marker!.storageHash).toBe('core');
    expect(marker!.profileHash).toBe('prof');
    expect(marker!.invariants).toEqual(['inv-a', 'inv-b']);
    expect(marker!.updatedAt).toBeInstanceOf(Date);
    expect(marker!.contractJson).toBeNull();
  });

  it('initMarker is idempotent — re-stamping overwrites in place', {
    timeout: testTimeout,
  }, async () => {
    await adapter.initMarker(driver!, 'app', {
      storageHash: 'core',
      profileHash: 'prof',
    });
    await adapter.initMarker(driver!, 'app', {
      storageHash: 'core2',
      profileHash: 'prof2',
      invariants: ['inv-x'],
    });

    const all = await adapter.readAllMarkers(driver!);
    expect(all.size).toBe(1);
    const marker = all.get('app')!;
    expect(marker.storageHash).toBe('core2');
    expect(marker.invariants).toEqual(['inv-x']);
  });

  it('updateMarker advances on a matching expectedFrom and writes invariants', {
    timeout: testTimeout,
  }, async () => {
    await adapter.initMarker(driver!, 'app', {
      storageHash: 'core',
      profileHash: 'prof',
    });

    const matched = await adapter.updateMarker(driver!, 'app', 'core', {
      storageHash: 'next',
      profileHash: 'prof2',
      invariants: ['inv-1'],
    });

    expect(matched).toBe(true);
    const marker = await adapter.readMarker(driver!, 'app');
    expect(marker!.storageHash).toBe('next');
    expect(marker!.invariants).toEqual(['inv-1']);
  });

  it('updateMarker accumulate-dedupes invariants across advances', {
    timeout: testTimeout,
  }, async () => {
    await adapter.initMarker(driver!, 'app', {
      storageHash: 'core',
      profileHash: 'prof',
      invariants: ['inv-b', 'inv-a'],
    });

    const matched = await adapter.updateMarker(driver!, 'app', 'core', {
      storageHash: 'next',
      profileHash: 'prof2',
      invariants: ['inv-c', 'inv-a'],
    });

    expect(matched).toBe(true);
    // Union of the seeded {a,b} and the incoming {a,c}, deduped + sorted.
    const marker = await adapter.readMarker(driver!, 'app');
    expect(marker!.invariants).toEqual(['inv-a', 'inv-b', 'inv-c']);
  });

  it('updateMarker returns false (no swap) when expectedFrom does not match', {
    timeout: testTimeout,
  }, async () => {
    await adapter.initMarker(driver!, 'app', {
      storageHash: 'core',
      profileHash: 'prof',
    });

    const matched = await adapter.updateMarker(driver!, 'app', 'stale', {
      storageHash: 'next',
      profileHash: 'prof2',
    });

    expect(matched).toBe(false);
    const marker = await adapter.readMarker(driver!, 'app');
    expect(marker!.storageHash).toBe('core');
  });

  it('initMarker records databasePolicies in meta.policies', { timeout: testTimeout }, async () => {
    await adapter.initMarker(driver!, 'app', {
      storageHash: 'core',
      profileHash: 'prof',
      databasePolicies: MIGRATE_ONLY,
    });

    expect((await adapter.readMarker(driver!, 'app'))!.meta).toEqual({ policies: MIGRATE_ONLY });
  });

  it('re-stamping and advancing without databasePolicies leave meta as it was', {
    timeout: testTimeout,
  }, async () => {
    await adapter.initMarker(driver!, 'app', {
      storageHash: 'core',
      profileHash: 'prof',
      databasePolicies: MIGRATE_ONLY,
    });
    await adapter.initMarker(driver!, 'app', { storageHash: 'core2', profileHash: 'prof' });
    await adapter.updateMarker(driver!, 'app', 'core2', {
      storageHash: 'core3',
      profileHash: 'prof',
      invariants: ['inv-a'],
    });

    const marker = await adapter.readMarker(driver!, 'app');
    expect({ storageHash: marker!.storageHash, meta: marker!.meta }).toEqual({
      storageHash: 'core3',
      meta: { policies: MIGRATE_ONLY },
    });
  });

  it('updateMarker replaces the recorded policies when given new ones', {
    timeout: testTimeout,
  }, async () => {
    await adapter.initMarker(driver!, 'app', {
      storageHash: 'core',
      profileHash: 'prof',
      databasePolicies: MIGRATE_ONLY,
    });

    await adapter.updateMarker(driver!, 'app', 'core', {
      storageHash: 'next',
      profileHash: 'prof',
      databasePolicies: DEFAULT_DATABASE_POLICIES,
    });

    expect((await adapter.readMarker(driver!, 'app'))!.meta).toEqual({
      policies: DEFAULT_DATABASE_POLICIES,
    });
  });

  it('updateMarker sets meta.policies in the statement and keeps the other meta keys', {
    timeout: testTimeout,
  }, async () => {
    await adapter.initMarker(driver!, 'app', { storageHash: 'core', profileHash: 'prof' });
    await driver!.query(
      `update prisma_contract.marker set meta = '{"note": "kept"}'::jsonb where space = 'app'`,
    );

    await adapter.updateMarker(driver!, 'app', 'core', {
      storageHash: 'next',
      profileHash: 'prof',
      databasePolicies: MIGRATE_ONLY,
    });

    expect((await adapter.readMarker(driver!, 'app'))!.meta).toEqual({
      note: 'kept',
      policies: MIGRATE_ONLY,
    });
  });

  it('writeLedgerEntry appends a readable ledger row', { timeout: testTimeout }, async () => {
    await adapter.writeLedgerEntry(driver!, 'app', {
      edgeId: 'edge-1',
      from: 'from',
      to: 'to',
      migrationName: '001_init',
      migrationHash: 'mig',
      operations: [{ id: 'op-1' }, { id: 'op-2' }],
    });

    const ledger = await adapter.readLedger(driver!, 'app');
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.migrationName).toBe('001_init');
    expect(ledger[0]!.migrationHash).toBe('mig');
    expect(ledger[0]!.from).toBe('from');
    expect(ledger[0]!.to).toBe('to');
    expect(ledger[0]!.operationCount).toBe(2);
  });
});
