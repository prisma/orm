import type { ValueSetRef } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { StorageColumn } from '../src/ir/storage-column';
import { StorageTable } from '../src/ir/storage-table';
import { isStorageValueSet, StorageValueSet } from '../src/ir/storage-value-set';
import { createTestSqlNamespace } from './test-support';

const baseColumn = { codecId: 'pg/text@1', nativeType: 'text', nullable: false };

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

  it('preserves declaration order', () => {
    const vs = new StorageValueSet({
      kind: 'valueSet',
      values: ['alpha', 'beta', 'gamma'],
    });
    expect([...vs.values]).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('is frozen', () => {
    const vs = new StorageValueSet({ kind: 'valueSet', values: ['x', 'y'] });
    expect(Object.isFrozen(vs)).toBe(true);
  });

  it('kind equals the entries slot key it lives under', () => {
    const vs = new StorageValueSet({ kind: 'valueSet', values: ['a'] });
    expect(vs.kind).toBe('valueSet');
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
  it('carries a valueSet ref when provided', () => {
    const ref: ValueSetRef = {
      plane: 'storage',
      entityKind: 'valueSet',
      namespaceId: UNBOUND_NAMESPACE_ID,
      entityName: 'Role',
    };
    const col = new StorageColumn({ ...baseColumn, valueSet: ref });

    expect(col.valueSet).toEqual(ref);
    expect(col.valueSet?.entityKind).toBe('valueSet');
    expect(col.valueSet?.namespaceId).toBe(UNBOUND_NAMESPACE_ID);
    expect(col.valueSet?.entityName).toBe('Role');
    expect(col.valueSet?.spaceId).toBeUndefined();
  });

  it('carries a cross-space valueSet ref when spaceId is provided', () => {
    const ref: ValueSetRef = {
      plane: 'storage',
      entityKind: 'valueSet',
      namespaceId: UNBOUND_NAMESPACE_ID,
      entityName: 'Role',
      spaceId: 'other-space',
    };
    const col = new StorageColumn({ ...baseColumn, valueSet: ref });
    expect(col.valueSet?.spaceId).toBe('other-space');
  });

  it('leaves valueSet absent when not provided', () => {
    const col = new StorageColumn(baseColumn);
    expect(col.valueSet).toBeUndefined();
  });

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

  it('ref entityKind equals the entries slot key it resolves in', () => {
    const ref: ValueSetRef = {
      plane: 'storage',
      entityKind: 'valueSet',
      namespaceId: UNBOUND_NAMESPACE_ID,
      entityName: 'Role',
    };
    const ns = createTestSqlNamespace({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {},
        valueSet: { Role: new StorageValueSet({ kind: 'valueSet', values: ['user'] }) },
      },
    });
    const resolved = ns.entries.valueSet?.[ref.entityName];
    expect(resolved).toBeDefined();
    expect(ref.entityKind).toBe('valueSet');
  });
});

describe('isStorageValueSet', () => {
  it('returns true for a real StorageValueSet instance', () => {
    const vs = new StorageValueSet({ kind: 'valueSet', values: ['a', 'b'] });
    expect(isStorageValueSet(vs)).toBe(true);
  });

  it('returns true for a duck-typed plain object with kind and values', () => {
    const ducked = { kind: 'valueSet', values: ['a'] };
    expect(isStorageValueSet(ducked)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isStorageValueSet(null)).toBe(false);
  });

  it('returns false for a non-object primitive', () => {
    expect(isStorageValueSet('not-a-value-set')).toBe(false);
  });

  it('returns false when kind is missing', () => {
    expect(isStorageValueSet({ values: ['a'] })).toBe(false);
  });

  it('returns false when kind has the wrong value', () => {
    expect(isStorageValueSet({ kind: 'table', values: ['a'] })).toBe(false);
  });

  it('returns false when values is missing', () => {
    expect(isStorageValueSet({ kind: 'valueSet' })).toBe(false);
  });
});
