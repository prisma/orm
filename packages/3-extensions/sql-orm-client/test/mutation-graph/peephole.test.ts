import { describe, expect, it } from 'vitest';
import { After, after, FilterData, filterData } from '../../src/mutation-graph/edges';
import { Node, type StatementAst } from '../../src/mutation-graph/nodes';
import { deleteUsers, findUsers, graphOfUsers, updateUsers } from './statements';

class ReplacedOnAdd extends Node {
  readonly ast: StatementAst;
  readonly replacement: Node;

  constructor(replacement: Node) {
    super();
    this.ast = replacement.ast;
    this.replacement = replacement;
  }

  override peephole(): Node {
    return this.replacement;
  }
}

describe('peephole on add', () => {
  it('receives the graph and the position of the node', () => {
    const graph = graphOfUsers();
    const seen: unknown[] = [];
    class Recording extends ReplacedOnAdd {
      override peephole(...args: unknown[]): Node {
        seen.push(...args);
        return this;
      }
    }
    graph.add(findUsers());

    graph.add(new Recording(findUsers()));

    expect(seen).toEqual([graph, 1]);
  });

  it('keeps a node whose peephole returns the node itself', () => {
    const graph = graphOfUsers();
    const update = updateUsers({ name: 'Ada' });

    const id = graph.add(update);

    expect(graph.nodeAt(id)).toBe(update);
  });

  it('puts the replacement at the position, with the inputs of the node that was added', () => {
    const graph = graphOfUsers();
    const find = graph.add(findUsers());
    const replacement = updateUsers({ name: 'Ada' });

    const id = graph.add(new ReplacedOnAdd(replacement), filterData(find, [['id', 'id']]));

    expect(graph.nodeAt(id)).toBe(replacement);
    expect(graph.edgesInto(id)).toEqual([new FilterData(find, id, [['id', 'id']])]);
  });

  describe('an Update that sets nothing', () => {
    it('leaves its position empty, and add still returns the position', () => {
      const graph = graphOfUsers();

      const id = graph.add(updateUsers({}));

      expect(id).toBe(0);
      expect(graph.nodeAt(id)).toBeUndefined();
      expect(graph.nodes()).toEqual([]);
    });

    it('leaves the other nodes in the graph and takes its own edges out', () => {
      const graph = graphOfUsers();
      const find = findUsers();
      const findId = graph.add(find);

      const id = graph.add(updateUsers({}), filterData(findId, [['id', 'id']]));

      expect(graph.nodes()).toEqual([[findId, find]]);
      expect(graph.edgesOutOf(findId)).toEqual([]);
      expect(graph.edgesInto(id)).toEqual([]);
    });

    it('leaves no trace in the nodes it read from, also when it read from one node twice', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers());
      const other = graph.add(findUsers());
      const kept = graph.add(updateUsers({ name: 'Ada' }), filterData(find, [['id', 'id']]));

      graph.add(updateUsers({}), filterData(find, [['id', 'id']]), after(other), after(find));

      expect(graph.edgesOutOf(find)).toEqual([new FilterData(find, kept, [['id', 'id']])]);
      expect(graph.edgesOutOf(other)).toEqual([]);
    });

    it('lets nodes be added after it with their own edges', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers());
      graph.add(updateUsers({}), filterData(find, [['id', 'id']]));

      const del = graph.add(deleteUsers(), after(find));

      expect(del).toBe(2);
      expect(graph.edgesOutOf(find)).toEqual([new After(find, del)]);
      expect(graph.edgesInto(del)).toEqual([new After(find, del)]);
    });

    it('gives a result that names an empty position when it was to be the result', () => {
      const graph = graphOfUsers();

      graph.setResult(graph.add(updateUsers({})));

      expect(graph.result.node).toBe(0);
      expect(graph.nodeAt(0)).toBeUndefined();
    });
  });
});
