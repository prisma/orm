import { coreHash } from '@internal/contract/types';
import { validateContractOnce } from '@internal/contract/validate-once';
import { SqlStorage } from '@internal/sql-contract/types';
import { SqliteContractSerializer } from '@internal/target-sqlite/runtime';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { createContract } from '@repo/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Contract } from '../../1-target/test/fixtures/sqlite-contract.d';
import fixtureContractJson from '../../1-target/test/fixtures/sqlite-contract.json' with {
  type: 'json',
};
import sqlite from '../src/exports/runtime';
import sqliteStatic, { contractFromJson } from '../src/exports/static';

function freshContractJson(): unknown {
  return structuredClone(fixtureContractJson);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('contractFromJson', () => {
  it('returns the contract the SQLite serializer hydrates', () => {
    const json = freshContractJson();

    expect(contractFromJson<Contract>(json)).toEqual(
      new SqliteContractSerializer().deserializeContract(json),
    );
  });

  it('throws the structured validation error for invalid JSON', () => {
    expect(() => contractFromJson({ target: 'sqlite' })).toThrow(
      expect.objectContaining({
        name: 'ContractValidationError',
        code: 'CONTRACT.VALIDATION_FAILED',
      }),
    );
  });
});

describe('validating a contract once', () => {
  it('validates a contractFromJson value once for every client built from it', () => {
    const deserialize = vi.spyOn(SqliteContractSerializer.prototype, 'deserializeContract');
    const contract = contractFromJson<Contract>(freshContractJson());

    const clients = [sqlite({ contract }), sqlite({ contract }), sqliteStatic({ contract })];

    expect(deserialize).toHaveBeenCalledTimes(1);
    for (const client of clients) {
      expect(client.contract).toBe(contract);
    }
  });

  it('does not validate the contract of a static entry again', () => {
    const contract = contractFromJson<Contract>(freshContractJson());
    const deserialize = vi.spyOn(SqliteContractSerializer.prototype, 'deserializeContract');

    const db = sqlite({ contract: sqliteStatic({ contract }).contract });

    expect(deserialize).not.toHaveBeenCalled();
    expect(db.contract).toBe(contract);
  });

  it('validates again a contract that another validator of the same target recorded', () => {
    const recordedByAnother = validateContractOnce(freshContractJson(), 'sqlite', (input) =>
      new SqliteContractSerializer().deserializeContract<Contract>(input),
    );
    const deserialize = vi.spyOn(SqliteContractSerializer.prototype, 'deserializeContract');

    sqlite({ contract: recordedByAnother });

    expect(deserialize).toHaveBeenCalledTimes(1);
  });

  it('validates a TypeScript-authored contract once, and the contract a client holds not again', () => {
    const deserialize = vi.spyOn(SqliteContractSerializer.prototype, 'deserializeContract');
    const authored = createContract<SqlStorage>({
      target: 'sqlite',
      storage: new SqlStorage({
        storageHash: coreHash('sqlite-validate-once-test'),
        namespaces: {
          __unbound__: sqliteCreateNamespace({ id: '__unbound__', entries: { table: {} } }),
        },
      }),
    });

    const first = sqlite({ contract: authored });
    const second = sqlite({ contract: authored });
    sqliteStatic({ contract: first.contract });

    expect(deserialize).toHaveBeenCalledTimes(1);
    expect(second.contract).toBe(first.contract);
  });
});
