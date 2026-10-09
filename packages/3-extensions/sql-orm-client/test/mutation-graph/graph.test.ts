import { describe, expect, it } from 'vitest';
import { After, IntoWhere } from '../../src/mutation-graph/edges';
import { Graph } from '../../src/mutation-graph/graph';
import { Delete, Find, Update } from '../../src/mutation-graph/nodes';
import { postTable, userTable } from './tables';

describe('Graph', () => {
  describe('add', () => {
    it('returns the node and lists it', () => {
      const graph = new Graph();
      const find = new Find(userTable, []);

      expect(graph.add(find)).toBe(find);
      expect(graph.nodes).toEqual([find]);
    });

    it('lists nodes in the order they were added', () => {
      const graph = new Graph();
      const find = new Find(userTable, []);
      const del = new Delete(userTable, []);

      graph.add(find);
      graph.add(del, new After(find, del));

      expect(graph.nodes).toEqual([find, del]);
    });

    it('refuses a node that is already in the graph', () => {
      const graph = new Graph();
      const find = new Find(userTable, []);
      graph.add(find);

      expect(() => graph.add(find)).toThrow('already in the graph');
    });

    it('refuses an input that does not go to the node being added', () => {
      const graph = new Graph();
      const find = new Find(userTable, []);
      const del = new Delete(userTable, []);
      const otherDelete = new Delete(postTable, []);
      graph.add(find);

      expect(() => graph.add(del, new After(find, otherDelete))).toThrow(
        'must go to the node being added',
      );
    });

    it('refuses an input that comes from a node outside the graph', () => {
      const graph = new Graph();
      const find = new Find(userTable, []);
      const del = new Delete(userTable, []);

      expect(() => graph.add(del, new After(find, del))).toThrow(
        'must come from a node in the graph',
      );
    });
  });

  describe('inputsOf and usersOf', () => {
    it('gives the edges that go to a node and the edges that come from it', () => {
      const graph = new Graph();
      const find = new Find(userTable, []);
      const update = new Update(userTable, { name: 'Ada' }, []);
      const del = new Delete(postTable, []);
      const intoUpdate = new IntoWhere(find, update, [['id', 'id']]);
      const intoDelete = new IntoWhere(find, del, [['id', 'author_id']]);
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
      const graph = new Graph();
      const find = new Find(userTable, []);
      const update = new Update(userTable, { name: 'Ada' }, []);
      const del = new Delete(postTable, []);
      const otherUpdate = new Update(userTable, { name: 'Grace' }, []);
      graph.add(find);
      graph.add(update);
      graph.add(del);

      graph.replace(update, otherUpdate);

      expect(graph.nodes).toEqual([find, otherUpdate, del]);
    });

    it('moves the edges of the old node to the new node', () => {
      const graph = new Graph();
      const find = new Find(userTable, []);
      const update = new Update(userTable, { name: 'Ada' }, []);
      const del = new Delete(postTable, []);
      const otherUpdate = new Update(userTable, { name: 'Grace' }, []);
      graph.add(find);
      graph.add(update, new IntoWhere(find, update, [['id', 'id']]));
      graph.add(del, new After(update, del));

      graph.replace(update, otherUpdate);

      expect(graph.inputsOf(update)).toEqual([]);
      expect(graph.usersOf(update)).toEqual([]);
      expect(graph.inputsOf(otherUpdate)).toEqual([
        new IntoWhere(find, otherUpdate, [['id', 'id']]),
      ]);
      expect(graph.usersOf(otherUpdate)).toEqual([new After(otherUpdate, del)]);
      expect(graph.usersOf(find)).toEqual([new IntoWhere(find, otherUpdate, [['id', 'id']])]);
    });

    it('keeps the order of the edges of the nodes at the other ends', () => {
      const graph = new Graph();
      const find = new Find(userTable, []);
      const first = new Update(userTable, { name: 'Ada' }, []);
      const middle = new Update(userTable, { name: 'Grace' }, []);
      const last = new Update(userTable, { name: 'Edsger' }, []);
      const del = new Delete(postTable, []);
      const otherMiddle = new Update(userTable, { name: 'Barbara' }, []);
      graph.add(find);
      graph.add(first, new IntoWhere(find, first, [['id', 'id']]));
      graph.add(middle, new IntoWhere(find, middle, [['id', 'id']]));
      graph.add(last, new IntoWhere(find, last, [['id', 'id']]));
      graph.add(del, new After(first, del), new After(middle, del), new After(last, del));

      graph.replace(middle, otherMiddle);

      expect(graph.nodes).toEqual([find, first, otherMiddle, last, del]);
      expect(graph.usersOf(find).map((edge) => edge.to)).toEqual([first, otherMiddle, last]);
      expect(graph.inputsOf(del).map((edge) => edge.from)).toEqual([first, otherMiddle, last]);
    });

    it('keeps the order of the edges of the node it replaces', () => {
      const graph = new Graph();
      const findUser = new Find(userTable, []);
      const findPost = new Find(postTable, []);
      const update = new Update(userTable, { name: 'Ada' }, []);
      const firstDelete = new Delete(postTable, []);
      const secondDelete = new Delete(postTable, []);
      const otherUpdate = new Update(userTable, { name: 'Grace' }, []);
      graph.add(findUser);
      graph.add(findPost);
      graph.add(
        update,
        new IntoWhere(findUser, update, [['id', 'id']]),
        new After(findPost, update),
      );
      graph.add(firstDelete, new After(update, firstDelete));
      graph.add(secondDelete, new IntoWhere(update, secondDelete, [['id', 'author_id']]));

      graph.replace(update, otherUpdate);

      expect(graph.inputsOf(otherUpdate)).toEqual([
        new IntoWhere(findUser, otherUpdate, [['id', 'id']]),
        new After(findPost, otherUpdate),
      ]);
      expect(graph.usersOf(otherUpdate)).toEqual([
        new After(otherUpdate, firstDelete),
        new IntoWhere(otherUpdate, secondDelete, [['id', 'author_id']]),
      ]);
    });

    it('gives the nodes at both ends the same edge object', () => {
      const graph = new Graph();
      const find = new Find(userTable, []);
      const update = new Update(userTable, { name: 'Ada' }, []);
      const del = new Delete(postTable, []);
      const otherUpdate = new Update(userTable, { name: 'Grace' }, []);
      graph.add(find);
      graph.add(update, new IntoWhere(find, update, [['id', 'id']]));
      graph.add(del, new After(update, del));

      graph.replace(update, otherUpdate);

      expect(graph.usersOf(find)[0]).toBe(graph.inputsOf(otherUpdate)[0]);
      expect(graph.inputsOf(del)[0]).toBe(graph.usersOf(otherUpdate)[0]);
    });

    it('lets the old node be added again', () => {
      const graph = new Graph();
      const update = new Update(userTable, { name: 'Ada' }, []);
      const otherUpdate = new Update(userTable, { name: 'Grace' }, []);
      graph.add(update);
      graph.replace(update, otherUpdate);

      graph.add(update);

      expect(graph.nodes).toEqual([otherUpdate, update]);
    });

    it('moves the result to the new node', () => {
      const graph = new Graph();
      const update = new Update(userTable, { name: 'Ada' }, []);
      const otherUpdate = new Update(userTable, { name: 'Grace' }, []);
      graph.add(update);
      graph.setResult({ node: update, form: 'rows', selectedFields: ['name'], includes: [] });

      graph.replace(update, otherUpdate);

      expect(graph.result).toEqual({
        node: otherUpdate,
        form: 'rows',
        selectedFields: ['name'],
        includes: [],
      });
    });

    it('refuses an old node that is not in the graph', () => {
      const graph = new Graph();

      expect(() => graph.replace(new Find(userTable, []), new Find(userTable, []))).toThrow(
        'is not in the graph',
      );
    });

    it('refuses a new node that is already in the graph', () => {
      const graph = new Graph();
      const find = new Find(userTable, []);
      const del = new Delete(userTable, []);
      graph.add(find);
      graph.add(del);

      expect(() => graph.replace(find, del)).toThrow('already in the graph');
    });
  });

  describe('result', () => {
    it('is not set on a new graph', () => {
      expect(new Graph().result).toBeUndefined();
    });

    it('names a node, a form, and the selection and includes of the caller', () => {
      const graph = new Graph();
      const find = graph.add(new Find(userTable, []));

      graph.setResult({ node: find, form: 'first row', selectedFields: ['id'], includes: [] });

      expect(graph.result).toEqual({
        node: find,
        form: 'first row',
        selectedFields: ['id'],
        includes: [],
      });
    });

    it('refuses a node that is not in the graph', () => {
      const graph = new Graph();

      expect(() =>
        graph.setResult({
          node: new Find(userTable, []),
          form: 'count',
          selectedFields: undefined,
          includes: [],
        }),
      ).toThrow('is not in the graph');
    });
  });
});
