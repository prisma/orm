import { describe, expect, it } from 'vitest';
import { changedBy } from '../../src/mutation-graph/changed-by';
import { cascadeContract as contract } from './cascade-contract';

function names(write: 'insert' | 'update' | 'delete', table: string): string[] {
  return changedBy(contract, write, { namespaceId: 'public', name: table }).map(
    (changed) => `${changed.namespaceId}.${changed.name}`,
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

  it('gives the table itself when no foreign key points at it', () => {
    expect(names('delete', 'Note')).toEqual(['public.Note']);
  });
});
