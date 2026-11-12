import { BinaryExpr, ColumnRef, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Delete } from '../../src/mutation-graph/delete';
import { FilterData } from '../../src/mutation-graph/filter-data';
import type { Graph } from '../../src/mutation-graph/graph';
import { Rows } from '../../src/mutation-graph/rows';
import { UnionAll } from '../../src/mutation-graph/union-all';
import { createCollectionFor } from '../collection-fixtures';
import { printGraph } from './print-graph';
import {
  addWithState,
  columnMappings,
  deleteUsers,
  findUsers,
  findUsersWith,
  nameIsAda,
  newGraph,
  returnedAt,
  updateUsers,
} from './statements';

const sameId = columnMappings('users', 'users', [['id', 'id']]);

function printAsRun(graph: Graph): string {
  graph.removeUnreadFinds();
  return printGraph(graph);
}

function firstRowOfAda() {
  return findUsersWith({ filters: [nameIsAda], limit: 1, selectedFields: ['id', 'name'] });
}

describe('the delete rule, on a contract with returning', () => {
  it('makes a Delete filtered by key by a Find return its columns and stand for it', () => {
    const graph = newGraph();
    const find = addWithState(graph, firstRowOfAda());
    const del = addWithState(graph, deleteUsers(), { filter: [new FilterData(find, sameId)] });

    graph.setResult(find);

    expect(graph.result).toBe(del);
    expect(printAsRun(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' limit 1",
        'n2 Delete users <- FilterData n1 (id->id)',
        'result: n2',
      ].join('\n'),
    );
    expect(returnedAt(graph, 1)).toEqual(['id', 'name']);
  });

  it.each([
    ['a condition', [nameIsAda], "n1 Delete users where name = 'Ada'"],
    ['no condition', [], 'n1 Delete users'],
  ])(
    'drops the key edge of a Delete with %s, the same as the Find with only a condition it reads, and the Find is removed',
    (_, filters, printed) => {
      const graph = newGraph();
      const found = findUsers(filters, ['id', 'name']);
      const find = addWithState(graph, found);
      addWithState(graph, deleteUsers(found.ast.where), {
        filter: [new FilterData(find, sameId)],
      });

      graph.setResult(find);

      expect(printAsRun(graph)).toBe([printed, 'result: n1'].join('\n'));
      expect(returnedAt(graph, 0)).toEqual(['id', 'name']);
    },
  );

  it.each([
    ['a condition', [nameIsAda], "n1 Delete users where name = 'Ada'"],
    ['no condition', [], 'n1 Delete users'],
  ])(
    'makes a Delete with %s and no key edge return the columns of the Find of the same condition that reads its State, and the Find is removed',
    (_, filters, printed) => {
      const graph = newGraph();
      const found = findUsers(filters, ['id', 'name']);
      const find = addWithState(graph, found);
      addWithState(graph, deleteUsers(found.ast.where));

      graph.setResult(find);

      expect(printAsRun(graph)).toBe([printed, 'result: n1'].join('\n'));
      expect(returnedAt(graph, 0)).toEqual(['id', 'name']);
    },
  );

  it.each([
    [
      'a write to the table comes between it and the Find',
      (graph: Graph) => {
        const found = findUsers([nameIsAda], ['id', 'name']);
        const find = addWithState(graph, found);
        addWithState(graph, updateUsers({ email: 'x' }));
        return { find, where: found.ast.where };
      },
    ],
    [
      'the Find of the same condition has a limit',
      (graph: Graph) => {
        const found = firstRowOfAda();
        return { find: addWithState(graph, found), where: found.ast.where };
      },
    ],
    [
      'a node already reads the Find',
      (graph: Graph) => {
        const found = findUsers([nameIsAda], ['id', 'name']);
        const find = addWithState(graph, found);
        graph.add(new UnionAll(), { rows: [new Rows(find, sameId)] });
        return { find, where: found.ast.where };
      },
    ],
  ])('leaves a Delete with no key edge as it is when %s', (_, build) => {
    const graph = newGraph();
    const { find, where } = build(graph);
    addWithState(graph, deleteUsers(where));

    graph.setResult(find);

    expect(graph.result).toBe(find);
  });

  it('adds the Delete it makes once, without running the rules on it again', () => {
    const graph = newGraph();
    const find = addWithState(graph, firstRowOfAda());

    const del = addWithState(graph, deleteUsers(), { filter: [new FilterData(find, sameId)] });

    expect(graph.nodes().filter(([, node]) => node instanceof Delete)).toEqual([
      [del, graph.nodeAt(del)],
    ]);
    expect(graph.nodeAt(find)).toBe(graph.nodeAt(del));
  });

  it('gives a reader added later from the id of the Find the rows of the Delete', () => {
    const graph = newGraph();
    const find = addWithState(graph, firstRowOfAda());
    const del = addWithState(graph, deleteUsers(), { filter: [new FilterData(find, sameId)] });

    const union = graph.add(new UnionAll(), { rows: [new Rows(find, sameId)] });

    expect(graph.inputsOf(union)).toEqual({ rows: [new Rows(del, sameId)] });
    expect(graph.inputsOf(del)['filter']).toEqual([new FilterData(find, sameId)]);
  });

  it('leaves a Delete filtered by a Find with includes as it is', () => {
    const { includes, tables } = createCollectionFor('User').collection.include('posts').state;
    const graph = newGraph();
    const find = addWithState(
      graph,
      findUsersWith({ includes, tables, filters: [nameIsAda], limit: 1 }),
    );
    addWithState(graph, deleteUsers(), { filter: [new FilterData(find, sameId)] });

    graph.setResult(find);

    expect(graph.result).toBe(find);
    expect(returnedAt(graph, 1)).toEqual([]);
  });

  it('leaves a Delete as it is when a node already reads the Find', () => {
    const graph = newGraph();
    const find = addWithState(graph, firstRowOfAda());
    graph.add(new UnionAll(), { rows: [new Rows(find, sameId)] });
    addWithState(graph, deleteUsers(), { filter: [new FilterData(find, sameId)] });

    graph.setResult(find);

    expect(graph.result).toBe(find);
  });

  it('leaves a Delete as it is when a write to the table comes between it and the Find', () => {
    const graph = newGraph();
    const find = addWithState(graph, firstRowOfAda());
    addWithState(graph, updateUsers({ email: 'x' }));
    addWithState(graph, deleteUsers(), { filter: [new FilterData(find, sameId)] });

    graph.setResult(find);

    expect(graph.result).toBe(find);
  });

  it('keeps the key edge of a Delete whose condition is another object than the condition of the Find', () => {
    const graph = newGraph();
    const find = addWithState(graph, findUsers([nameIsAda], ['id', 'name']));
    addWithState(
      graph,
      deleteUsers(BinaryExpr.eq(ColumnRef.of('users', 'name'), ParamRef.of('Ada'))),
      { filter: [new FilterData(find, sameId)] },
    );

    graph.setResult(find);

    expect(printAsRun(graph)).toBe(
      [
        "n1 Find users where name = 'Ada'",
        "n2 Delete users where name = 'Ada' <- FilterData n1 (id->id)",
        'result: n2',
      ].join('\n'),
    );
  });
});
