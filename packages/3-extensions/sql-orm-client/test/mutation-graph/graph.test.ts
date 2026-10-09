import { describe, expect, it } from 'vitest';
import { After, FilterData, filterData } from '../../src/mutation-graph/edges';
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

function returned(graph: ReturnType<typeof graphOfUsers>, id: number): string[] {
  return (graph.nodeAt(id)?.returns ?? []).map((column) => column.alias);
}

describe('Graph', () => {
  describe('add', () => {
    it('returns the position of the node, counting from zero', () => {
      const graph = graphOfUsers();
      const find = findUsers();
      const del = deleteUsers();

      expect(graph.add(find, { filter: [] })).toBe(0);
      expect(graph.add(del, { filter: [] })).toBe(1);
      expect(graph.nodes()).toEqual([
        [0, find],
        [1, del],
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
  });

  describe('after', () => {
    it('adds an order-only edge between two nodes of the graph', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers(), { filter: [] });
      const del = graph.add(deleteUsers(), { filter: [] });

      graph.after(find, del);

      expect(graph.edgesInto(del)).toEqual([new After(find, del)]);
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

  describe('edgesInto and edgesOutOf', () => {
    it('give the edges that go to a position, data edges first, and the edges that come from it', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers(), { filter: [] });
      const update = graph.add(updateUsers({ name: 'Ada' }), {
        filter: [filterData(find, sameId)],
      });
      const del = graph.add(deletePosts(), { filter: [filterData(find, idToUserId)] });
      graph.after(update, del);

      expect(graph.edgesInto(find)).toEqual([]);
      expect(graph.edgesInto(update)).toEqual([new FilterData(find, update, sameId)]);
      expect(graph.edgesInto(del)).toEqual([
        new FilterData(find, del, idToUserId),
        new After(update, del),
      ]);
      expect(graph.edgesOutOf(find)).toEqual([
        new FilterData(find, update, sameId),
        new FilterData(find, del, idToUserId),
      ]);
      expect(graph.edgesOutOf(update)).toEqual([new After(update, del)]);
      expect(graph.edgesOutOf(del)).toEqual([]);
    });

    it('list one edge object at both of its positions', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers(), { filter: [] });
      const del = graph.add(deleteUsers(), { filter: [filterData(find, sameId)] });

      expect(graph.edgesOutOf(find)[0]).toBe(graph.edgesInto(del)[0]);
    });
  });

  describe('replace', () => {
    it('puts the new node at the position', () => {
      const graph = graphOfUsers();
      const find = findUsers();
      const del = deletePosts();
      const otherUpdate = updateUsers({ name: 'Grace' });
      graph.add(find, { filter: [] });
      const update = graph.add(updateUsers({ name: 'Ada' }), { filter: [] });
      graph.add(del, { filter: [] });

      graph.replace(update, otherUpdate);

      expect(graph.nodes()).toEqual([
        [0, find],
        [1, otherUpdate],
        [2, del],
      ]);
    });

    it('touches no edge', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers(), { filter: [] });
      const update = graph.add(updateUsers({ name: 'Ada' }), {
        filter: [filterData(find, sameId)],
      });
      const del = graph.add(deletePosts(), { filter: [] });
      graph.after(update, del);
      const [into] = graph.edgesInto(update);
      const [outOf] = graph.edgesOutOf(update);

      graph.replace(update, updateUsers({ name: 'Grace' }));

      expect(graph.edgesInto(update)).toEqual([into]);
      expect(graph.edgesInto(update)[0]).toBe(into);
      expect(graph.edgesOutOf(update)[0]).toBe(outOf);
      expect(graph.edgesOutOf(find)[0]).toBe(into);
      expect(graph.edgesInto(del)[0]).toBe(outOf);
    });
  });

  describe('remove', () => {
    it('empties the position and leaves the other positions as they were', () => {
      const graph = graphOfUsers();
      const find = findUsers();
      const del = deletePosts();
      graph.add(find, { filter: [] });
      const update = graph.add(updateUsers({ name: 'Ada' }), { filter: [] });
      graph.add(del, { filter: [] });

      graph.remove(update);

      expect(graph.nodeAt(update)).toBeUndefined();
      expect(graph.nodes()).toEqual([
        [0, find],
        [2, del],
      ]);
    });

    it('takes the edges of the node out of the positions at their other ends', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers(), { filter: [] });
      const update = graph.add(updateUsers({ name: 'Ada' }), {
        filter: [filterData(find, sameId)],
      });
      const del = graph.add(deletePosts(), {
        filter: [filterData(find, idToUserId), filterData(update, idToUserId)],
      });
      graph.after(update, del);

      graph.remove(update);

      expect(graph.edgesInto(update)).toEqual([]);
      expect(graph.edgesOutOf(update)).toEqual([]);
      expect(graph.edgesOutOf(find)).toEqual([new FilterData(find, del, idToUserId)]);
      expect(graph.edgesInto(del)).toEqual([new FilterData(find, del, idToUserId)]);
      expect(graph.inputsOf(del)).toEqual({ filter: [new FilterData(find, del, idToUserId)] });
    });

    it('leaves the edges between the other nodes intact', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers(), { filter: [] });
      const update = graph.add(updateUsers({ name: 'Ada' }), { filter: [] });
      graph.after(find, update);
      const del = graph.add(deletePosts(), { filter: [filterData(find, idToUserId)] });
      const [kept] = graph.edgesInto(del);

      graph.remove(update);

      expect(graph.edgesOutOf(find)).toEqual([kept]);
      expect(graph.edgesInto(del)[0]).toBe(kept);
    });

    it('gives the next node the next position, not the emptied one', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers(), { filter: [] });
      graph.remove(find);

      expect(graph.add(deleteUsers(), { filter: [] })).toBe(1);
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

    it('still names its position after the node there is replaced', () => {
      const graph = graphOfUsers();
      const otherUpdate = updateUsers({ name: 'Grace' });
      const update = graph.add(updateUsers({ name: 'Ada' }), { filter: [] });
      graph.setResult(update);

      graph.replace(update, otherUpdate);

      expect(graph.nodeAt(update)).toBe(otherUpdate);
      expect(graph.result.node).toBe(update);
    });

    it('names an empty position after its node is removed', () => {
      const graph = graphOfUsers();
      const update = graph.add(updateUsers({ name: 'Ada' }), { filter: [] });
      graph.setResult(update);

      graph.remove(update);

      expect(graph.nodeAt(update)).toBeUndefined();
    });
  });
});
