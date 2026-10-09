import { describe, expect, it } from 'vitest';
import { After, FilterData, filterData } from '../../src/mutation-graph/edges';
import type { Node } from '../../src/mutation-graph/nodes';
import { Find } from '../../src/mutation-graph/nodes';
import { columnPairs, deleteUsers, findUsers, graphOfUsers, updateUsers } from './statements';

const sameId = columnPairs('users', 'users', [['id', 'id']]);

describe('peephole on add', () => {
  it('receives the graph and the position of the node', () => {
    const graph = graphOfUsers();
    const seen: unknown[] = [];
    class Recording extends Find {
      override peephole(...args: unknown[]): Node {
        seen.push(...args);
        return this;
      }
    }
    graph.add(findUsers(), { filter: [] });

    graph.add(new Recording(findUsers().ast), { filter: [] });

    expect(seen).toEqual([graph, 1]);
  });

  it('keeps a node whose peephole returns the node itself', () => {
    const graph = graphOfUsers();
    const update = updateUsers({ name: 'Ada' });

    const id = graph.add(update, { filter: [] });

    expect(graph.nodeAt(id)).toBe(update);
  });

  it('puts the replacement at the position, with the inputs of the node that was added', () => {
    const graph = graphOfUsers();
    const replacement = updateUsers({ name: 'Ada' });
    class ReplacedOnAdd extends Find {
      override peephole(): Node {
        return replacement;
      }
    }
    const find = graph.add(findUsers(), { filter: [] });

    const id = graph.add(new ReplacedOnAdd(findUsers().ast), {
      filter: [filterData(find, sameId)],
    });

    expect(graph.nodeAt(id)).toBe(replacement);
    expect(graph.edgesInto(id)).toEqual([new FilterData(find, id, sameId)]);
  });

  describe('an Update that sets nothing', () => {
    it('leaves its position empty, and add still returns the position', () => {
      const graph = graphOfUsers();

      const id = graph.add(updateUsers({}), { filter: [] });

      expect(id).toBe(0);
      expect(graph.nodeAt(id)).toBeUndefined();
      expect(graph.nodes()).toEqual([]);
    });

    it('leaves the other nodes in the graph and takes its own edges out', () => {
      const graph = graphOfUsers();
      const findId = graph.add(findUsers(), { filter: [] });

      const id = graph.add(updateUsers({}), { filter: [filterData(findId, sameId)] });

      expect(graph.nodes().map(([position]) => position)).toEqual([findId]);
      expect(graph.edgesOutOf(findId)).toEqual([]);
      expect(graph.edgesInto(id)).toEqual([]);
    });

    it('leaves no trace in the nodes it read from, also when it read from one node twice', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers(), { filter: [] });
      const other = graph.add(findUsers(), { filter: [] });
      const kept = graph.add(updateUsers({ name: 'Ada' }), { filter: [filterData(find, sameId)] });

      graph.add(updateUsers({}), {
        filter: [filterData(find, sameId), filterData(other, sameId), filterData(find, sameId)],
      });

      expect(graph.edgesOutOf(find)).toEqual([new FilterData(find, kept, sameId)]);
      expect(graph.edgesOutOf(other)).toEqual([]);
    });

    it('lets nodes be added after it with their own edges', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers(), { filter: [] });
      graph.add(updateUsers({}), { filter: [filterData(find, sameId)] });

      const del = graph.add(deleteUsers(), { filter: [] });
      graph.after(find, del);

      expect(del).toBe(2);
      expect(graph.edgesOutOf(find)).toEqual([new After(find, del)]);
      expect(graph.edgesInto(del)).toEqual([new After(find, del)]);
    });

    it('gives a result that names an empty position when it was to be the result', () => {
      const graph = graphOfUsers();

      graph.setResult(graph.add(updateUsers({}), { filter: [] }));

      expect(graph.result.node).toBe(0);
      expect(graph.nodeAt(0)).toBeUndefined();
    });
  });
});
