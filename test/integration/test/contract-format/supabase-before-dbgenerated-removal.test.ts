import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/contract-format/supabase-before-dbgenerated-removal.contract.json',
);

describe('a contract emitted before dbgenerated was removed', () => {
  it('still validates through the full SQL validator with the Postgres entity kinds registered, its raw SQL defaults carried as function defaults', () => {
    const contractJson: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const contract = new PostgresContractSerializer().deserializeContract(contractJson);
    const columns = Object.values(contract.storage.namespaces).flatMap((namespace) =>
      Object.values(namespace.entries.table ?? {}).flatMap((table) => Object.values(table.columns)),
    );
    const rawDefaults = columns.flatMap((column) =>
      column.default?.kind === 'function' ? [column.default.expression] : [],
    );
    expect(rawDefaults).toContain('gen_random_uuid()');
    expect(rawDefaults).toContain("'{}'::jsonb");
    expect(rawDefaults).toContain("(now() + '00:03:00'::interval)");
  });
});
