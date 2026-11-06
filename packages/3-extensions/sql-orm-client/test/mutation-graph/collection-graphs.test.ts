import { describe, expect, it } from 'vitest';
import { createStatementTables } from '../../src/collection-tables';
import {
  deleteAllGraph,
  deleteFirstGraph,
  updateAllGraph,
  updateFirstGraph,
} from '../../src/mutation-graph/collection-graphs';
import type { CollectionState } from '../../src/types';
import { createCollectionFor } from '../collection-fixtures';
import { getTestContext } from '../helpers';
import { printGraph } from './print-graph';
import { returnedAt } from './statements';

const users = createCollectionFor('User')
  .collection.where({ name: 'Ada' })
  .orderBy((user) => user.id.asc())
  .select('id', 'name');

function targetOf(state: CollectionState) {
  return {
    context: getTestContext(),
    state,
    modelName: 'User',
    namespaceId: 'public',
  };
}

const target = targetOf(users.state);
const tableWithNoIdentity = createStatementTables({
  namespaceId: 'public',
  tableName: 'no_such_table',
});
const targetWithIncludes = targetOf(users.include('posts').state);

describe('updateAllGraph', () => {
  it('builds one Update as the result, returning nothing yet', () => {
    const graph = updateAllGraph(target, { email: 'ada@example.com' }, 'rows');

    expect(printGraph(graph)).toBe(
      ["n1 Update users set email = 'ada@example.com' where name = 'Ada'", 'result: n1'].join('\n'),
    );
    expect(returnedAt(graph, 0)).toEqual([]);
  });

  it('adds a Find that reads the written rows with their includes, as the result', () => {
    const graph = updateAllGraph(targetWithIncludes, { email: 'ada@example.com' }, 'rows');

    expect(printGraph(graph)).toBe(
      [
        "n1 Update users set email = 'ada@example.com' where name = 'Ada'",
        'n2 Find users <- FilterData n1 (id->id)',
        'result: n2',
      ].join('\n'),
    );
    expect(returnedAt(graph, 0)).toEqual(['id']);
    expect(returnedAt(graph, 1)).toEqual(['id', 'name', 'posts']);
  });

  it('refuses includes on a table with no identity columns', () => {
    const noIdentity = targetOf({ ...users.include('posts').state, tables: tableWithNoIdentity });

    expect(() => updateAllGraph(noIdentity, { email: 'ada@example.com' }, 'rows')).toThrow(
      expect.objectContaining({
        code: 'ORM.ROW_IDENTITY_MISSING',
        message:
          'Cannot load includes for the mutation result on model "User": table "no_such_table" has no primary key or unique constraint to key the include read-back on.',
      }),
    );
  });

  it('builds a Find of the same rows as the result when nothing is set', () => {
    const graph = updateAllGraph(target, {}, 'rows');

    expect(printGraph(graph)).toBe(
      ["n1 Find users where name = 'Ada' order by id asc", 'result: n1'].join('\n'),
    );
    expect(returnedAt(graph, 0)).toEqual(['id', 'name']);
  });

  it('gives that Find the includes of the caller', () => {
    const graph = updateAllGraph(targetWithIncludes, {}, 'rows');

    expect(returnedAt(graph, 0)).toEqual(['id', 'name', 'posts']);
  });
});

describe('deleteAllGraph', () => {
  it('builds one Delete as the result, returning nothing yet', () => {
    const graph = deleteAllGraph(target, 'rows');

    expect(printGraph(graph)).toBe(["n1 Delete users where name = 'Ada'", 'result: n1'].join('\n'));
    expect(returnedAt(graph, 0)).toEqual([]);
  });

  it('builds a Find with the includes as the result and then a Delete when there are includes', () => {
    const graph = deleteAllGraph(targetWithIncludes, 'rows');

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' order by id asc",
        "n2 Delete users where name = 'Ada'",
        'result: n1',
      ].join('\n'),
    );
    expect(returnedAt(graph, 0)).toEqual(['id', 'name', 'posts']);
    expect(returnedAt(graph, 1)).toEqual([]);
  });

  it('does not make that Find return identity columns', () => {
    const graph = deleteAllGraph(targetOf(users.select('name').include('posts').state), 'rows');

    expect(returnedAt(graph, 0)).toEqual(['name', 'posts']);
  });
});

