import { describe, expect, it } from 'vitest';
import { createStatementTables } from '../../src/collection-tables';
import {
  deleteAllGraph,
  deleteFirstGraph,
  updateAllGraph,
  updateFirstGraph,
} from '../../src/mutation-graph/collection-graphs';
import type { Graph } from '../../src/mutation-graph/graph';
import type { CollectionState } from '../../src/types';
import { createCollectionFor } from '../collection-fixtures';
import { getTestContext } from '../helpers';
import { printGraph } from './print-graph';
import { returnedAt } from './statements';

const users = createCollectionFor('User')
  .collection.where({ name: 'Ada' })
  .orderBy((user) => user.id.asc())
  .select('id', 'name');

function targetOf(state: CollectionState, modelName = 'User') {
  return {
    context: getTestContext(),
    state,
    modelName,
    namespaceId: 'public',
  };
}

const target = targetOf(users.state);
const tableWithNoIdentity = createStatementTables({
  namespaceId: 'public',
  tableName: 'no_such_table',
});
const targetWithIncludes = targetOf(users.include('posts').state);

function printAsRun(graph: Graph): string {
  graph.removeUnreadFinds();
  return printGraph(graph);
}

describe('updateAllGraph', () => {
  it('builds one Update that returns the selected columns as the result, once the Find it folded is removed', () => {
    const graph = updateAllGraph(target, { email: 'ada@example.com' }, 'rows');

    expect(printAsRun(graph)).toBe(
      ["n1 Update users set email = 'ada@example.com' where name = 'Ada'", 'result: n1'].join('\n'),
    );
    expect(returnedAt(graph, 0)).toEqual(['id', 'name']);
  });

  it('builds one Update with the caller filter for a count', () => {
    const graph = updateAllGraph(target, { email: 'ada@example.com' }, 'count');

    expect(printAsRun(graph)).toBe(
      ["n1 Update users set email = 'ada@example.com' where name = 'Ada'", 'result: n1'].join('\n'),
    );
    expect(returnedAt(graph, 0)).toEqual([]);
  });

  it('adds a Find that reads the written rows with their includes, as the result', () => {
    const graph = updateAllGraph(targetWithIncludes, { email: 'ada@example.com' }, 'rows');

    expect(printAsRun(graph)).toBe(
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
  it('builds one Delete that returns the columns of the Find it stands for, as the result', () => {
    const graph = deleteAllGraph(target, 'rows');

    expect(printAsRun(graph)).toBe(["n1 Delete users where name = 'Ada'", 'result: n1'].join('\n'));
    expect(returnedAt(graph, 0)).toEqual(['id', 'name']);
  });

  it('builds one Delete that returns nothing for a count', () => {
    const graph = deleteAllGraph(target, 'count');

    expect(printAsRun(graph)).toBe(["n1 Delete users where name = 'Ada'", 'result: n1'].join('\n'));
    expect(returnedAt(graph, 0)).toEqual([]);
  });

  it('builds a Find with the includes as the result and then a Delete of the rows it found by key when there are includes', () => {
    const graph = deleteAllGraph(targetWithIncludes, 'rows');

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' order by id asc",
        "n2 Delete users where name = 'Ada' <- FilterData n1 (id->id)",
        'result: n1',
      ].join('\n'),
    );
    expect(returnedAt(graph, 0)).toEqual(['id', 'name', 'posts']);
    expect(returnedAt(graph, 1)).toEqual([]);
  });

  it('makes that Find also return the identity columns the Delete reads', () => {
    const graph = deleteAllGraph(targetOf(users.select('name').include('posts').state), 'rows');

    expect(returnedAt(graph, 0)).toEqual(['name', 'posts', 'id']);
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
    expect(returnedAt(graph, 1)).toEqual(['id', 'name']);
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
          'update() on model "User" requires the table to have a primary key or unique constraint',
        meta: { model: 'User', table: 'no_such_table' },
      }),
    );
  });
});

