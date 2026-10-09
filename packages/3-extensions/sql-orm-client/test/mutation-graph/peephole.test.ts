import { describe, expect, it } from 'vitest';
import { After, FilterData } from '../../src/mutation-graph/edges';
import { Node, type StatementAst } from '../../src/mutation-graph/nodes';
import { findUsers, graphOfUsers, updateUsers } from './statements';

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
  it('keeps a node whose peephole returns the node itself', () => {
    const graph = graphOfUsers();
    const update = updateUsers({ name: 'Ada' });

    expect(graph.add(update)).toBe(update);
    expect(graph.nodes).toEqual([update]);
  });

  it('puts the replacement in the graph with the inputs of the node that was added', () => {
    const graph = graphOfUsers();
    const find = findUsers();
    graph.add(find);
    const replacement = updateUsers({ name: 'Ada' });
    const added = new ReplacedOnAdd(replacement);

    const result = graph.add(added, new FilterData(find, added, [['id', 'id']]));

    expect(result).toBe(replacement);
    expect(graph.nodes).toEqual([find, replacement]);
    expect(graph.inputsOf(replacement)).toEqual([
      new FilterData(find, replacement, [['id', 'id']]),
    ]);
  });

  describe('an Update that sets nothing', () => {
    it('is not added, and add returns nothing', () => {
      const graph = graphOfUsers();

      expect(graph.add(updateUsers({}))).toBeUndefined();
      expect(graph.nodes).toEqual([]);
    });

    it('leaves the other nodes in the graph and takes its own edges out', () => {
      const graph = graphOfUsers();
      const find = findUsers();
      graph.add(find);
      const update = updateUsers({});

      graph.add(update, new FilterData(find, update, [['id', 'id']]));

      expect(graph.nodes).toEqual([find]);
      expect(graph.usersOf(find)).toEqual([]);
      expect(graph.inputsOf(update)).toEqual([]);
    });

    it('leaves no trace in the nodes it read from, also when it read from one node twice', () => {
      const graph = graphOfUsers();
      const findUser = findUsers();
      const findOther = findUsers();
      const kept = updateUsers({ name: 'Ada' });
      const removed = updateUsers({});
      const keptEdge = new FilterData(findUser, kept, [['id', 'id']]);
      graph.add(findUser);
      graph.add(findOther);
      graph.add(kept, keptEdge);

      graph.add(
        removed,
        new FilterData(findUser, removed, [['id', 'id']]),
        new After(findOther, removed),
        new After(findUser, removed),
      );

      expect(graph.nodes).toEqual([findUser, findOther, kept]);
      expect(graph.usersOf(findUser)).toEqual([keptEdge]);
      expect(graph.usersOf(findOther)).toEqual([]);
      expect(graph.inputsOf(removed)).toEqual([]);
    });

    it('lets nodes be added after it with their own edges', () => {
      const graph = graphOfUsers();
      const find = findUsers();
      const removed = updateUsers({});
      const added = updateUsers({ name: 'Ada' });
      const addedEdge = new FilterData(find, added, [['id', 'id']]);
      graph.add(find);
      graph.add(removed, new FilterData(find, removed, [['id', 'id']]));

      graph.add(added, addedEdge);

      expect(graph.nodes).toEqual([find, added]);
      expect(graph.usersOf(find)).toEqual([addedEdge]);
      expect(graph.inputsOf(added)).toEqual([addedEdge]);
    });

    it('gives an empty result when it was to be the result', () => {
      const graph = graphOfUsers();

      graph.setResult(graph.add(updateUsers({})));

      expect(graph.result.node).toBeUndefined();
    });
  });
});
