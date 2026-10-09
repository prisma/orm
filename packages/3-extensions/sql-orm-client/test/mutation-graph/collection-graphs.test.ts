import { BinaryExpr, ColumnRef, OrderByItem, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  deleteAllGraph,
  deleteFirstGraph,
  updateAllGraph,
  updateFirstGraph,
  type WriteTarget,
} from '../../src/mutation-graph/collection-graphs';
import { printGraph } from '../../src/mutation-graph/print-graph';
import { createCollectionFor } from '../collection-fixtures';
import { usersTable } from './tables';

const nameIsAda = BinaryExpr.eq(ColumnRef.of('users', 'name'), ParamRef.of('Ada'));

const target: WriteTarget = {
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

function targetWithIncludes(): WriteTarget {
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

describe('updateFirstGraph', () => {
  it('builds a Find of the first row and an Update of the row it finds', () => {
    const graph = updateFirstGraph(target, ['id'], { email: 'ada@example.com' });

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' order by id asc limit 1",
        "n2 Update users set email = 'ada@example.com' <- IntoWhere n1 (id->id)",
        'result: n2 first row',
      ].join('\n'),
    );
    expect(graph.result).toMatchObject({ selectedFields: ['id', 'name'], includes: [] });
  });

  it('builds the same graph with includes, which the result carries', () => {
    const withIncludes = targetWithIncludes();

    const graph = updateFirstGraph(withIncludes, ['id'], { email: 'ada@example.com' });

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' order by id asc limit 1",
        "n2 Update users set email = 'ada@example.com' <- IntoWhere n1 (id->id)",
        'result: n2 first row',
      ].join('\n'),
    );
    expect(graph.result).toMatchObject({ includes: withIncludes.includes });
  });

  it('joins on every identity column', () => {
    const graph = updateFirstGraph(target, ['tenant_id', 'id'], { email: 'ada@example.com' });

    expect(printGraph(graph)).toContain('<- IntoWhere n1 (tenant_id->tenant_id, id->id)');
  });

  it('keeps the offset, cursor, distinct and distinct on of the collection and reads one row', () => {
    const paged: WriteTarget = {
      ...target,
      read: {
        orderBy: undefined,
        offset: 2,
        cursor: { id: 5 },
        distinct: ['name'],
        distinctOn: ['email'],
        limit: 10,
      },
    };

    expect(printGraph(updateFirstGraph(paged, ['id'], { email: 'ada@example.com' }))).toContain(
      "n1 Find users where name = 'Ada' limit 1 offset 2 cursor (id = 5) distinct (name) distinct on (email)",
    );
  });

  it('builds the Find alone with an empty result when nothing is set', () => {
    expect(printGraph(updateFirstGraph(target, ['id'], {}))).toBe(
      ["n1 Find users where name = 'Ada' order by id asc limit 1", 'result: none'].join('\n'),
    );
  });

  it('builds a graph with no node after limit(0)', () => {
    const limited = { ...target, read: { ...target.read, limit: 0 } };

    expect(printGraph(updateFirstGraph(limited, ['id'], { email: 'ada@example.com' }))).toBe(
      'result: none',
    );
  });

  it('refuses a limit that is not a whole number from zero up', () => {
    const limited = { ...target, read: { ...target.read, limit: -1 } };

    expect(() => updateFirstGraph(limited, ['id'], { email: 'ada@example.com' })).toThrow(
      expect.objectContaining({ code: 'ORM.ARGUMENT_INVALID' }),
    );
  });

  it('refuses a table with no identity columns', () => {
    expect(() => updateFirstGraph(target, [], { email: 'ada@example.com' })).toThrow(
      expect.objectContaining({
        code: 'ORM.ROW_IDENTITY_MISSING',
        message:
          'update()/delete() on model "User" requires the table to have a primary key or unique constraint',
        meta: { model: 'User', table: 'users' },
      }),
    );
  });
});

describe('deleteFirstGraph', () => {
  it('builds a Find of the first row and a Delete of the row it finds', () => {
    const graph = deleteFirstGraph(target, ['id']);

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' order by id asc limit 1",
        'n2 Delete users <- IntoWhere n1 (id->id)',
        'result: n2 first row',
      ].join('\n'),
    );
    expect(graph.result).toMatchObject({ selectedFields: ['id', 'name'], includes: [] });
  });

  it('reads the found row with its includes before the Delete when there are includes', () => {
    const withIncludes = targetWithIncludes();

    const graph = deleteFirstGraph(withIncludes, ['id']);

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' order by id asc limit 1",
        'n2 Find users order by id asc <- IntoWhere n1 (id->id)',
        'n3 Delete users <- IntoWhere n1 (id->id), After n2',
        'result: n2 first row',
      ].join('\n'),
    );
    expect(graph.result).toMatchObject({
      selectedFields: ['id', 'name'],
      includes: withIncludes.includes,
    });
  });

  it('builds a graph with no node after limit(0)', () => {
    const limited = { ...target, read: { ...target.read, limit: 0 } };

    expect(printGraph(deleteFirstGraph(limited, ['id']))).toBe('result: none');
  });

  it('refuses a table with no identity columns', () => {
    expect(() => deleteFirstGraph(target, [])).toThrow(
      expect.objectContaining({ code: 'ORM.ROW_IDENTITY_MISSING' }),
    );
  });
});
