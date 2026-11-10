import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SqlStorage } from '@internal/sql-contract/types';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';

/**
 * TML-2536 snapshot-read coverage.
 *
 * Per-polymorphic-`storage.types`-kind fixtures hydrate cleanly
 * through the family serializer. One fixture per `kind` shipped
 * in tree (`codec-instance`) — adding another fixture is the
 * canonical way to extend test coverage when a new entity type
 * lands in the family registry.
 *
 * The "snapshot read seam" exercised here is the same code path
 * `readPredecessorEndContract` (and every other CLI on-disk read)
 * crosses: `JSON.parse` → `familyInstance.deserializeContract`
 * (delegates to `PostgresContractSerializer.deserializeContract`).
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = join(HERE, 'fixtures', 'snapshot-read-shapes');

describe('snapshot-read shape fixtures — per-kind round-trip (TML-2536)', () => {
  const serializer = new PostgresContractSerializer();

  it('hydrates the codec-instance fixture without coercion', () => {
    const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, 'codec-instance.json'), 'utf-8'));
    const contract = serializer.deserializeContract(raw);
    expect(contract.storage).toBeInstanceOf(SqlStorage);
    const entry = contract.storage.types?.['Embedding1536'];
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      kind: 'codec-instance',
      codecId: 'pg/vector@1',
      dataType: 'pgvector/vector',
      typeParams: { length: 1536 },
    });
  });
});
