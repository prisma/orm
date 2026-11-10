import { col, fn, lit } from '@internal/sql-relational-core/contract-free';
import { describe, expect, it } from 'vitest';
import { createTable } from '../../src/exports/contract-free';

describe('sqlite contract-free ddl', () => {
  it('createTable returns a frozen create-table node', () => {
    const node = createTable({
      table: '_prisma_marker',
      ifNotExists: true,
      columns: [
        col('space', 'TEXT', { notNull: true, primaryKey: true, default: lit('app') }),
        col('updated_at', 'TEXT', { notNull: true, default: fn("datetime('now')") }),
      ],
    });
    expect(node.kind).toBe('create-table');
    expect(node.table).toBe('_prisma_marker');
    expect(node.columns).toHaveLength(2);
    expect(Object.isFrozen(node)).toBe(true);
  });
});
