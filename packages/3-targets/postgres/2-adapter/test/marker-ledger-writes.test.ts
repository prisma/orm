import {
  type DatabasePolicies,
  storedDatabasePolicies,
} from '@internal/framework-components/control';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { createPostgresBuiltinDataTypeLookup } from '@internal/target-postgres/data-types';
import { describe, expect, it } from 'vitest';
import { createTestPostgresControlAdapter } from './helpers/test-control-adapter';

interface CapturedCall {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function createCapturingDriver(rows: Record<string, unknown>[] = []) {
  const calls: CapturedCall[] = [];
  return {
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      calls.push({ sql, params: params ?? [] });
      return { rows: rows as Row[] };
    },
    async close() {},
    calls,
  };
}

const migrateOnly: DatabasePolicies = {
  change: ['migrate'],
  dataProtection: {
    dataLoss: 'data-loss-forbidden',
    accessWidening: 'access-widening-with-consent',
  },
};

describe('PostgresControlAdapter signature, policies and ledger write lowering', () => {
  const adapter = createTestPostgresControlAdapter(
    createPostgresBuiltinCodecLookup(),
    createPostgresBuiltinDataTypeLookup(),
  );

  it('insertMarker lowers to a plain insert into signatures with DB-side signed_at', async () => {
    const driver = createCapturingDriver([{ table_schema: '_prisma' }]);
    await adapter.insertMarker(driver, 'app', {
      storageHash: 'core',
      profileHash: 'prof',
    });

    const { sql, params } = driver.calls.find((call) => call.sql.startsWith('INSERT'))!;
    expect(sql).toBe(
      'INSERT INTO "_prisma"."signatures" ("space", "core_hash", "profile_hash", "invariants", "signed_at") ' +
        'VALUES ($1, $2, $3, $4::text[], now())',
    );
    expect(params[0]).toBe('app');
    expect(params[1]).toBe('core');
    expect(params[2]).toBe('prof');
  });

  it('initMarker lowers to an upsert of signatures keyed on space with DB-side signed_at, and writes no policies when given none', async () => {
    const driver = createCapturingDriver();
    await adapter.initMarker(driver, 'app', {
      storageHash: 'core',
      profileHash: 'prof',
      invariants: ['inv-a', 'inv-b'],
    });

    expect(driver.calls).toHaveLength(1);
    const { sql, params } = driver.calls[0]!;
    expect(sql).toBe(
      'INSERT INTO "_prisma"."signatures" ("space", "core_hash", "profile_hash", "invariants", "signed_at") ' +
        'VALUES ($1, $2, $3, $4::text[], now()) ' +
        'ON CONFLICT ("space") DO UPDATE SET "core_hash" = excluded."core_hash", ' +
        '"profile_hash" = excluded."profile_hash", "signed_at" = now(), "invariants" = excluded."invariants"',
    );
    expect(params).toEqual(['app', 'core', 'prof', ['inv-a', 'inv-b']]);
  });

  it('initMarker records the policies it is given as the one row of config, after the signature', async () => {
    const driver = createCapturingDriver();
    await adapter.initMarker(driver, 'app', {
      storageHash: 'core',
      profileHash: 'prof',
      databasePolicies: migrateOnly,
    });

    expect(driver.calls.map((call) => call.sql.split(' ', 3).join(' '))).toEqual([
      'INSERT INTO "_prisma"."signatures"',
      'INSERT INTO "_prisma"."config"',
    ]);
    expect(driver.calls[1]).toEqual({
      sql:
        'INSERT INTO "_prisma"."config" ("policies") VALUES ($1::jsonb)\n' +
        'ON CONFLICT ("id") DO UPDATE SET "policies" = EXCLUDED."policies"',
      params: [JSON.stringify(storedDatabasePolicies(migrateOnly))],
    });
  });

  it('updateMarker reads the current invariants and writes the deduped union (no overwrite)', async () => {
    // The capturing driver returns this row for the internal readMarker probe
    // and select; Postgres drivers expose array fields as raw text.
    const driver = createCapturingDriver([
      { core_hash: 'from', profile_hash: 'prof', invariants: '{"inv-a","inv-b"}' },
    ]);
    const matched = await adapter.updateMarker(driver, 'app', 'from', {
      storageHash: 'to',
      profileHash: 'prof',
      invariants: ['inv-b', 'inv-c'],
    });

    const update = driver.calls.at(-1)!;
    expect(update.sql).toBe(
      'UPDATE "_prisma"."signatures" SET "core_hash" = $1, "profile_hash" = $2, ' +
        '"signed_at" = now(), "invariants" = $3::text[] ' +
        'WHERE ("signatures"."space" = $4 AND "signatures"."core_hash" = $5) RETURNING "signatures"."space"',
    );
    // union({a,b}, {b,c}) deduped + sorted — not the incoming set verbatim.
    expect(update.params).toEqual(['to', 'prof', ['inv-a', 'inv-b', 'inv-c'], 'app', 'from']);
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
      'UPDATE "_prisma"."signatures" SET "core_hash" = $1, "profile_hash" = $2, ' +
        '"signed_at" = now() ' +
        'WHERE ("signatures"."space" = $3 AND "signatures"."core_hash" = $4) RETURNING "signatures"."space"',
    );
    expect(params).toEqual(['to', 'prof', 'app', 'from']);
    expect(matched).toBe(false);
  });

  it('updateMarker records the policies it is given only once the signature has moved', async () => {
    const policies = migrateOnly;
    const moved = createCapturingDriver([{ space: 'app' }]);
    const unmoved = createCapturingDriver([]);
    const destination = { storageHash: 'to', profileHash: 'prof', databasePolicies: policies };

    expect({
      moved: await adapter.updateMarker(moved, 'app', 'from', destination),
      unmoved: await adapter.updateMarker(unmoved, 'app', 'from', destination),
      movedWrites: moved.calls.map((call) => call.sql.split(' ', 3).join(' ')),
      unmovedWrites: unmoved.calls.map((call) => call.sql.split(' ', 3).join(' ')),
    }).toEqual({
      moved: true,
      unmoved: false,
      movedWrites: ['UPDATE "_prisma"."signatures" SET', 'INSERT INTO "_prisma"."config"'],
      unmovedWrites: ['UPDATE "_prisma"."signatures" SET'],
    });
  });

  it('writeLedgerEntry lowers to a single plain INSERT when no snapshot is given', async () => {
    const driver = createCapturingDriver();
    await adapter.writeLedgerEntry(driver, 'app', {
      edgeId: 'edge-1',
      from: 'from',
      to: 'to',
      migrationName: '001_init',
      migrationHash: 'mig',
      operations: [{ id: 'op-1' }],
    });

    expect(driver.calls).toHaveLength(1);
    const { sql, params } = driver.calls[0]!;
    expect(sql).toBe(
      'INSERT INTO "_prisma"."ledger" ("space", "migration_name", "migration_hash", ' +
        '"origin_core_hash", "destination_core_hash", "operations") ' +
        'VALUES ($1, $2, $3, $4, $5, $6::jsonb)',
    );
    expect(params.slice(0, 5)).toEqual(['app', '001_init', 'mig', 'from', 'to']);
  });

  it('writeLedgerEntry upserts the destination contract by hash before the ledger row', async () => {
    const driver = createCapturingDriver();
    await adapter.writeLedgerEntry(driver, 'app', {
      edgeId: 'edge-1',
      from: 'from',
      to: 'to',
      migrationName: '002_add_post',
      migrationHash: 'mig',
      operations: [],
      destinationContractJson: { models: ['user', 'post'] },
    });

    expect(driver.calls).toHaveLength(2);
    // Contract store first, keyed by the destination hash; DO NOTHING makes
    // a rollback cycle revisiting the same contract a no-op.
    const contractUpsert = driver.calls[0]!;
    expect(contractUpsert.sql).toBe(
      'INSERT INTO "_prisma"."contract" ("core_hash", "contract_json") ' +
        'VALUES ($1, $2::jsonb) ON CONFLICT ("core_hash") DO NOTHING',
    );
    expect(contractUpsert.params[0]).toBe('to');
    expect(contractUpsert.params[1]).toBe(JSON.stringify({ models: ['user', 'post'] }));

    const ledgerInsert = driver.calls[1]!;
    expect(ledgerInsert.sql).toContain('INSERT INTO "_prisma"."ledger"');
    expect(ledgerInsert.sql).not.toContain('RETURNING');
  });
});
