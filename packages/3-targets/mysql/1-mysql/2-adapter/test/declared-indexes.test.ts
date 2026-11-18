import { describe, expect, it } from 'vitest';
import { declaredIndexes } from '../src/core/migrations/declared-indexes';

const contractWith = (indexes: readonly unknown[]) => ({
  storage: {
    namespaces: { __unbound__: { entries: { table: { T: { columns: {}, indexes } } } } },
  },
});

describe('declaredIndexes', () => {
  it('answers which indexes, and which unique indexes, the contract declares on which table', () => {
    const declared = declaredIndexes(
      contractWith([
        { name: 'T_handle_idx', columns: ['handle'], unique: true },
        { name: 'T_name_idx', columns: ['name'], unique: false },
      ]),
    );
    expect({
      index: {
        unique: declared.declaresIndex('T', 'T_handle_idx'),
        plain: declared.declaresIndex('T', 'T_name_idx'),
        undeclared: declared.declaresIndex('T', 'T_other_idx'),
        otherTable: declared.declaresIndex('U', 'T_name_idx'),
      },
      uniqueIndex: {
        unique: declared.declaresUniqueIndex('T', 'T_handle_idx'),
        plain: declared.declaresUniqueIndex('T', 'T_name_idx'),
        otherTable: declared.declaresUniqueIndex('U', 'T_handle_idx'),
      },
    }).toEqual({
      index: { unique: true, plain: true, undeclared: false, otherTable: false },
      uniqueIndex: { unique: true, plain: false, otherTable: false },
    });
  });

  it('reads every contract of a stack of contract spaces', () => {
    const declared = declaredIndexes({
      contracts: [contractWith([]), contractWith([{ name: 'T_handle_idx', unique: true }])],
    });
    expect({
      index: declared.declaresIndex('T', 'T_handle_idx'),
      uniqueIndex: declared.declaresUniqueIndex('T', 'T_handle_idx'),
    }).toEqual({ index: true, uniqueIndex: true });
  });

  it('declares nothing without a contract', () => {
    const declared = declaredIndexes(undefined);
    expect({
      index: declared.declaresIndex('T', 'T_handle_idx'),
      uniqueIndex: declared.declaresUniqueIndex('T', 'T_handle_idx'),
    }).toEqual({ index: false, uniqueIndex: false });
  });
});
