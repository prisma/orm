import { describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-lookup';
import { PostgresControlAdapter } from '../src/core/control-adapter';

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

describe('PostgresControlAdapter marker/ledger write lowering', () => {
  const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());

  it('insertMarker lowers to a plain insert with DB-side updated_at', async () => {
    const driver = createCapturingDriver();
    await adapter.insertMarker(driver, 'app', {
      storageHash: 'core',
      profileHash: 'prof',
    });

    const { sql, params } = driver.calls[0]!;
    expect(sql).toContain(
      'INSERT INTO "prisma_contract"."marker" ("space", "core_hash", "profile_hash", ' +
        '"contract_json", "canonical_version", "updated_at", "app_tag", "meta", "invariants")',
    );
    expect(sql).toContain('VALUES ($1, $2, $3, $4::jsonb, $5, now(), $6, $7::jsonb, $8::text[])');
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
    expect(sql).toContain(
      'INSERT INTO "prisma_contract"."marker" ("space", "core_hash", "profile_hash", ' +
        '"contract_json", "canonical_version", "updated_at", "app_tag", "meta", "invariants")',
    );
    expect(sql).toContain('VALUES ($1, $2, $3, $4::jsonb, $5, now(), $6, $7::jsonb, $8::text[])');
    expect(sql).toContain('ON CONFLICT ("space") DO UPDATE SET');
    expect(sql).toContain('"core_hash" = excluded."core_hash"');
    expect(sql).toContain('"updated_at" = now()');
    expect(sql).toContain('"invariants" = excluded."invariants"');
    expect(params[0]).toBe('app');
    expect(params[1]).toBe('core');
    expect(params[2]).toBe('prof');
    expect(params[7]).toEqual(['inv-a', 'inv-b']);
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
      'UPDATE "prisma_contract"."marker" SET "core_hash" = $1, "profile_hash" = $2, ' +
        '"updated_at" = now(), "invariants" = $3::text[] ' +
        'WHERE ("marker"."space" = $4 AND "marker"."core_hash" = $5) RETURNING "marker"."space"',
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
      'UPDATE "prisma_contract"."marker" SET "core_hash" = $1, "profile_hash" = $2, ' +
        '"updated_at" = now() ' +
        'WHERE ("marker"."space" = $3 AND "marker"."core_hash" = $4) RETURNING "marker"."space"',
    );
    expect(params).toEqual(['to', 'prof', 'app', 'from']);
    expect(matched).toBe(false);
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
      'INSERT INTO "prisma_contract"."ledger" ("space", "migration_name", "migration_hash", ' +
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
      'INSERT INTO "prisma_contract"."contract" ("core_hash", "contract_json") ' +
        'VALUES ($1, $2::jsonb) ON CONFLICT ("core_hash") DO NOTHING',
    );
    expect(contractUpsert.params[0]).toBe('to');
    expect(contractUpsert.params[1]).toBe(JSON.stringify({ models: ['user', 'post'] }));

    const ledgerInsert = driver.calls[1]!;
    expect(ledgerInsert.sql).toContain('INSERT INTO "prisma_contract"."ledger"');
    expect(ledgerInsert.sql).not.toContain('RETURNING');
  });
});
