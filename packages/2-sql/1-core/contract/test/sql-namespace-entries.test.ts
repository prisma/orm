import { coreHash } from '@internal/contract/types';
import { elementCoordinates, UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { SqlStorage } from '../src/exports/types';
import { StorageTable } from '../src/ir/storage-table';
import { StorageValueSet } from '../src/ir/storage-value-set';
import { createTestSqlNamespace } from './test-support';

const emptyTableInput = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

const tableWithColumn = {
  columns: {
    id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
  },
  primaryKey: { columns: ['id'] },
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

describe('TestSqlNamespace — entries open dictionary', () => {
  it('exact-shape serialization: JSON.stringify emits only id and entries', () => {
    const ns = createTestSqlNamespace({
      id: 'app',
      entries: { table: { users: emptyTableInput } },
    });
    const parsed = JSON.parse(JSON.stringify(ns)) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['entries', 'id']);
  });

  it('kind is non-enumerable', () => {
    const ns = createTestSqlNamespace({ id: 'app', entries: { table: {} } });
    expect(Object.keys(ns)).not.toContain('kind');
    expect(ns.kind).toBeDefined();
  });

  it('entries is frozen after construction', () => {
    const ns = createTestSqlNamespace({
      id: 'app',
      entries: { table: { users: emptyTableInput } },
    });
    expect(Object.isFrozen(ns.entries)).toBe(true);
  });

  it('inner table map is frozen', () => {
    const ns = createTestSqlNamespace({
      id: 'app',
      entries: { table: { users: emptyTableInput } },
    });
    expect(Object.isFrozen(ns.entries['table'])).toBe(true);
  });

  it('table getter returns the frozen name-keyed map from entries', () => {
    const ns = createTestSqlNamespace({
      id: 'app',
      entries: { table: { users: emptyTableInput } },
    });
    expect(ns.table).toBe(ns.entries['table']);
  });

  it('table getter is non-enumerable', () => {
    const ns = createTestSqlNamespace({ id: 'app', entries: { table: {} } });
    expect(Object.keys(ns)).not.toContain('table');
  });

  it('table getter returns StorageTable instances', () => {
    const ns = createTestSqlNamespace({
      id: 'app',
      entries: { table: { users: emptyTableInput } },
    });
    expect(ns.table['users']).toBeInstanceOf(StorageTable);
  });

  it('valueSet getter returns the frozen name-keyed map when present', () => {
    const ns = createTestSqlNamespace({
      id: 'app',
      entries: {
        table: {},
        valueSet: { Role: { kind: 'value-set', values: ['admin', 'user'] } },
      },
    });
    expect(ns.valueSet).toBe(ns.entries['valueSet']);
  });

  it('valueSet getter is non-enumerable', () => {
    const ns = createTestSqlNamespace({ id: 'app', entries: { table: {} } });
    expect(Object.keys(ns)).not.toContain('valueSet');
  });

  it('valueSet getter returns undefined when absent (no valueSet in entries)', () => {
    const ns = createTestSqlNamespace({ id: 'app', entries: { table: {} } });
    expect(ns.valueSet).toBeUndefined();
  });

  it('valueSet getter returns StorageValueSet instances', () => {
    const ns = createTestSqlNamespace({
      id: 'app',
      entries: {
        table: {},
        valueSet: { Role: { kind: 'value-set', values: ['admin', 'user'] } },
      },
    });
    expect(ns.valueSet?.['Role']).toBeInstanceOf(StorageValueSet);
  });

  it('inner valueSet map is frozen when present', () => {
    const ns = createTestSqlNamespace({
      id: 'app',
      entries: {
        table: {},
        valueSet: { Role: { kind: 'value-set', values: ['admin', 'user'] } },
      },
    });
    expect(Object.isFrozen(ns.entries['valueSet'])).toBe(true);
  });

  it('construction dispatches table entries by key', () => {
    const ns = createTestSqlNamespace({
      id: 'app',
      entries: {
        table: { users: tableWithColumn },
      },
    });
    const tableEntry = ns.entries['table']?.['users'];
    expect(tableEntry).toBeInstanceOf(StorageTable);
  });

  it('construction dispatches valueSet entries by key', () => {
    const ns = createTestSqlNamespace({
      id: 'app',
      entries: {
        table: {},
        valueSet: { Status: { kind: 'value-set', values: ['active', 'inactive'] } },
      },
    });
    const vsEntry = ns.entries['valueSet']?.['Status'];
    expect(vsEntry).toBeInstanceOf(StorageValueSet);
  });

  it('node itself is frozen', () => {
    const ns = createTestSqlNamespace({ id: 'app', entries: { table: {} } });
    expect(Object.isFrozen(ns)).toBe(true);
  });

  it('carries an unknown kind through frozen as-is (permissive-carry)', () => {
    const bogusMap = Object.freeze({ foo: { x: 1 } });
    const ns = createTestSqlNamespace({
      id: 'app',
      entries: { table: {}, bogus: bogusMap } as never,
    });
    expect(ns.entries['bogus']).toEqual(bogusMap);
    expect(Object.isFrozen(ns.entries['bogus'])).toBe(true);
  });

  it('unknown kind survives JSON.stringify round-trip', () => {
    const ns = createTestSqlNamespace({
      id: 'app',
      entries: { table: {}, bogus: { item: { value: 42 } } } as never,
    });
    const parsed = JSON.parse(JSON.stringify(ns)) as Record<string, unknown>;
    expect((parsed['entries'] as Record<string, unknown>)['bogus']).toEqual({
      item: { value: 42 },
    });
  });

  it('unbound id with only an unknown kind preserves the unknown entry', () => {
    const ns = createTestSqlNamespace({
      id: UNBOUND_NAMESPACE_ID,
      entries: { bogus: { item: {} } } as never,
    });
    expect(ns.entries['bogus']).toBeDefined();
  });

  it('elementCoordinates yields unknown-kind entries', () => {
    const ns = createTestSqlNamespace({
      id: 'app',
      entries: { table: {}, bogus: { myEntity: {} } } as never,
    });
    const storage = new SqlStorage({
      storageHash: coreHash('carry-test'),
      namespaces: { app: ns },
    });
    const coords = [...elementCoordinates(storage)];
    expect(coords).toContainEqual({
      plane: 'storage',
      namespaceId: 'app',
      entityKind: 'bogus',
      entityName: 'myEntity',
    });
  });

  it('entries[kind][name] resolves the same as the getter[name]', () => {
    const ns = createTestSqlNamespace({
      id: 'app',
      entries: { table: { users: emptyTableInput } },
    });
    expect(ns.entries['table']?.['users']).toBe(ns.table['users']);
  });
});
