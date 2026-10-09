import { describe, expect, it } from 'vitest';
import { After, FilterData } from '../../src/mutation-graph/edges';
import { deletePosts, deleteUsers, findUsers, graphOfUsers, updateUsers } from './statements';

describe('Graph', () => {
  describe('add', () => {
    it('returns the node and lists it', () => {
      const graph = graphOfUsers();
      const find = findUsers();

      expect(graph.add(find)).toBe(find);
      expect(graph.nodes).toEqual([find]);
    });

    it('lists nodes in the order they were added', () => {
      const graph = graphOfUsers();
      const find = findUsers();
      const del = deleteUsers();

      graph.add(find);
      graph.add(del, new After(find, del));

      expect(graph.nodes).toEqual([find, del]);
    });
  });

  describe('inputsOf and usersOf', () => {
    it('gives the edges that go to a node and the edges that come from it', () => {
      const graph = graphOfUsers();
      const find = findUsers();
      const update = updateUsers({ name: 'Ada' });
      const del = deletePosts();
      const intoUpdate = new FilterData(find, update, [['id', 'id']]);
      const intoDelete = new FilterData(find, del, [['id', 'author_id']]);
      const afterUpdate = new After(update, del);

      graph.add(find);
      graph.add(update, intoUpdate);
      graph.add(del, intoDelete, afterUpdate);

      expect(graph.inputsOf(find)).toEqual([]);
      expect(graph.inputsOf(update)).toEqual([intoUpdate]);
      expect(graph.inputsOf(del)).toEqual([intoDelete, afterUpdate]);
      expect(graph.usersOf(find)).toEqual([intoUpdate, intoDelete]);
      expect(graph.usersOf(update)).toEqual([afterUpdate]);
      expect(graph.usersOf(del)).toEqual([]);
    });
  });

  describe('replace', () => {
    it('puts the new node where the old one was', () => {
      const graph = graphOfUsers();
      const find = findUsers();
      const update = updateUsers({ name: 'Ada' });
      const del = deletePosts();
      const otherUpdate = updateUsers({ name: 'Grace' });
      graph.add(find);
      graph.add(update);
      graph.add(del);

      graph.replace(update, otherUpdate);

      expect(graph.nodes).toEqual([find, otherUpdate, del]);
    });

    it('moves the edges of the old node to the new node', () => {
      const graph = graphOfUsers();
      const find = findUsers();
      const update = updateUsers({ name: 'Ada' });
      const del = deletePosts();
      const otherUpdate = updateUsers({ name: 'Grace' });
      graph.add(find);
      graph.add(update, new FilterData(find, update, [['id', 'id']]));
      graph.add(del, new After(update, del));

      graph.replace(update, otherUpdate);

      expect(graph.inputsOf(update)).toEqual([]);
      expect(graph.usersOf(update)).toEqual([]);
      expect(graph.inputsOf(otherUpdate)).toEqual([
        new FilterData(find, otherUpdate, [['id', 'id']]),
      ]);
      expect(graph.usersOf(otherUpdate)).toEqual([new After(otherUpdate, del)]);
      expect(graph.usersOf(find)).toEqual([new FilterData(find, otherUpdate, [['id', 'id']])]);
    });

    it('keeps the order of the edges of the nodes at the other ends', () => {
      const graph = graphOfUsers();
      const find = findUsers();
      const first = updateUsers({ name: 'Ada' });
      const middle = updateUsers({ name: 'Grace' });
      const last = updateUsers({ name: 'Edsger' });
      const del = deletePosts();
      const otherMiddle = updateUsers({ name: 'Barbara' });
      graph.add(find);
      graph.add(first, new FilterData(find, first, [['id', 'id']]));
      graph.add(middle, new FilterData(find, middle, [['id', 'id']]));
      graph.add(last, new FilterData(find, last, [['id', 'id']]));
      graph.add(del, new After(first, del), new After(middle, del), new After(last, del));

      graph.replace(middle, otherMiddle);

      expect(graph.nodes).toEqual([find, first, otherMiddle, last, del]);
      expect(graph.usersOf(find).map((edge) => edge.to)).toEqual([first, otherMiddle, last]);
      expect(graph.inputsOf(del).map((edge) => edge.from)).toEqual([first, otherMiddle, last]);
    });

    it('keeps the order of the edges of the node it replaces', () => {
      const graph = graphOfUsers();
      const findUser = findUsers();
      const findPost = findUsers();
      const update = updateUsers({ name: 'Ada' });
      const firstDelete = deletePosts();
      const secondDelete = deletePosts();
      const otherUpdate = updateUsers({ name: 'Grace' });
      graph.add(findUser);
      graph.add(findPost);
      graph.add(
        update,
        new FilterData(findUser, update, [['id', 'id']]),
        new After(findPost, update),
      );
      graph.add(firstDelete, new After(update, firstDelete));
      graph.add(secondDelete, new FilterData(update, secondDelete, [['id', 'author_id']]));

      graph.replace(update, otherUpdate);

      expect(graph.inputsOf(otherUpdate)).toEqual([
        new FilterData(findUser, otherUpdate, [['id', 'id']]),
        new After(findPost, otherUpdate),
      ]);
      expect(graph.usersOf(otherUpdate)).toEqual([
        new After(otherUpdate, firstDelete),
        new FilterData(otherUpdate, secondDelete, [['id', 'author_id']]),
      ]);
    });

    it('gives the nodes at both ends the same edge object', () => {
      const graph = graphOfUsers();
      const find = findUsers();
      const update = updateUsers({ name: 'Ada' });
      const del = deletePosts();
      const otherUpdate = updateUsers({ name: 'Grace' });
      graph.add(find);
      graph.add(update, new FilterData(find, update, [['id', 'id']]));
      graph.add(del, new After(update, del));

      graph.replace(update, otherUpdate);

      expect(graph.usersOf(find)[0]).toBe(graph.inputsOf(otherUpdate)[0]);
      expect(graph.inputsOf(del)[0]).toBe(graph.usersOf(otherUpdate)[0]);
    });

    it('lets the old node be added again', () => {
      const graph = graphOfUsers();
      const update = updateUsers({ name: 'Ada' });
      const otherUpdate = updateUsers({ name: 'Grace' });
      graph.add(update);
      graph.replace(update, otherUpdate);

      graph.add(update);

      expect(graph.nodes).toEqual([otherUpdate, update]);
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

    it('names the node it is given', () => {
      const graph = graphOfUsers('count');
      const find = findUsers();
      graph.add(find);

      graph.setResult(find);

      expect(graph.result).toMatchObject({ node: find, form: 'count' });
    });

    it('moves to the new node when its node is replaced', () => {
      const graph = graphOfUsers();
      const update = updateUsers({ name: 'Ada' });
      const otherUpdate = updateUsers({ name: 'Grace' });
      graph.add(update);
      graph.setResult(update);

      graph.replace(update, otherUpdate);

      expect(graph.result.node).toBe(otherUpdate);
    });
  });
});
