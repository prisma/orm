import { describe, expect, it } from 'vitest';
import { changedBy } from '../../src/mutation-graph/changed-by';
import { cascadeContract as contract } from './cascade-contract';

function names(write: 'insert' | 'update' | 'delete', table: string): string[] {
  return changedBy(contract, write, { namespaceId: 'public', tableName: table }).map(
    (changed) => `${changed.namespaceId}.${changed.tableName}`,
  );
}

describe('changedBy', () => {
  it('gives only the table itself for an insert', () => {
    expect(names('insert', 'Org')).toEqual(['public.Org']);
  });

  it('follows onDelete cascade, set null and set default over two hops, and stops at restrict and no action', () => {
    expect(names('delete', 'Org')).toEqual([
      'public.Org',
      'public.Team',
      'public.Member',
      'public.Badge',
    ]);
  });

  it('follows onUpdate actions, not onDelete ones', () => {
    expect(names('update', 'Org')).toEqual(['public.Org', 'public.Team', 'public.Badge']);
  });

  it('gives each table of a cycle once', () => {
    expect(names('delete', 'Left')).toEqual(['public.Left', 'public.Right']);
  });

  it('follows onUpdate from a table a delete sets a column of to null', () => {
    expect(names('delete', 'Order')).toEqual(['public.Order', 'public.Shipment', 'public.Label']);
  });

  it('follows a table reached as an update and as a delete both ways', () => {
    expect([...names('delete', 'Root')].sort()).toEqual([
      'public.DeletedWithLeaf',
      'public.Leaf',
      'public.Mid',
      'public.Root',
      'public.UpdatedWithLeaf',
    ]);
  });

  it('gives the table itself when no foreign key points at it', () => {
    expect(names('delete', 'Note')).toEqual(['public.Note']);
  });
});
