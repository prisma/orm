import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { validSqlContractJson } from './sql-contract-json-fixture';
import { storageWithNamespacedTables } from './storage-with-namespaced-tables';
import { unboundTables } from './unbound-tables';

describe('SqlContractSerializer structure validation', () => {
  const validContractInput = validSqlContractJson({
    storage: storageWithNamespacedTables({
      storageHash: 'test',
      tables: {
        User: {
          columns: {
            id: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
            email: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    }),
  });

  it('accepts valid contract structure', () => {
    const result = validateSqlContractFully<Contract<SqlStorage>>(validContractInput);
    expect(unboundTables(result.storage)).toHaveProperty('User');
  });

  it('preserves storageHash in storage', () => {
    const result = validateSqlContractFully<Contract<SqlStorage>>(validContractInput);
    expect(result.storage.storageHash).toBe('test');
  });

  it('throws on missing domain', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    const invalid = { ...validContractInput, domain: undefined } as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(invalid)).toThrow(/domain/);
  });

  it('validates optional fields', () => {
    const withOptional = {
      ...validContractInput,
      profileHash: 'profile',
      capabilities: { feature: { enabled: true } },
      extensions: { pack: { config: true } },
      meta: { key: 'value' },
      roots: {},
    };
    const result = validateSqlContractFully<Contract<SqlStorage>>(withOptional);
    expect(result.profileHash).toBe('profile');
    expect(result.capabilities).toEqual({ feature: { enabled: true } });
  });
});
