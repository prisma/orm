import { describe, expect, it } from 'vitest';
import { After, IntoWhere } from '../../src/mutation-graph/edges';
import { Graph } from '../../src/mutation-graph/graph';
import { Delete, Find, Node, Update } from '../../src/mutation-graph/nodes';
import { userTable } from './tables';

class ReplacedOnAdd extends Node {
  readonly replacement: Node;

  constructor(replacement: Node) {
    super();
    this.replacement = replacement;
  }

  override peephole(): Node {
    return this.replacement;
  }
}

describe('peephole on add', () => {
  it('keeps a node whose peephole returns the node itself', () => {
    const graph = new Graph();
    const update = new Update(userTable, { name: 'Ada' }, []);

    expect(graph.add(update)).toBe(update);
    expect(graph.nodes).toEqual([update]);
  });

  it('puts the replacement in the graph with the inputs of the node that was added', () => {
    const graph = new Graph();
    const find = new Find(userTable, []);
    graph.add(find);
    const replacement = new Update(userTable, { name: 'Ada' }, []);
    const added = new ReplacedOnAdd(replacement);

    const result = graph.add(added, new IntoWhere(find, added, [['id', 'id']]));

    expect(result).toBe(replacement);
    expect(graph.nodes).toEqual([find, replacement]);
    expect(graph.inputsOf(replacement)).toEqual([new IntoWhere(find, replacement, [['id', 'id']])]);
  });

  describe('an Update that sets nothing', () => {
    it('is not added, and add returns nothing', () => {
      const graph = new Graph();

      expect(graph.add(new Update(userTable, {}, []))).toBeUndefined();
      expect(graph.nodes).toEqual([]);
    });

    it('leaves the other nodes in the graph and takes its own edges out', () => {
      const graph = new Graph();
      const find = new Find(userTable, []);
      graph.add(find);
      const update = new Update(userTable, {}, []);

      graph.add(update, new IntoWhere(find, update, [['id', 'id']]));

      expect(graph.nodes).toEqual([find]);
      expect(graph.usersOf(find)).toEqual([]);
      expect(graph.inputsOf(update)).toEqual([]);
    });

    it('leaves no trace in the nodes it read from, also when it read from one node twice', () => {
      const graph = new Graph();
      const findUser = new Find(userTable, []);
      const findOther = new Find(userTable, []);
      const kept = new Update(userTable, { name: 'Ada' }, []);
      const removed = new Update(userTable, {}, []);
      const keptEdge = new IntoWhere(findUser, kept, [['id', 'id']]);
      graph.add(findUser);
      graph.add(findOther);
      graph.add(kept, keptEdge);

      graph.add(
        removed,
        new IntoWhere(findUser, removed, [['id', 'id']]),
        new After(findOther, removed),
        new After(findUser, removed),
      );

      expect(graph.nodes).toEqual([findUser, findOther, kept]);
      expect(graph.usersOf(findUser)).toEqual([keptEdge]);
      expect(graph.usersOf(findOther)).toEqual([]);
      expect(graph.inputsOf(removed)).toEqual([]);
    });

    it('lets nodes be added after it with their own edges', () => {
      const graph = new Graph();
      const find = new Find(userTable, []);
      const removed = new Update(userTable, {}, []);
      const added = new Update(userTable, { name: 'Ada' }, []);
      const addedEdge = new IntoWhere(find, added, [['id', 'id']]);
      graph.add(find);
      graph.add(removed, new IntoWhere(find, removed, [['id', 'id']]));

      graph.add(added, addedEdge);

      expect(graph.nodes).toEqual([find, added]);
      expect(graph.usersOf(find)).toEqual([addedEdge]);
      expect(graph.inputsOf(added)).toEqual([addedEdge]);
    });

    it('cannot be read from by a node added later', () => {
      const graph = new Graph();
      const removed = new Update(userTable, {}, []);
      const del = new Delete(userTable, []);
      graph.add(removed);

      expect(() => graph.add(del, new After(removed, del))).toThrow(
        'must come from a node in the graph',
      );
    });

    it('gives an empty result when it was to be the result', () => {
      const graph = new Graph();
      const update = graph.add(new Update(userTable, {}, []));

      graph.setResult({ node: update, form: 'rows', selectedFields: undefined, includes: [] });

      expect(graph.result).toEqual({
        node: undefined,
        form: 'rows',
        selectedFields: undefined,
        includes: [],
      });
    });
  });
});
