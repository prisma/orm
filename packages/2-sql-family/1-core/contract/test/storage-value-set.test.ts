import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { StorageColumn } from '../src/ir/storage-column';
import { StorageTable } from '../src/ir/storage-table';
import { StorageValueSet } from '../src/ir/storage-value-set';
import { createTestSqlNamespace } from './test-support';

const baseColumn = { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false };

const baseTable = new StorageTable({
  columns: { role: baseColumn },
  primaryKey: { columns: ['role'] },
  uniques: [],
  indexes: [],
  foreignKeys: [],
});

describe('StorageValueSet', () => {
  it('constructs with ordered values', () => {
    const vs = new StorageValueSet({ kind: 'valueSet', values: ['user', 'admin'] });
    expect(vs.kind).toBe('valueSet');
    expect(vs.values).toEqual(['user', 'admin']);
  });

  it('is frozen', () => {
    const vs = new StorageValueSet({ kind: 'valueSet', values: ['x', 'y'] });
    expect(Object.isFrozen(vs)).toBe(true);
  });
});

describe('SqlNamespace with valueSet entries', () => {
  it('accepts a namespace with a valueSet slot alongside the table slot', () => {
    const roleVs = new StorageValueSet({ kind: 'valueSet', values: ['user', 'admin'] });

    const ns = createTestSqlNamespace({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: { users: baseTable },
        valueSet: { Role: roleVs },
      },
    });

    expect(ns.entries.table?.['users']).toBeDefined();
    expect(ns.entries.valueSet?.['Role']).toBeDefined();
    expect(ns.entries.valueSet?.['Role']?.kind).toBe('valueSet');
    expect(ns.entries.valueSet?.['Role']?.values).toEqual(['user', 'admin']);
  });

  it('leaves the valueSet slot absent when not provided', () => {
    const ns = createTestSqlNamespace({
      id: UNBOUND_NAMESPACE_ID,
      entries: { table: { users: baseTable } },
    });
    expect(ns.entries['valueSet']).toBeUndefined();
  });
});

describe('StorageColumn with valueSet restriction', () => {
  it('is frozen', () => {
    const col = new StorageColumn({
      ...baseColumn,
      valueSet: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: UNBOUND_NAMESPACE_ID,
        entityName: 'Role',
      },
    });
    expect(Object.isFrozen(col)).toBe(true);
  });
});
