import { BinaryExpr, ColumnRef, OrderByItem, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  type BulkTarget,
  deleteAllGraph,
  updateAllGraph,
} from '../../src/mutation-graph/bulk-graphs';
import { printGraph } from '../../src/mutation-graph/print-graph';
import { createCollectionFor } from '../collection-fixtures';
import { usersTable } from './tables';

const nameIsAda = BinaryExpr.eq(ColumnRef.of('users', 'name'), ParamRef.of('Ada'));

const target: BulkTarget = {
  table: usersTable,
  where: [nameIsAda],
  read: {
    orderBy: [OrderByItem.asc(ColumnRef.of('users', 'id'))],
    offset: undefined,
    cursor: undefined,
    distinct: undefined,
    distinctOn: undefined,
    limit: undefined,
  },
  selectedFields: ['id', 'name'],
  includes: [],
};

function targetWithIncludes(): BulkTarget {
  const { collection } = createCollectionFor('User');
  return { ...target, includes: collection.include('posts').state.includes };
}

describe('updateAllGraph', () => {
  it('builds one Update as the rows result for updateAll', () => {
    const graph = updateAllGraph(target, { email: 'ada@example.com' }, 'rows');

    expect(printGraph(graph)).toBe(
      ["n1 Update users set email = 'ada@example.com' where name = 'Ada'", 'result: n1 rows'].join(
        '\n',
      ),
    );
    expect(graph.result).toMatchObject({ selectedFields: ['id', 'name'], includes: [] });
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
});

describe('deleteAllGraph', () => {
  it('builds one Delete as the rows result for deleteAll', () => {
    const graph = deleteAllGraph(target, 'rows');

    expect(printGraph(graph)).toBe(
      ["n1 Delete users where name = 'Ada'", 'result: n1 rows'].join('\n'),
    );
    expect(graph.result).toMatchObject({ selectedFields: ['id', 'name'], includes: [] });
  });

  it('builds a Find and a Delete after it for deleteAll with includes', () => {
    const withIncludes = targetWithIncludes();

    const graph = deleteAllGraph(withIncludes, 'rows');

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' order by id asc",
        "n2 Delete users where name = 'Ada' <- After n1",
        'result: n1 rows',
      ].join('\n'),
    );
    expect(graph.result).toMatchObject({
      selectedFields: ['id', 'name'],
      includes: withIncludes.includes,
    });
  });

  it('builds one Delete as the count result for deleteAndCount, with or without includes', () => {
    const expected = ["n1 Delete users where name = 'Ada'", 'result: n1 count'].join('\n');

    expect(printGraph(deleteAllGraph(target, 'count'))).toBe(expected);
    expect(printGraph(deleteAllGraph(targetWithIncludes(), 'count'))).toBe(expected);
  });
});
