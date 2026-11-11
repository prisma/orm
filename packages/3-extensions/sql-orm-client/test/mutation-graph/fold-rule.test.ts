import { BinaryExpr, ColumnRef, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { FilterData } from '../../src/mutation-graph/filter-data';
import type { Find } from '../../src/mutation-graph/find';
import type { Graph } from '../../src/mutation-graph/graph';
import { removeUnreadFinds } from '../../src/mutation-graph/remove-unread-finds';
import { createCollectionFor } from '../collection-fixtures';
import { printGraph } from './print-graph';
import {
  addWithState,
  columnMappings,
  findUsers,
  findUsersWith,
  nameIsAda,
  newGraph,
  updateUsers,
} from './statements';

const sameId = columnMappings('users', 'users', [['id', 'id']]);
const sameName = columnMappings('users', 'users', [['name', 'name']]);

function printAsRun(graph: Graph): string {
  removeUnreadFinds(graph);
  return printGraph(graph);
}

function updateWithConditionOf(find: Find) {
  return updateUsers({ name: 'Grace' }, find.ast.where);
}

describe('the fold rule, on a contract with returning', () => {
  it('drops the key edge from a Find with only a condition when the Update has that same condition', () => {
    const graph = newGraph();
    const found = findUsers([nameIsAda]);
    const find = addWithState(graph, found);

    const update = addWithState(graph, updateWithConditionOf(found), {
      filter: [new FilterData(find, sameId)],
    });
    graph.setResult(update);

    expect(graph.readersOf(find)).toEqual([]);
    expect(printAsRun(graph)).toBe(
      ["n1 Update users set name = 'Grace' where name = 'Ada'", 'result: n1'].join('\n'),
    );
  });

  it('leaves an Update whose condition is another object than the condition of the Find as it is', () => {
    const graph = newGraph();
    const found = findUsers([nameIsAda]);
    const find = addWithState(graph, found);
    const alsoAda = BinaryExpr.eq(ColumnRef.of('users', 'name'), ParamRef.of('Ada'));

    graph.setResult(
      addWithState(graph, updateUsers({ name: 'Grace' }, alsoAda), {
        filter: [new FilterData(find, sameId)],
      }),
    );

    expect(printAsRun(graph)).toBe(
      [
        "n1 Find users where name = 'Ada'",
        "n2 Update users set name = 'Grace' where name = 'Ada' <- FilterData n1 (id->id)",
        'result: n2',
      ].join('\n'),
    );
  });

  it('leaves an Update without a condition as it is', () => {
    const graph = newGraph();
    const find = addWithState(graph, findUsers([nameIsAda]));

    graph.setResult(
      addWithState(graph, updateUsers({ name: 'Grace' }), {
        filter: [new FilterData(find, sameId)],
      }),
    );

    expect(printAsRun(graph)).toBe(
      [
        "n1 Find users where name = 'Ada'",
        "n2 Update users set name = 'Grace' <- FilterData n1 (id->id)",
        'result: n2',
      ].join('\n'),
    );
  });

  it('leaves an Update filtered by a Find with a limit as it is', () => {
    const graph = newGraph();
    const found = findUsersWith({ filters: [nameIsAda], limit: 1, selectedFields: ['id'] });
    const find = addWithState(graph, found);

    graph.setResult(
      addWithState(graph, updateWithConditionOf(found), {
        filter: [new FilterData(find, sameId)],
      }),
    );

    expect(printAsRun(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' limit 1",
        "n2 Update users set name = 'Grace' where name = 'Ada' <- FilterData n1 (id->id)",
        'result: n2',
      ].join('\n'),
    );
  });

  it('leaves an Update filtered by a Find with includes as it is', () => {
    const { includes, tables } = createCollectionFor('User').collection.include('posts').state;
    const graph = newGraph();
    const found = findUsersWith({ includes, tables, filters: [nameIsAda] });
    const find = addWithState(graph, found);

    graph.setResult(
      addWithState(graph, updateWithConditionOf(found), {
        filter: [new FilterData(find, sameId)],
      }),
    );

    expect(printAsRun(graph)).toBe(
      [
        "n1 Find users where name = 'Ada'",
        "n2 Update users set name = 'Grace' where name = 'Ada' <- FilterData n1 (id->id)",
        'result: n2',
      ].join('\n'),
    );
  });

  it('leaves an Update as it is when a write to the table comes between it and the Find', () => {
    const graph = newGraph();
    const found = findUsers([nameIsAda]);
    const find = addWithState(graph, found);
    addWithState(graph, updateUsers({ email: 'x' }));

    graph.setResult(
      addWithState(graph, updateWithConditionOf(found), {
        filter: [new FilterData(find, sameId)],
      }),
    );

    expect(printAsRun(graph)).toBe(
      [
        "n1 Find users where name = 'Ada'",
        "n2 Update users set email = 'x'",
        "n3 Update users set name = 'Grace' where name = 'Ada' <- FilterData n1 (id->id)",
        'result: n3',
      ].join('\n'),
    );
  });

  it('leaves an Update filtered by columns that are not a key as it is', () => {
    const graph = newGraph();
    const found = findUsers([nameIsAda], ['name']);
    const find = addWithState(graph, found);

    graph.setResult(
      addWithState(graph, updateWithConditionOf(found), {
        filter: [new FilterData(find, sameName)],
      }),
    );

    expect(printAsRun(graph)).toBe(
      [
        "n1 Find users where name = 'Ada'",
        "n2 Update users set name = 'Grace' where name = 'Ada' <- FilterData n1 (name->name)",
        'result: n2',
      ].join('\n'),
    );
  });
});
