import { InsertOnConflict } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { FilterData } from '../../src/mutation-graph/filter-data';
import { FindByKeys } from '../../src/mutation-graph/find-by-keys';
import { Insert } from '../../src/mutation-graph/insert';
import { InsertChunked } from '../../src/mutation-graph/insert-chunked';
import { Requires } from '../../src/mutation-graph/requires';
import { Rows } from '../../src/mutation-graph/rows';
import { createCollectionFor } from '../collection-fixtures';
import { printGraph } from './print-graph';
import {
  columnMappings,
  deleteUsers,
  findUsers,
  findUsersWith,
  insertInto,
  nameIsAda,
  newGraph,
  newGraphWithoutReturning,
  returnedAt,
  updateUsers,
} from './statements';

const sameId = columnMappings('users', 'users', [['id', 'id']]);
const sameName = columnMappings('users', 'users', [['name', 'name']]);
const create = { operation: 'create', modelName: 'User' };

function readBackByKeys(columns: readonly string[]): FindByKeys {
  return new FindByKeys(findUsers([], [...columns]).ast, sameId, create);
}

function usersWithPosts() {
  const { includes, tables } = createCollectionFor('User').collection.include('posts').state;
  return { includes, tables, selectedFields: ['id', 'name'] };
}

describe('the read-back rule, on a contract with returning', () => {
  it('collapses a FindByKeys of the rows an Insert wrote into the Insert, which returns its columns', () => {
    const graph = newGraph();
    const insert = graph.add(new Insert(insertInto('users', [{ name: 'Ada' }, { name: 'Bob' }])));

    const read = graph.add(readBackByKeys(['id', 'name']), { keys: new Rows(insert, sameId) });

    expect(read).toBe(insert);
    expect(printGraph(graph)).toBe(['n1 Insert users 2 rows', 'result: none'].join('\n'));
    expect(returnedAt(graph, 0)).toEqual(['id', 'name']);
  });

  it('collapses a FindByKeys of the rows an InsertChunked wrote into it', () => {
    const graph = newGraph();
    const inserted = graph.add(
      new InsertChunked([
        insertInto('users', [{ name: 'Ada' }]),
        insertInto('users', [{ name: 'Bob', email: 'bob@example.com' }]),
      ]),
    );

    const read = graph.add(readBackByKeys(['id', 'email']), { keys: new Rows(inserted, sameId) });

    expect(read).toBe(inserted);
    expect(printGraph(graph)).toBe(
      ['n1 InsertChunked users (2 statements)', 'result: none'].join('\n'),
    );
    expect(returnedAt(graph, 0)).toEqual(['id', 'email']);
  });

  it('collapses a Find of the rows an Update changed by their key into the Update', () => {
    const graph = newGraph();
    const update = graph.add(updateUsers({ name: 'Ada' }, nameIsAda));

    const read = graph.add(findUsers([], ['id', 'email']), {
      filter: [new FilterData(update, sameId)],
    });

    expect(read).toBe(update);
    expect(printGraph(graph)).toBe(
      ["n1 Update users set name = 'Ada' where name = 'Ada'", 'result: none'].join('\n'),
    );
    expect(returnedAt(graph, 0)).toEqual(['id', 'email']);
  });

  it('collapses a Find of the rows a Delete removed by their key into the Delete', () => {
    const graph = newGraph();
    const del = graph.add(deleteUsers(nameIsAda));

    const read = graph.add(findUsers([], ['id', 'name']), {
      filter: [new FilterData(del, sameId)],
    });

    expect(read).toBe(del);
    expect(printGraph(graph)).toBe(
      ["n1 Delete users where name = 'Ada'", 'result: none'].join('\n'),
    );
    expect(returnedAt(graph, 0)).toEqual(['id', 'name']);
  });

  it('adds a read-back with includes as it is', () => {
    const graph = newGraph();
    const update = graph.add(updateUsers({ name: 'Ada' }, nameIsAda));

    const read = graph.add(findUsersWith(usersWithPosts()), {
      filter: [new FilterData(update, sameId)],
    });

    expect(read).not.toBe(update);
    expect(printGraph(graph)).toBe(
      [
        "n1 Update users set name = 'Ada' where name = 'Ada'",
        'n2 Find users <- FilterData n1 (id->id)',
        'result: none',
      ].join('\n'),
    );
  });

  it('adds a Find that reads by columns that are not a key as it is', () => {
    const graph = newGraph();
    const update = graph.add(updateUsers({ name: 'Ada' }, nameIsAda));

    graph.add(findUsers([], ['id']), { filter: [new FilterData(update, sameName)] });

    expect(printGraph(graph)).toBe(
      [
        "n1 Update users set name = 'Ada' where name = 'Ada'",
        'n2 Find users <- FilterData n1 (name->name)',
        'result: none',
      ].join('\n'),
    );
  });

  it('adds a Find with a condition of its own as it is', () => {
    const graph = newGraph();
    const update = graph.add(updateUsers({ name: 'Ada' }, nameIsAda));

    graph.add(findUsers([nameIsAda], ['id']), { filter: [new FilterData(update, sameId)] });

    expect(printGraph(graph)).toBe(
      [
        "n1 Update users set name = 'Ada' where name = 'Ada'",
        "n2 Find users where name = 'Ada' <- FilterData n1 (id->id)",
        'result: none',
      ].join('\n'),
    );
  });

  it('adds a Find that reads a node that does not write as it is', () => {
    const graph = newGraph();
    const find = graph.add(findUsers([nameIsAda], ['id']));

    graph.add(findUsers([], ['id', 'name']), { filter: [new FilterData(find, sameId)] });

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada'",
        'n2 Find users <- FilterData n1 (id->id)',
        'result: none',
      ].join('\n'),
    );
  });

  it('adds a read-back with an input besides the write as it is', () => {
    const graph = newGraph();
    const find = graph.add(findUsers([nameIsAda], ['id']));
    const update = graph.add(updateUsers({ name: 'Ada' }, nameIsAda));

    graph.add(findUsers([], ['id', 'name']), {
      filter: [new FilterData(update, sameId)],
      requires: [new Requires(find)],
    });

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada'",
        "n2 Update users set name = 'Ada' where name = 'Ada'",
        'n3 Find users <- FilterData n2 (id->id), Requires n1',
        'result: none',
      ].join('\n'),
    );
  });

  it('adds a read-back as it is when another write to the table follows the write it reads', () => {
    const graph = newGraph();
    const insert = graph.add(new Insert(insertInto('users', [{ name: 'Ada' }])));
    graph.add(updateUsers({ name: 'Bob' }));

    graph.add(readBackByKeys(['id', 'name']), { keys: new Rows(insert, sameId) });

    expect(printGraph(graph)).toBe(
      [
        'n1 Insert users',
        "n2 Update users set name = 'Bob'",
        'n3 FindByKeys users by (id) for create <- Rows n1',
        'result: none',
      ].join('\n'),
    );
  });

  it('adds a read-back of an Insert that skips conflicting rows as it is', () => {
    const graph = newGraph();
    const ast = insertInto('users', [{ name: 'Ada' }]).withOnConflict(InsertOnConflict.doNothing());
    const insert = graph.add(new Insert(ast));

    graph.add(readBackByKeys(['id', 'name']), { keys: new Rows(insert, sameId) });

    expect(printGraph(graph)).toBe(
      [
        'n1 Insert users on conflict do nothing',
        'n2 FindByKeys users by (id) for create <- Rows n1',
        'result: none',
      ].join('\n'),
    );
  });
});

describe('the read-back rule, on a contract without returning', () => {
  it('adds the read-back as it is, and the write returns the key it reads', () => {
    const graph = newGraphWithoutReturning();
    const insert = graph.add(new Insert(insertInto('users', [{ name: 'Ada' }])));

    const read = graph.add(readBackByKeys(['id', 'name']), { keys: new Rows(insert, sameId) });

    expect(read).not.toBe(insert);
    expect(printGraph(graph)).toBe(
      ['n1 Insert users', 'n2 FindByKeys users by (id) for create <- Rows n1', 'result: none'].join(
        '\n',
      ),
    );
    expect(returnedAt(graph, 0)).toEqual(['id']);
  });
});
