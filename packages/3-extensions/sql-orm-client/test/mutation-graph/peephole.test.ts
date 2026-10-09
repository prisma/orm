import { describe, expect, it } from 'vitest';
import { IntoWhere } from '../../src/mutation-graph/edges';
import { Graph } from '../../src/mutation-graph/graph';
import { Find, Node, Update } from '../../src/mutation-graph/nodes';
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
