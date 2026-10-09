import { describe, expect, it } from 'vitest';
import {
  deleteAllGraph,
  deleteFirstGraph,
  updateAllGraph,
  updateFirstGraph,
} from '../../src/mutation-graph/collection-graphs';
import { printGraph } from '../../src/mutation-graph/print-graph';
import type { CollectionState } from '../../src/types';
import { createCollectionFor } from '../collection-fixtures';
import { getTestContext } from '../helpers';

const users = createCollectionFor('User')
  .collection.where({ name: 'Ada' })
  .orderBy((user) => user.id.asc())
  .select('id', 'name');

function targetOf(state: CollectionState) {
  return {
    context: getTestContext(),
    state,
    tableName: 'users',
    modelName: 'User',
    namespaceId: 'public',
  };
}

const target = targetOf(users.state);
const targetWithIncludes = targetOf(users.include('posts').state);

describe('updateAllGraph', () => {
  it('builds one Update as the rows result for updateAll', () => {
    const graph = updateAllGraph(target, { email: 'ada@example.com' }, 'rows');

    expect(printGraph(graph)).toBe(
      ["n1 Update users set email = 'ada@example.com' where name = 'Ada'", 'result: n1 rows'].join(
        '\n',
      ),
    );
    expect(graph.result.collection).toBe(target);
  });

  it('builds one Update as the count result for updateAndCount', () => {
    const graph = updateAllGraph(target, { email: 'ada@example.com' }, 'count');

    expect(printGraph(graph)).toBe(
      ["n1 Update users set email = 'ada@example.com' where name = 'Ada'", 'result: n1 count'].join(
        '\n',
      ),
    );
  });

  it('builds a graph with no node and an empty result when nothing is set', () => {
    expect(printGraph(updateAllGraph(target, {}, 'rows'))).toBe('result: none');
    expect(printGraph(updateAllGraph(target, {}, 'count'))).toBe('result: none');
  });

  it('makes the Update return the selection of the caller for rows and nothing for a count', () => {
    const rows = updateAllGraph(target, { email: 'ada@example.com' }, 'rows');
    const count = updateAllGraph(target, { email: 'ada@example.com' }, 'count');

    expect(rows.nodeAt(0)?.returns.map((column) => column.alias)).toEqual(['id', 'name']);
    expect(count.nodeAt(0)?.returns).toEqual([]);
  });

  it('makes the Update return the identity columns when includes will be loaded', () => {
    const graph = updateAllGraph(targetWithIncludes, { email: 'ada@example.com' }, 'rows');

    expect(graph.nodeAt(0)?.returns.map((column) => column.alias)).toEqual(['id']);
  });
});

describe('deleteAllGraph', () => {
  it('builds one Delete as the rows result for deleteAll', () => {
    const graph = deleteAllGraph(target, 'rows');

    expect(printGraph(graph)).toBe(
      ["n1 Delete users where name = 'Ada'", 'result: n1 rows'].join('\n'),
    );
    expect(graph.result.collection).toBe(target);
  });

  it('builds a Find of the identity columns and a Delete after it for deleteAll with includes', () => {
    const graph = deleteAllGraph(targetWithIncludes, 'rows');

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' order by id asc",
        "n2 Delete users where name = 'Ada' <- After n1",
        'result: n1 rows',
      ].join('\n'),
    );
    expect(graph.nodeAt(0)?.returns.map((column) => column.alias)).toEqual(['id']);
    expect(graph.nodeAt(1)?.returns).toEqual([]);
    expect(graph.result.collection).toBe(targetWithIncludes);
  });

  it('builds one Delete as the count result for deleteAndCount, with or without includes', () => {
    const expected = ["n1 Delete users where name = 'Ada'", 'result: n1 count'].join('\n');

    expect(printGraph(deleteAllGraph(target, 'count'))).toBe(expected);
    expect(printGraph(deleteAllGraph(targetWithIncludes, 'count'))).toBe(expected);
  });
});

describe('updateFirstGraph', () => {
  it('builds a Find of the first row and an Update of the row it finds', () => {
    const graph = updateFirstGraph(target, { email: 'ada@example.com' });

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' order by id asc limit 1",
        "n2 Update users set email = 'ada@example.com' <- FilterData n1 (id->id)",
        'result: n2 first row',
      ].join('\n'),
    );
    expect(graph.nodeAt(0)?.returns.map((column) => column.alias)).toEqual(['id']);
    expect(graph.nodeAt(1)?.returns.map((column) => column.alias)).toEqual(['id', 'name']);
    expect(graph.result.collection).toBe(target);
  });

  it('builds the same graph with includes, which the result carries', () => {
    const graph = updateFirstGraph(targetWithIncludes, { email: 'ada@example.com' });

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' order by id asc limit 1",
        "n2 Update users set email = 'ada@example.com' <- FilterData n1 (id->id)",
        'result: n2 first row',
      ].join('\n'),
    );
    expect(graph.result.collection).toBe(targetWithIncludes);
  });

  it('keeps the offset of the collection and reads one row whatever its limit', () => {
    const paged = targetOf(users.limit(10).offset(2).state);

    expect(printGraph(updateFirstGraph(paged, { email: 'ada@example.com' }))).toContain(
      "n1 Find users where name = 'Ada' order by id asc limit 1 offset 2",
    );
  });

  it('builds the Find alone with an empty result when nothing is set', () => {
    expect(printGraph(updateFirstGraph(target, {}))).toBe(
      ["n1 Find users where name = 'Ada' order by id asc limit 1", 'result: none'].join('\n'),
    );
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
    const noIdentity = { ...target, tableName: 'no_such_table' };

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
        'result: n2 first row',
      ].join('\n'),
    );
    expect(graph.result.collection).toBe(target);
  });

  it('makes the Find the result when there are includes', () => {
    const graph = deleteFirstGraph(targetWithIncludes);

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' order by id asc limit 1",
        'n2 Delete users <- FilterData n1 (id->id)',
        'result: n1 first row',
      ].join('\n'),
    );
    expect(graph.result.collection).toBe(targetWithIncludes);
  });

  it('builds a graph with no node after limit(0)', () => {
    expect(printGraph(deleteFirstGraph(targetOf(users.limit(0).state)))).toBe('result: none');
  });

  it('refuses a table with no identity columns', () => {
    expect(() => deleteFirstGraph({ ...target, tableName: 'no_such_table' })).toThrow(
      expect.objectContaining({ code: 'ORM.ROW_IDENTITY_MISSING' }),
    );
  });
});