describe('deleteFirstGraph', () => {
  it('builds a Find of the first row as the result and a Delete of the row it finds, which returns nothing', () => {
    const graph = deleteFirstGraph(target);

    expect(printAsRun(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' order by id asc limit 1",
        'n2 Delete users <- FilterData n1 (id->id)',
        'result: n1',
      ].join('\n'),
    );
    expect(returnedAt(graph, 1)).toEqual([]);
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

const allUsers = createCollectionFor('User')
  .collection.orderBy((user) => user.id.asc())
  .select('id', 'name');
const projects = createCollectionFor('Project')
  .collection.orderBy((project) => project.id.asc())
  .select('id', 'name');

interface KeyedCase {
  readonly name: string;
  readonly target: ReturnType<typeof targetOf>;
  readonly update: string;
  readonly delete: string;
}

const byKey: readonly KeyedCase[] = [
  {
    name: 'the primary key',
    target: targetOf(allUsers.where({ id: 1 }).state),
    update: "n1 Update users set name = 'Grace' where id = 1",
    delete: 'n1 Delete users where id = 1',
  },
  {
    name: 'a unique constraint',
    target: targetOf(allUsers.whereUnique({ email: 'ada@example.com' }).state),
    update: "n1 Update users set name = 'Grace' where email = 'ada@example.com'",
    delete: "n1 Delete users where email = 'ada@example.com'",
  },
  {
    name: 'chained wheres over a composite key',
    target: targetOf(projects.where({ tenantId: 1 }).where({ id: 2 }).state, 'Project'),
    update: "n1 Update projects set name = 'Grace' where tenant_id = 1 and id = 2",
    delete: 'n1 Delete projects where tenant_id = 1 and id = 2',
  },
  {
    name: 'the callback form',
    target: targetOf(allUsers.where((user) => user.id.eq(1)).state),
    update: "n1 Update users set name = 'Grace' where id = 1",
    delete: 'n1 Delete users where id = 1',
  },
  {
    name: 'the key with another condition',
    target: targetOf(allUsers.where({ id: 1 }).where((user) => user.name.like('A%')).state),
    update: "n1 Update users set name = 'Grace' where id = 1 and name like 'A%'",
    delete: "n1 Delete users where id = 1 and name like 'A%'",
  },
];

const notByKey: readonly { readonly name: string; readonly target: ReturnType<typeof targetOf> }[] =
  [
    { name: 'an offset', target: targetOf(allUsers.where({ id: 1 }).offset(1).state) },
    {
      name: 'a cursor',
      target: targetOf({
        ...allUsers.where({ id: 1 }).state,
        cursor: allUsers.cursor({ id: 0 }).state.cursor,
      }),
    },
    {
      name: 'a part of a composite key',
      target: targetOf(projects.where({ id: 2 }).state, 'Project'),
    },
    { name: 'a condition on no key', target: targetOf(allUsers.where({ name: 'Ada' }).state) },
  ];

describe('updateFirstGraph and deleteFirstGraph by key', () => {
  describe.each(byKey)('with a condition on $name', ({ target: keyed, update, delete: remove }) => {
    it('builds one Update with the whole condition of the collection', () => {
      expect(printAsRun(updateFirstGraph(keyed, { name: 'Grace' }))).toBe(
        [update, 'result: n1'].join('\n'),
      );
    });

    it('builds one Delete with the whole condition of the collection that returns the selected columns', () => {
      const graph = deleteFirstGraph(keyed);

      expect(printAsRun(graph)).toBe([remove, 'result: n1'].join('\n'));
      expect(returnedAt(graph, 0)).toEqual(['id', 'name']);
    });
  });

  describe.each(notByKey)('with $name', ({ target: unkeyed }) => {
    it('keeps the Find of the first row for update()', () => {
      expect(printAsRun(updateFirstGraph(unkeyed, { name: 'Grace' }))).toMatch(
        /^n1 Find .* limit 1( offset 1)?\nn2 Update \S+ set name = 'Grace' <- FilterData n1/,
      );
    });

    it('keeps the Find of the first row for delete()', () => {
      expect(printAsRun(deleteFirstGraph(unkeyed))).toMatch(
        /^n1 Find .* limit 1( offset 1)?\nn2 Delete \S+ <- FilterData n1/,
      );
    });
  });

  it('keeps a Find without a limit as the result and a Delete by key for delete() with includes', () => {
    const graph = deleteFirstGraph(targetOf(allUsers.where({ id: 1 }).include('posts').state));

    expect(printAsRun(graph)).toBe(
      [
        'n1 Find users where id = 1',
        'n2 Delete users where id = 1 <- FilterData n1 (id->id)',
        'result: n1',
      ].join('\n'),
    );
    expect(returnedAt(graph, 0)).toEqual(['id', 'name', 'posts']);
  });
});
