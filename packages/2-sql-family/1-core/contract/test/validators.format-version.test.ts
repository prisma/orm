import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { SqlStorage } from '../src/types';
import { validateSqlContractFully } from '../src/validators';

const contract = createContract<SqlStorage>({
  storage: {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        kind: 'test-sql-namespace',
        entries: { table: {} },
      },
    },
  },
});

describe('validateSqlContractFully and the format version', () => {
  it('reads a contract file in a format version it knows, without the field', () => {
    const validated = validateSqlContractFully({ formatVersion: 1, ...contract });
    expect(validated).not.toHaveProperty('formatVersion');
    expect(validated.storage.storageHash).toBe(contract.storage.storageHash);
  });

  it('reads an in-memory contract, which has no format version', () => {
    expect(() => validateSqlContractFully(contract)).not.toThrow();
  });

  it('refuses a contract file written by a newer release', () => {
    expect(() => validateSqlContractFully({ formatVersion: 2, ...contract })).toThrowError(
      expect.objectContaining({ code: 'CONTRACT.FORMAT_VERSION_NEWER' }) as unknown as Error,
    );
  });

  it('reads a contract file a release candidate wrote, with schemaVersion, without the field', () => {
    const validated = validateSqlContractFully({ schemaVersion: '1', ...contract });
    expect(validated).not.toHaveProperty('schemaVersion');
    expect(validated).not.toHaveProperty('formatVersion');
    expect(validated.storage.storageHash).toBe(contract.storage.storageHash);
  });

  it('refuses a contract file with a schemaVersion no release wrote', () => {
    expect(() => validateSqlContractFully({ schemaVersion: '2', ...contract })).toThrowError(
      expect.objectContaining({ code: 'CONTRACT.FORMAT_VERSION_MISSING' }) as unknown as Error,
    );
  });
});
