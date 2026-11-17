import { describe, expect, it } from 'vitest';
import { FilterData } from '../../src/statement-graph/filter-data';
import { FindByKeys } from '../../src/statement-graph/find-by-keys';
import { Insert } from '../../src/statement-graph/insert';
import { Requires } from '../../src/statement-graph/requires';
import { Rows } from '../../src/statement-graph/rows';
import { printGraph } from './print-graph';
import {
  columnMappings,
  deletePosts,
  findUsers,
  insertInto,
  insertOwner,
  nameIsAda,
  newGraphWithoutReturning,
  updateUsers,
} from './statements';

const sameId = columnMappings('users', 'users', [['id', 'id']]);
const idToUserId = columnMappings('users', 'posts', [['id', 'user_id']]);
const create = { operation: 'create', modelName: 'User' };

describe('Graph.removeUnreadFinds', () => {
  it('removes a Find that is not the result and that no node reads', () => {
    const graph = newGraphWithoutReturning();
    graph.add(findUsers([nameIsAda]), {});
    graph.setResult(graph.add(updateUsers({ name: 'Ada' }), {}));

    graph.removeUnreadFinds();

    expect(printGraph(graph)).toBe(["n1 Update users set name = 'Ada'", 'result: n1'].join('\n'));
  });

  it('removes a FindByKeys that no node reads', () => {
    const graph = newGraphWithoutReturning();
    const insert = graph.add(new Insert([insertInto('users', [{ name: 'Ada' }])], insertOwner), {});
    graph.add(new FindByKeys(findUsers().ast, sameId, create), { keys: new Rows(insert, sameId) });

    graph.removeUnreadFinds();

    expect(printGraph(graph)).toBe(['n1 Insert users', 'result: none'].join('\n'));
  });

  it('keeps the result and every Find a node reads, by a Requires edge too', () => {
    const graph = newGraphWithoutReturning();
    const filtering = graph.add(findUsers([nameIsAda]), {});
    const required = graph.add(findUsers(), {});
    graph.add(deletePosts(), {
      filter: [new FilterData(filtering, idToUserId)],
      requires: [new Requires(required)],
    });
    graph.setResult(graph.add(findUsers(), {}));
    const before = printGraph(graph);

    graph.removeUnreadFinds();

    expect(printGraph(graph)).toBe(before);
  });

  it('removes a Find that only removed Finds read, until none is left', () => {
    const graph = newGraphWithoutReturning();
    const first = graph.add(findUsers([nameIsAda]), {});
    const second = graph.add(findUsers(), { filter: [new FilterData(first, sameId)] });
    graph.add(findUsers(), { filter: [new FilterData(second, sameId)] });
    graph.add(updateUsers({ name: 'Ada' }), {});

    graph.removeUnreadFinds();

    expect(printGraph(graph)).toBe(["n1 Update users set name = 'Ada'", 'result: none'].join('\n'));
  });

  it('keeps a write that no node reads', () => {
    const graph = newGraphWithoutReturning();
    graph.add(updateUsers({ name: 'Ada' }), {});
    graph.add(deletePosts(), {});
    const before = printGraph(graph);

    graph.removeUnreadFinds();

    expect(printGraph(graph)).toBe(before);
  });
});
