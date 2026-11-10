import { describe, expect, it } from 'vitest';
import { FilterData } from '../../src/mutation-graph/filter-data';
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
  newGraphWithoutReturning,
  updateUsers,
} from './statements';

const sameId = columnMappings('users', 'users', [['id', 'id']]);
const sameName = columnMappings('users', 'users', [['name', 'name']]);

function printAsRun(graph: Graph): string {
  removeUnreadFinds(graph);
  return printGraph(graph);
}

describe('the fold rule, on a contract with returning', () => {
  it('gives an Update filtered by key by a Find with only a condition that condition as its WHERE', () => {
    const graph = newGraph();
    const find = addWithState(graph, findUsers([nameIsAda]));

    const update = addWithState(graph, updateUsers({ name: 'Grace' }), {
      filter: [new FilterData(find, sameId)],
    });
    graph.setResult(update);

    expect(graph.readersOf(find)).toEqual([]);
    expect(printAsRun(graph)).toBe(
      ["n1 Update users set name = 'Grace' where name = 'Ada'", 'result: n1'].join('\n'),
    );
  });

  it('leaves an Update filtered by a Find with a limit as it is', () => {
    const graph = newGraph();
    const find = addWithState(
      graph,
      findUsersWith({ filters: [nameIsAda], limit: 1, selectedFields: ['id'] }),
    );

    graph.setResult(
      addWithState(graph, updateUsers({ name: 'Grace' }), {
        filter: [new FilterData(find, sameId)],
      }),
    );

    expect(printAsRun(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' limit 1",
        "n2 Update users set name = 'Grace' <- FilterData n1 (id->id)",
        'result: n2',
      ].join('\n'),
    );
  });

  it('leaves an Update filtered by a Find with includes as it is', () => {
    const { includes, tables } = createCollectionFor('User').collection.include('posts').state;
    const graph = newGraph();
    const find = addWithState(graph, findUsersWith({ includes, tables, filters: [nameIsAda] }));

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

  it('leaves an Update as it is when a write to the table comes between it and the Find', () => {
    const graph = newGraph();
    const find = addWithState(graph, findUsers([nameIsAda]));
    addWithState(graph, updateUsers({ email: 'x' }));

    graph.setResult(
      addWithState(graph, updateUsers({ name: 'Grace' }), {
        filter: [new FilterData(find, sameId)],
      }),
    );

    expect(printAsRun(graph)).toBe(
      [
        "n1 Find users where name = 'Ada'",
        "n2 Update users set email = 'x'",
        "n3 Update users set name = 'Grace' <- FilterData n1 (id->id)",
        'result: n3',
      ].join('\n'),
    );
  });

  it('leaves an Update with a condition of its own as it is', () => {
    const graph = newGraph();
    const find = addWithState(graph, findUsers([nameIsAda]));

    graph.setResult(
      addWithState(graph, updateUsers({ name: 'Grace' }, nameIsAda), {
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

  it('leaves an Update filtered by columns that are not a key as it is', () => {
    const graph = newGraph();
    const find = addWithState(graph, findUsers([nameIsAda], ['name']));

    graph.setResult(
      addWithState(graph, updateUsers({ name: 'Grace' }), {
        filter: [new FilterData(find, sameName)],
      }),
    );

    expect(printAsRun(graph)).toBe(
      [
        "n1 Find users where name = 'Ada'",
        "n2 Update users set name = 'Grace' <- FilterData n1 (name->name)",
        'result: n2',
      ].join('\n'),
    );
  });
});

describe('the fold rule, on a contract without returning', () => {
  it('does not run', () => {
    const graph = newGraphWithoutReturning();
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
});
