import { BinaryExpr, ColumnRef, ParamRef, TableSource } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../src/mutation-graph/edge';
import { FilterData } from '../../src/mutation-graph/filter-data';
import type { Graph } from '../../src/mutation-graph/graph';
import { JunctionFilterData } from '../../src/mutation-graph/junction-filter-data';
import { Requires } from '../../src/mutation-graph/requires';
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
  it.each([
    ['a condition', [nameIsAda], "n1 Delete users where name = 'Ada'"],
    ['no condition', [], 'n1 Delete users'],
  ])(
    'makes a Delete with %s and a key edge from the Find with only that condition, which the fold rule drops, return the columns of the Find and stand for it',
    (_, filters, printed) => {
      const graph = newGraph();
      const found = findUsers(filters, ['id', 'name']);
      const find = addWithState(graph, found);
      graph.setResult(find);
      const del = addWithState(graph, deleteUsers(found.ast.where), {
        filter: [new FilterData(find, sameId)],
      });

      expect(graph.result).toBe(del);
      expect(graph.inputsOf(del)['filter']).toEqual([]);
      expect(returnedAt(graph, 0)).toEqual(['id', 'name']);
      expect(printGraph(graph)).toBe([printed, 'result: n1'].join('\n'));
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
      graph.setResult(find);
      addWithState(graph, deleteUsers(found.ast.where));

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
      'the Find of the same condition has includes',
      (graph: Graph) => {
        const { includes, tables } = createCollectionFor('User').collection.include('posts').state;
        const found = findUsersWith({ includes, tables, filters: [nameIsAda] });
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

  it('leaves a Delete with a link edge as it is', () => {
    const graph = newGraph();
    const found = findUsers([nameIsAda], ['id', 'name']);
    const find = addWithState(graph, found);
    graph.setResult(find);
    const parent = addWithState(graph, findUsers([nameIsAda]));
    const link = new JunctionFilterData(
      parent,
      columnMappings('users', 'posts', [['id', 'user_id']]),
      TableSource.named('posts'),
      columnMappings('posts', 'users', [['user_id', 'id']]),
    );
    const del = addWithState(graph, deleteUsers(found.ast.where), { link: [link] });

    expect(graph.result).toBe(find);
    expect(graph.inputsOf(del)['link']).toEqual([link]);
    expect(returnedAt(graph, 2)).toEqual([]);
  });

  it.each([
    ['a Find with a limit', firstRowOfAda()],
    [
      'a Find whose condition is another object than its own',
      findUsers([BinaryExpr.eq(ColumnRef.of('users', 'name'), ParamRef.of('Ada'))], ['id', 'name']),
    ],
  ])('leaves a Delete with a key edge from %s as it is', (_, found) => {
    const graph = newGraph();
    const find = addWithState(graph, found);
    const del = addWithState(graph, deleteUsers(nameIsAda), {
      filter: [new FilterData(find, sameId)],
    });

    graph.setResult(find);

    expect(graph.result).toBe(find);
    expect(graph.inputsOf(del)['filter']).toEqual([new FilterData(find, sameId)]);
    expect(returnedAt(graph, 1)).toEqual([]);
  });

  it('leaves a Delete that already returns columns as it is', () => {
    const graph = newGraph();
    const found = findUsers([nameIsAda], ['id', 'name']);
    const find = addWithState(graph, found);
    addWithState(graph, deleteUsers(found.ast.where, ['id']));

    graph.setResult(find);

    expect(graph.result).toBe(find);
    expect(returnedAt(graph, 1)).toEqual(['id']);
  });

  it.each([
    [
      'a FilterData input from another node',
      (parent: NodeId) => ({ filter: [new FilterData(parent, sameId)] }),
    ],
    ['a Requires input', (parent: NodeId) => ({ requires: [new Requires(parent)] })],
  ])(
    'leaves a Delete without a condition as it is when the Find without a condition has %s',
    (_, inputsOf) => {
      const graph = newGraph();
      const parent = addWithState(graph, findUsers([nameIsAda]));
      const find = addWithState(graph, findUsers([], ['id', 'name']), inputsOf(parent));
      graph.setResult(find);

      const del = addWithState(graph, deleteUsers());

      expect(graph.result).toBe(find);
      expect(graph.nodeAt(del)).toEqual(deleteUsers());
    },
  );
});
