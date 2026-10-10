import { describe, expect, it } from 'vitest';
import { After } from '../../src/mutation-graph/after';
import type { NodeId } from '../../src/mutation-graph/edge';
import { FilterData, filterData } from '../../src/mutation-graph/filter-data';
import type { Graph } from '../../src/mutation-graph/graph';
import {
  columnPairs,
  deletePosts,
  deleteUsers,
  findUsers,
  graphOfUsers,
  updateUsers,
} from './statements';

const sameId = columnPairs('users', 'users', [['id', 'id']]);
const idToUserId = columnPairs('users', 'posts', [['id', 'user_id']]);
const emailToTitle = columnPairs('users', 'posts', [['email', 'title']]);

function returned(graph: Graph, id: NodeId): string[] {
  return graph
    .nodes()
    .filter(([position]) => position === id)
    .flatMap(([, node]) => node.returns.map((column) => column.alias));
}

describe('Graph', () => {
  describe('add', () => {
    it('returns the position of the node, counting from zero', () => {
      const graph = graphOfUsers();
      const find = findUsers();
      const del = deleteUsers();

      const findId = graph.add(find, { filter: [] });
      const delId = graph.add(del, { filter: [] });

      expect([findId, delId]).toEqual([0, 1]);
      expect(graph.nodes()).toEqual([
        [findId, find],
        [delId, del],
      ]);
    });

    it('gives each input the position of the node as where it goes, in its slot', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers(), { filter: [] });

      const del = graph.add(deletePosts(), {
        filter: [filterData(find, idToUserId), filterData(find, emailToTitle)],
      });

      expect(graph.inputsOf(del)).toEqual({
        filter: [new FilterData(find, del, idToUserId), new FilterData(find, del, emailToTitle)],
      });
    });

    it('keeps a slot with no edge', () => {
      const graph = graphOfUsers();

      expect(graph.inputsOf(graph.add(findUsers(), { filter: [] }))).toEqual({ filter: [] });
    });

    it('lists a data edge at the position it comes from, as the same object', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers(), { filter: [] });
      const update = graph.add(updateUsers({ name: 'Ada' }), {
        filter: [filterData(find, sameId)],
      });
      const del = graph.add(deletePosts(), { filter: [filterData(find, idToUserId)] });

      expect(graph.edgesOutOf(find)).toEqual([
        new FilterData(find, update, sameId),
        new FilterData(find, del, idToUserId),
      ]);
      expect(graph.edgesOutOf(find)[0]).toBe(graph.inputsOf(update)['filter']?.[0]);
      expect(graph.edgesOutOf(del)).toEqual([]);
    });

    it('makes the source of a data edge also return the columns the edge reads', () => {
      const graph = graphOfUsers();
      const update = graph.add(updateUsers({ name: 'Ada' }), { filter: [] });
      expect(returned(graph, update)).toEqual([]);

      graph.add(deletePosts(), { filter: [filterData(update, idToUserId)] });
      graph.add(deletePosts(), {
        filter: [filterData(update, emailToTitle), filterData(update, idToUserId)],
      });

      expect(returned(graph, update)).toEqual(['id', 'email']);
    });

    it('leaves the edges of a node whose statement it widens as they were', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers(), { filter: [] });
      const update = graph.add(updateUsers({ name: 'Ada' }), {
        filter: [filterData(find, sameId)],
      });
      const [into] = graph.inputsOf(update)['filter'] ?? [];

      graph.add(deletePosts(), { filter: [filterData(update, idToUserId)] });

      expect(graph.inputsOf(update)['filter']?.[0]).toBe(into);
      expect(graph.edgesOutOf(find)[0]).toBe(into);
    });
  });

  describe('after', () => {
    it('adds an order-only edge that is not an input of the node it goes to', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers(), { filter: [] });
      const del = graph.add(deleteUsers(), { filter: [] });

      graph.after(find, del);

      expect(graph.edgesOutOf(find)).toEqual([new After(find, del)]);
      expect(graph.inputsOf(del)).toEqual({ filter: [] });
    });

    it('does not change what the node it comes from returns', () => {
      const graph = graphOfUsers();
      const update = graph.add(updateUsers({ name: 'Ada' }), { filter: [] });
      const del = graph.add(deleteUsers(), { filter: [] });

      graph.after(update, del);

      expect(returned(graph, update)).toEqual([]);
    });
  });

  describe('result', () => {
    it('has the form and the collection the graph was made with, and no node', () => {
      const graph = graphOfUsers('first row', { selectedFields: ['id'] });

      expect(graph.result).toMatchObject({
        node: undefined,
        form: 'first row',
        collection: {
          modelName: 'User',
          tableName: 'users',
          namespaceId: 'public',
          state: { selectedFields: ['id'], includes: [] },
        },
      });
    });

    it('names the position it is given', () => {
      const graph = graphOfUsers('count');
      const find = graph.add(findUsers(), { filter: [] });

      graph.setResult(find);

      expect(graph.result).toMatchObject({ node: find, form: 'count' });
    });
  });
});
