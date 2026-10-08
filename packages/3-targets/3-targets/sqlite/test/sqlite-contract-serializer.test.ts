import { effectiveControlPolicy } from '@internal/contract/types';
import { SqlContractSerializerBase } from '@internal/family-sql/ir';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageColumn, StorageTable } from '@internal/sql-contract/types';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import sqliteControlTargetDescriptor from '../src/core/control-target';
import { SqliteContractSerializer } from '../src/core/sqlite-contract-serializer';

function makeValidContractJson() {
  return createSqlContract({
    target: 'sqlite',
    storage: {
      namespaces: { [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: {} } } },
    },
  });
}

function makeContractWithTablesJson() {
  return createSqlContract({
    target: 'sqlite',
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              user: {
                columns: {
                  id: { dataType: 'sqlite/integer', codecId: 'sqlite/integer@1', nullable: false },
                  email: { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
      },
    },
  });
}

describe('SqliteContractSerializer', () => {
  it('extends SqlContractSerializerBase', () => {
    const serializer = new SqliteContractSerializer();
    expect(serializer).toBeInstanceOf(SqlContractSerializerBase);
  });

  it('deserializes a valid SQL contract envelope', () => {
    const serializer = new SqliteContractSerializer();
    const contract = serializer.deserializeContract(makeValidContractJson());
    expect(contract.targetFamily).toBe('sql');
    expect(contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries.table ?? {}).toEqual({});
  });

  it('hydrates JSON storage into the SQL Contract IR class hierarchy', () => {
    const serializer = new SqliteContractSerializer();
    const contract = serializer.deserializeContract(makeContractWithTablesJson());

    expect(contract.storage).toBeInstanceOf(SqlStorage);
    const userTable = contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries.table?.['user'] as
      | StorageTable
      | undefined;
    expect(userTable).toBeInstanceOf(StorageTable);
    expect(userTable?.columns['id']).toBeInstanceOf(StorageColumn);
  });

  it('rejects an invalid contract (family-shared structural validation runs)', () => {
    const serializer = new SqliteContractSerializer();
    const bad = { ...makeValidContractJson(), targetFamily: 'mongo' };
    expect(() => serializer.deserializeContract(bad)).toThrow();
  });

  it('serializeContract round-trips a JSON-clean contract', () => {
    const serializer = new SqliteContractSerializer();
    const contract = serializer.deserializeContract(makeContractWithTablesJson());
    const json = serializer.serializeContract(contract);
    const reparsed = JSON.parse(JSON.stringify(json));
    expect(reparsed.storage).not.toHaveProperty('kind');
    expect(reparsed.storage.namespaces[UNBOUND_NAMESPACE_ID].entries.table.user).not.toHaveProperty(
      'kind',
    );
    expect(
      reparsed.storage.namespaces[UNBOUND_NAMESPACE_ID].entries.table.user.columns.id,
    ).not.toHaveProperty('kind');
  });
});

describe('control-policy round-trip fidelity', () => {
  function makeMixedControlContractJson() {
    return {
      ...createSqlContract({
        target: 'sqlite',
        storage: {
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: {
              id: UNBOUND_NAMESPACE_ID,
              entries: {
                table: {
                  user: {
                    columns: {
                      id: {
                        dataType: 'sqlite/integer',
                        codecId: 'sqlite/integer@1',
                        nullable: false,
                        control: 'observed',
                      },
                      email: { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: false },
                    },
                    primaryKey: { columns: ['id'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                    control: 'external',
                  },
                },
              },
            },
          },
        },
      }),
      defaultControlPolicy: 'tolerated',
    };
  }

  it('preserves effective control per node across serialize → deserialize', () => {
    const serializer = new SqliteContractSerializer();
    const contract = serializer.deserializeContract(makeMixedControlContractJson());
    const reparsed = JSON.parse(JSON.stringify(serializer.serializeContract(contract)));

    expect(reparsed.defaultControlPolicy).toBe('tolerated');

    const table = reparsed.storage.namespaces[UNBOUND_NAMESPACE_ID].entries.table.user;
    const def = reparsed.defaultControlPolicy;
    expect(effectiveControlPolicy(table.control, def)).toBe('external');
    expect(effectiveControlPolicy(table.columns.id.control, def)).toBe('observed');
    expect(effectiveControlPolicy(table.columns.email.control, def)).toBe('tolerated');
    expect(table.columns.email).not.toHaveProperty('control');
  });
});

describe('sqliteControlTargetDescriptor', () => {
  it('exposes a contractSerializer property', () => {
    expect(sqliteControlTargetDescriptor.contractSerializer).toBeInstanceOf(
      SqliteContractSerializer,
    );
  });

  it('exposes a schemaVerifier property next to migrations', () => {
    expect(sqliteControlTargetDescriptor.schemaVerifier).toBeDefined();
    expect(sqliteControlTargetDescriptor.migrations).toBeDefined();
  });
});
