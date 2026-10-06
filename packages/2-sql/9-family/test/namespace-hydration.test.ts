import type { Contract } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { isStorageValueSet, type SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer } from './test-sql-contract-serializer';

function makeContractJson(entries: Record<string, Record<string, unknown>>) {
  return createSqlContract({
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries,
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Round-trip: built-in kinds hydrate to class instances
// ---------------------------------------------------------------------------

describe('SqlContractSerializer — built-in kind hydration', () => {
  it('hydrates table entries to StorageTable instances', () => {
    const json = makeContractJson({
      table: {
        users: {
          columns: { id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false } },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    });
    const serializer = new TestSqlContractSerializer();
    const contract = serializer.deserializeContract(json) as Contract<SqlStorage>;
    const ns = contract.storage.namespaces[UNBOUND_NAMESPACE_ID];
    expect(ns).toBeDefined();
    expect(StorageTable.is(ns!.entries.table?.['users'])).toBe(true);
  });

  it('hydrates valueSet entries to StorageValueSet instances', () => {
    const json = makeContractJson({
      table: {},
      valueSet: { Role: { kind: 'valueSet', values: ['user', 'admin'] } },
    });
    const serializer = new TestSqlContractSerializer();
    const contract = serializer.deserializeContract(json) as Contract<SqlStorage>;
    const ns = contract.storage.namespaces[UNBOUND_NAMESPACE_ID];
    expect(ns).toBeDefined();
    expect(isStorageValueSet(ns!.entries.valueSet?.['Role'])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: unknown entries key at validation boundary
// ---------------------------------------------------------------------------

describe('SqlContractSerializer — fail-closed at validation boundary', () => {
  it('throws on a contract with an unregistered entries key, error names the kind', () => {
    const json = makeContractJson({
      table: {},
      bogus: { Foo: { kind: 'bogus', name: 'Foo' } },
    });
    const serializer = new TestSqlContractSerializer();
    expect(() => serializer.deserializeContract(json)).toThrow(/bogus/);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: unknown entries key at hydration boundary
// ---------------------------------------------------------------------------

describe('SqlContractSerializer — fail-closed at hydration boundary', () => {
  it('throws on a raw namespace with an unregistered entries key, error names the kind', () => {
    const json = {
      targetFamily: 'sql',
      target: 'sql',
      profileHash: 'test',
      roots: {},
      storage: {
        storageHash: 'test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {},
              bogus: { Foo: {} },
            },
          },
        },
      },
      domain: {
        namespaces: {},
        models: {},
        valueObjects: {},
        capabilities: {},
      },
    };
    const serializer = new TestSqlContractSerializer();
    expect(() => serializer.deserializeContract(json)).toThrow(/bogus/);
  });
});
