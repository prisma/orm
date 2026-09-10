import type { SqlQueryable } from '@internal/sql-relational-core/ast';
import { describe, expect, it, vi } from 'vitest';
import { guardQueryable } from '../src/guard-queryable';

function fixture() {
  let open = true;
  const nextRow = vi.fn();
  const closed = vi.fn();
  const source: SqlQueryable = {
    async *query<Row>() {
      try {
        for (const value of [1, 2]) {
          nextRow();
          yield { value } as Row;
        }
      } finally {
        closed();
      }
    },
    execute: vi.fn(async () => ({ affectedRows: 1 })),
  };
  const guarded = guardQueryable(source, () => {
    if (!open) throw new Error('closed');
  });
  return {
    guarded,
    source,
    nextRow,
    closed,
    invalidate: () => {
      open = false;
    },
  };
}

describe('guardQueryable', () => {
  it('checks lazy iteration and statistics before entering the source', async () => {
    const f = fixture();
    const rows = f.guarded.query({ sql: 'SELECT value' });
    f.invalidate();
    await expect(rows[Symbol.asyncIterator]().next()).rejects.toThrow('closed');
    await expect(f.guarded.execute({ sql: 'UPDATE values' })).rejects.toThrow('closed');
    expect(f.nextRow).not.toHaveBeenCalled();
    expect(f.source.execute).not.toHaveBeenCalled();
  });

  it('closes a suspended stream without fetching another row after invalidation', async () => {
    const f = fixture();
    const iterator = f.guarded.query({ sql: 'SELECT value' })[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: { value: 1 } });
    f.invalidate();
    await expect(iterator.next()).rejects.toThrow('closed');
    expect(f.nextRow).toHaveBeenCalledTimes(1);
    expect(f.closed).toHaveBeenCalledTimes(1);
  });

  it('preserves active rows, statistics and cancellation', async () => {
    const f = fixture();
    for await (const row of f.guarded.query({ sql: 'SELECT value' })) {
      expect(row).toEqual({ value: 1 });
      break;
    }
    expect(f.closed).toHaveBeenCalledTimes(1);
    expect(await f.guarded.execute({ sql: 'UPDATE values' })).toEqual({ affectedRows: 1 });
  });
});
