import { describe, expect, it } from 'vitest';
import { backingIndexColumnKeys } from '../src/foreign-key-materialization';

const backsForeignKey = (indexType: string) => indexType === 'ordered';

function keysOf(index: { readonly type?: string; readonly where?: string }) {
  return backingIndexColumnKeys(
    { indexes: [{ columns: ['author_id'], ...index }], uniques: [], primaryKey: undefined },
    backsForeignKey,
  );
}

describe('backingIndexColumnKeys', () => {
  it('counts an index of the default type', () => {
    expect(keysOf({})).toEqual(['author_id']);
  });

  it('counts an index whose type can back a foreign key', () => {
    expect(keysOf({ type: 'ordered' })).toEqual(['author_id']);
  });

  it('does not count an index whose type cannot back a foreign key', () => {
    expect(keysOf({ type: 'search' })).toEqual([]);
  });

  it('does not count a partial index', () => {
    expect(keysOf({ where: 'deleted_at IS NULL' })).toEqual([]);
  });

  it('does not count an index without a column tuple, such as an expression index', () => {
    expect(
      backingIndexColumnKeys(
        { indexes: [{ type: undefined }], uniques: [], primaryKey: undefined },
        backsForeignKey,
      ),
    ).toEqual([]);
  });

  it('counts unique constraints and the primary key', () => {
    expect(
      backingIndexColumnKeys(
        { indexes: [], uniques: [{ columns: ['a', 'b'] }], primaryKey: { columns: ['id'] } },
        backsForeignKey,
      ),
    ).toEqual(['a,b', 'id']);
  });
});
