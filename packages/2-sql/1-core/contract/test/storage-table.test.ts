import { describe, expect, it } from 'vitest';
import { StorageTable } from '../src/ir/storage-table';

function makeValidTable(): StorageTable {
  return new StorageTable({
    columns: {
      id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
    },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  });
}

describe('StorageTable.is', () => {
  it('returns true for a real StorageTable instance', () => {
    expect(StorageTable.is(makeValidTable())).toBe(true);
  });

  it('returns true for a duck-typed plain object with all required keys', () => {
    const ducked = {
      columns: {},
      uniques: [],
      indexes: [],
      foreignKeys: [],
    } as unknown as StorageTable;
    expect(StorageTable.is(ducked)).toBe(true);
  });

  it('returns false for undefined', () => {
    expect(StorageTable.is(undefined)).toBe(false);
  });

  it('returns false for null', () => {
    expect(StorageTable.is(null as unknown as StorageTable)).toBe(false);
  });

  it('returns false for a non-object primitive', () => {
    expect(StorageTable.is('not-a-table' as unknown as StorageTable)).toBe(false);
  });

  it('returns false when columns is missing', () => {
    const missingColumns = {
      uniques: [],
      indexes: [],
      foreignKeys: [],
    } as unknown as StorageTable;
    expect(StorageTable.is(missingColumns)).toBe(false);
  });

  it('returns false when uniques is missing', () => {
    const missingUniques = {
      columns: {},
      indexes: [],
      foreignKeys: [],
    } as unknown as StorageTable;
    expect(StorageTable.is(missingUniques)).toBe(false);
  });

  it('returns false when indexes is missing', () => {
    const missingIndexes = {
      columns: {},
      uniques: [],
      foreignKeys: [],
    } as unknown as StorageTable;
    expect(StorageTable.is(missingIndexes)).toBe(false);
  });

  it('returns false when foreignKeys is missing', () => {
    const missingForeignKeys = {
      columns: {},
      uniques: [],
      indexes: [],
    } as unknown as StorageTable;
    expect(StorageTable.is(missingForeignKeys)).toBe(false);
  });
});

describe('StorageTable.assert', () => {
  it('does not throw for a real StorageTable instance', () => {
    expect(() => StorageTable.assert(makeValidTable(), 'test.coordinate')).not.toThrow();
  });

  it('throws InternalError naming the coordinate when the value is not a StorageTable', () => {
    expect(() => StorageTable.assert(undefined, 'namespaces.public.table.users')).toThrow(
      /Expected a StorageTable at namespaces\.public\.table\.users/,
    );
  });
});
