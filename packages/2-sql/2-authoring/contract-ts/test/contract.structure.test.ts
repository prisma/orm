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

  it('throws on missing targetFamily', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    const invalid = { ...validContractInput, targetFamily: undefined } as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(invalid)).toThrow(/targetFamily/);
  });

  it('throws on wrong targetFamily', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    const invalid = { ...validContractInput, targetFamily: 'document' } as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(invalid)).toThrow(
      /Unsupported target family/,
    );
  });

  it('throws on missing target', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    const invalid = { ...validContractInput, target: undefined } as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(invalid)).toThrow(/target/);
  });

  it('preserves storageHash in storage', () => {
    const result = validateSqlContractFully<Contract<SqlStorage>>(validContractInput);
    expect(result.storage.storageHash).toBe('test');
  });

  it('throws on missing storage', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    const invalid = { ...validContractInput, storage: undefined } as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(invalid)).toThrow(/storage/);
  });

  it('throws on missing domain', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    const invalid = { ...validContractInput, domain: undefined } as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(invalid)).toThrow(/domain/);
  });

  it('throws on invalid column type', () => {
    const invalid = {
      ...validContractInput,
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: {
          User: {
            columns: {
              id: { dataType: 123 as unknown as string, codecId: 'pg/text@1', nullable: false },
            },
          },
        },
      }),
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(invalid)).toThrow(
      /dataType must be/,
    );
  });

  it('throws on invalid nullable type', () => {
    const invalid = {
      ...validContractInput,
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: {
          User: {
            columns: {
              id: {
                dataType: 'pg/text',
                codecId: 'pg/text@1',
                nullable: 'yes' as unknown as boolean,
              },
            },
          },
        },
      }),
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(invalid)).toThrow(
      /Column.*validation failed|nullable.*must be.*boolean/,
    );
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
