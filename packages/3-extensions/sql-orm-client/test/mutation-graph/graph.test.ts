import { describe, expect, it } from 'vitest';
import { After, after, FilterData, filterData } from '../../src/mutation-graph/edges';
import { deletePosts, deleteUsers, findUsers, graphOfUsers, updateUsers } from './statements';

describe('Graph', () => {
  describe('add', () => {
    it('returns the position of the node, counting from zero', () => {
      const graph = graphOfUsers();
      const find = findUsers();
      const del = deleteUsers();

      expect(graph.add(find)).toBe(0);
      expect(graph.add(del, after(0))).toBe(1);
      expect(graph.nodes()).toEqual([
        [0, find],
        [1, del],
      ]);
    });

    it('gives each input the position of the node as where it goes', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers());

      const del = graph.add(deleteUsers(), filterData(find, [['id', 'id']]), after(find));

      expect(graph.edgesInto(del)).toEqual([
        new FilterData(find, del, [['id', 'id']]),
        new After(find, del),
      ]);
    });
  });

  describe('edgesInto and edgesOutOf', () => {
    it('give the edges that go to a position and the edges that come from it', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers());
      const update = graph.add(updateUsers({ name: 'Ada' }), filterData(find, [['id', 'id']]));
      const del = graph.add(deletePosts(), filterData(find, [['id', 'author_id']]), after(update));

      expect(graph.edgesInto(find)).toEqual([]);
      expect(graph.edgesInto(update)).toEqual([new FilterData(find, update, [['id', 'id']])]);
      expect(graph.edgesInto(del)).toEqual([
        new FilterData(find, del, [['id', 'author_id']]),
        new After(update, del),
      ]);
      expect(graph.edgesOutOf(find)).toEqual([
        new FilterData(find, update, [['id', 'id']]),
        new FilterData(find, del, [['id', 'author_id']]),
      ]);
      expect(graph.edgesOutOf(update)).toEqual([new After(update, del)]);
      expect(graph.edgesOutOf(del)).toEqual([]);
    });

    it('list one edge object at both of its positions', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers());
      const del = graph.add(deleteUsers(), after(find));

      expect(graph.edgesOutOf(find)[0]).toBe(graph.edgesInto(del)[0]);
    });
  });

  describe('replace', () => {
    it('puts the new node at the position', () => {
      const graph = graphOfUsers();
      const find = findUsers();
      const del = deletePosts();
      const otherUpdate = updateUsers({ name: 'Grace' });
      graph.add(find);
      const update = graph.add(updateUsers({ name: 'Ada' }));
      graph.add(del);

      graph.replace(update, otherUpdate);

      expect(graph.nodeAt(update)).toBe(otherUpdate);
      expect(graph.nodes()).toEqual([
        [0, find],
        [1, otherUpdate],
        [2, del],
      ]);
    });

    it('touches no edge', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers());
      const update = graph.add(updateUsers({ name: 'Ada' }), filterData(find, [['id', 'id']]));
      const del = graph.add(deletePosts(), after(update));
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
      graph.add(find);
      const update = graph.add(updateUsers({ name: 'Ada' }));
      graph.add(del);

      graph.remove(update);

      expect(graph.nodeAt(update)).toBeUndefined();
      expect(graph.nodes()).toEqual([
        [0, find],
        [2, del],
      ]);
    });

    it('takes the edges of the node out of the positions at their other ends', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers());
      const update = graph.add(updateUsers({ name: 'Ada' }), filterData(find, [['id', 'id']]));
      const del = graph.add(deletePosts(), filterData(find, [['id', 'author_id']]), after(update));

      graph.remove(update);

      expect(graph.edgesInto(update)).toEqual([]);
      expect(graph.edgesOutOf(update)).toEqual([]);
      expect(graph.edgesOutOf(find)).toEqual([new FilterData(find, del, [['id', 'author_id']])]);
      expect(graph.edgesInto(del)).toEqual([new FilterData(find, del, [['id', 'author_id']])]);
    });

    it('leaves the edges between the other nodes intact', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers());
      const update = graph.add(updateUsers({ name: 'Ada' }), after(find));
      const del = graph.add(deletePosts(), after(find));
      const [kept] = graph.edgesInto(del);

      graph.remove(update);

      expect(graph.edgesOutOf(find)).toEqual([kept]);
      expect(graph.edgesInto(del)[0]).toBe(kept);
    });

    it('gives the next node the next position, not the emptied one', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUsers());
      graph.remove(find);

      expect(graph.add(deleteUsers())).toBe(1);
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
      const find = graph.add(findUsers());

      graph.setResult(find);

      expect(graph.result).toMatchObject({ node: find, form: 'count' });
    });

    it('still names its position after the node there is replaced', () => {
      const graph = graphOfUsers();
      const otherUpdate = updateUsers({ name: 'Grace' });
      const update = graph.add(updateUsers({ name: 'Ada' }));
      graph.setResult(update);

      graph.replace(update, otherUpdate);

      expect(graph.nodeAt(update)).toBe(otherUpdate);
      expect(graph.result.node).toBe(update);
    });

    it('names an empty position after its node is removed', () => {
      const graph = graphOfUsers();
      const update = graph.add(updateUsers({ name: 'Ada' }));
      graph.setResult(update);

      graph.remove(update);

      expect(graph.nodeAt(update)).toBeUndefined();
    });
  });
});
