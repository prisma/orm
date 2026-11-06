import { col, lit } from '@internal/sql-relational-core/contract-free';
import { describe, expect, it } from 'vitest';
import { createSchema, createTable } from '../../src/exports/contract-free';

describe('postgres contract-free ddl', () => {
  it('createSchema returns a frozen create-schema node', () => {
    const node = createSchema({ schema: 'prisma_contract', ifNotExists: true });
    expect(node.kind).toBe('create-schema');
    expect(node.schema).toBe('prisma_contract');
    expect(node.ifNotExists).toBe(true);
    expect(Object.isFrozen(node)).toBe(true);
  });

  it('createTable returns a frozen create-table node', () => {
    const node = createTable({
      schema: 'prisma_contract',
      table: 'marker',
      ifNotExists: true,
      columns: [col('space', 'text', { notNull: true, primaryKey: true, default: lit('app') })],
    });
    expect(node.kind).toBe('create-table');
    expect(node.table).toBe('marker');
    expect(node.schema).toBe('prisma_contract');
    expect(node.columns).toHaveLength(1);
    expect(Object.isFrozen(node)).toBe(true);
    expect(Object.isFrozen(node.columns)).toBe(true);
  });
});
