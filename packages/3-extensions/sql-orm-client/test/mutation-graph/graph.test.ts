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
