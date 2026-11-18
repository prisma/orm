import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { composeSqlEntityKinds } from '../src/entity-kinds';
import { StorageColumn } from '../src/ir/storage-column';
import { StorageTable } from '../src/ir/storage-table';
import { createSqlContractSchema, validateStorage } from '../src/validators';

function storageWithColumn(control?: unknown) {
  return {
    storageHash: 'test',
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        entries: {
          table: {
            user: {
              columns: {
                id: {
                  dataType: 'pg/int4',
                  codecId: 'pg/int4@1',
                  nullable: false,
                  ...(control !== undefined ? { control } : {}),
                },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    },
  };
}

function storageWithTable(control?: unknown) {
  return {
    storageHash: 'test',
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        entries: {
          table: {
            user: {
              columns: {
                id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
              ...(control !== undefined ? { control } : {}),
            },
          },
        },
      },
    },
  };
}

function minimalContract(defaultControlPolicy?: unknown) {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: 'profile',
    domain: { namespaces: { main: { models: {} } } },
    storage: { storageHash: 'test' },
    ...(defaultControlPolicy !== undefined ? { defaultControlPolicy } : {}),
  };
}

describe('StorageColumn control field', () => {
  it('retains control when set', () => {
    const col = new StorageColumn({
      dataType: 'pg/int4',
      codecId: 'pg/int4@1',
      nullable: false,
      control: 'external',
    });
    expect(col.control).toBe('external');
  });

  it('omits control when unset', () => {
    const col = new StorageColumn({ dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false });
    expect(Object.hasOwn(col, 'control')).toBe(false);
    expect('control' in JSON.parse(JSON.stringify(col))).toBe(false);
  });
});

describe('StorageTable control field', () => {
  it('retains control when set', () => {
    const t = new StorageTable({
      columns: {
        id: new StorageColumn({ dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false }),
      },
      uniques: [],
      indexes: [],
      foreignKeys: [],
      control: 'tolerated',
    });
    expect(t.control).toBe('tolerated');
  });

  it('omits control when unset', () => {
    const t = new StorageTable({
      columns: {
        id: new StorageColumn({ dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false }),
      },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    });
    expect(Object.hasOwn(t, 'control')).toBe(false);
  });
});

describe('SQL storage validators accept control', () => {
  it('accepts a column carrying control', () => {
    expect(() => validateStorage(storageWithColumn('external'))).not.toThrow();
  });

  it('rejects a column carrying a non-ControlPolicy string', () => {
    expect(() => validateStorage(storageWithColumn('bogus'))).toThrow();
  });

  it('accepts a table carrying control', () => {
    expect(() => validateStorage(storageWithTable('observed'))).not.toThrow();
  });

  it('rejects a table carrying a non-ControlPolicy string', () => {
    expect(() => validateStorage(storageWithTable('bogus'))).toThrow();
  });
});

describe('SQL contract schema defaultControlPolicy', () => {
  const schema = createSqlContractSchema(composeSqlEntityKinds());

  it('accepts a contract carrying defaultControlPolicy', () => {
    expect(schema(minimalContract('observed')) instanceof type.errors).toBe(false);
  });

  it('rejects a contract carrying a non-ControlPolicy defaultControlPolicy', () => {
    expect(schema(minimalContract('bogus')) instanceof type.errors).toBe(true);
  });
});