describe('updateFirstGraph', () => {
  it('builds a Find of the first row and an Update of the row it finds', () => {
    const graph = updateFirstGraph(target, { email: 'ada@example.com' });

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' order by id asc limit 1",
        "n2 Update users set email = 'ada@example.com' <- FilterData n1 (id->id)",
        'result: n2',
      ].join('\n'),
    );
    expect(returnedAt(graph, 0)).toEqual(['id']);
    expect(returnedAt(graph, 1)).toEqual([]);
  });

  it('adds a Find that reads the updated row with its includes, as the result', () => {
    const graph = updateFirstGraph(targetWithIncludes, { email: 'ada@example.com' });

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' order by id asc limit 1",
        "n2 Update users set email = 'ada@example.com' <- FilterData n1 (id->id)",
        'n3 Find users <- FilterData n2 (id->id)',
        'result: n3',
      ].join('\n'),
    );
    expect(returnedAt(graph, 1)).toEqual(['id']);
    expect(returnedAt(graph, 2)).toEqual(['id', 'name', 'posts']);
  });

  it('keeps the offset of the collection and reads one row whatever its limit', () => {
    const paged = targetOf(users.limit(10).offset(2).state);

    expect(printGraph(updateFirstGraph(paged, { email: 'ada@example.com' }))).toContain(
      "n1 Find users where name = 'Ada' order by id asc limit 1 offset 2",
    );
  });

  it('builds the Find of the first row as the result when nothing is set', () => {
    const graph = updateFirstGraph(target, {});

    expect(printGraph(graph)).toBe(
      ["n1 Find users where name = 'Ada' order by id asc limit 1", 'result: n1'].join('\n'),
    );
    expect(returnedAt(graph, 0)).toEqual(['id', 'name']);
  });

  it('gives that Find the includes of the caller', () => {
    const graph = updateFirstGraph(targetWithIncludes, {});

    expect(returnedAt(graph, 0)).toEqual(['id', 'name', 'posts']);
  });

  it('builds a graph with no node after limit(0) when nothing is set', () => {
    expect(printGraph(updateFirstGraph(targetOf(users.limit(0).state), {}))).toBe('result: none');
  });

  it('builds a graph with no node after limit(0)', () => {
    const limited = targetOf(users.limit(0).state);

    expect(printGraph(updateFirstGraph(limited, { email: 'ada@example.com' }))).toBe(
      'result: none',
    );
  });

  it('refuses a limit that is not a whole number from zero up', () => {
    const limited = targetOf({ ...users.state, limit: -1 });

    expect(() => updateFirstGraph(limited, { email: 'ada@example.com' })).toThrow(
      expect.objectContaining({ code: 'ORM.ARGUMENT_INVALID' }),
    );
  });

  it('refuses a table with no identity columns', () => {
    const noIdentity = targetOf({ ...users.state, tables: tableWithNoIdentity });

    expect(() => updateFirstGraph(noIdentity, { email: 'ada@example.com' })).toThrow(
      expect.objectContaining({
        code: 'ORM.ROW_IDENTITY_MISSING',
        message:
          'update()/delete() on model "User" requires the table to have a primary key or unique constraint',
        meta: { model: 'User', table: 'no_such_table' },
      }),
    );
  });
});

describe('deleteFirstGraph', () => {
  it('builds a Find of the first row and a Delete of the row it finds', () => {
    const graph = deleteFirstGraph(target);

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' order by id asc limit 1",
        'n2 Delete users <- FilterData n1 (id->id)',
        'result: n2',
      ].join('\n'),
    );
  });

  it('makes the Find carry the includes and be the result when there are includes', () => {
    const graph = deleteFirstGraph(targetWithIncludes);

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' order by id asc limit 1",
        'n2 Delete users <- FilterData n1 (id->id)',
        'result: n1',
      ].join('\n'),
    );
    expect(returnedAt(graph, 0)).toEqual(['id', 'name', 'posts']);
    expect(returnedAt(graph, 1)).toEqual([]);
  });

  it('makes that Find also return the identity columns the Delete reads', () => {
    const graph = deleteFirstGraph(targetOf(users.select('name').include('posts').state));

    expect(returnedAt(graph, 0)).toEqual(['name', 'posts', 'id']);
  });

  it('builds a graph with no node after limit(0) with includes', () => {
    const limited = targetOf(users.include('posts').limit(0).state);

    expect(printGraph(deleteFirstGraph(limited))).toBe('result: none');
  });

  it('builds a graph with no node after limit(0)', () => {
    expect(printGraph(deleteFirstGraph(targetOf(users.limit(0).state)))).toBe('result: none');
  });

  it('refuses a table with no identity columns', () => {
    const noIdentity = targetOf({ ...users.state, tables: tableWithNoIdentity });

    expect(() => deleteFirstGraph(noIdentity)).toThrow(
      expect.objectContaining({ code: 'ORM.ROW_IDENTITY_MISSING' }),
    );
  });
});
