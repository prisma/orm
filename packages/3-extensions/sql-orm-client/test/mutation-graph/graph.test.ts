import { describe, expect, it } from 'vitest';
import { CrossJoin } from '../../src/mutation-graph/cross-join';
import type { NodeId } from '../../src/mutation-graph/edge';
import { FilterData } from '../../src/mutation-graph/filter-data';
import { Graph } from '../../src/mutation-graph/graph';
import { Rows } from '../../src/mutation-graph/rows';
import { StatementNode } from '../../src/mutation-graph/statement-node';
import { UnionAll } from '../../src/mutation-graph/union-all';
import { columnPairs, deletePosts, deleteUsers, findUsers, updateUsers } from './statements';

const sameId = columnPairs('users', 'users', [['id', 'id']]);
const idToUserId = columnPairs('users', 'posts', [['id', 'user_id']]);
const emailToTitle = columnPairs('users', 'posts', [['email', 'title']]);

function firstFilterOf(graph: Graph, id: NodeId): unknown {
  return [graph.inputsOf(id)['filter'] ?? []].flat()[0];
}

function returned(graph: Graph, id: NodeId): string[] {
  return graph
    .nodes()
    .filter(([position]) => position === id)
    .flatMap(([, node]) => (node instanceof StatementNode ? node.returns : []))
    .map((column) => column.alias);
}

describe('Graph', () => {
  describe('add', () => {
    it('returns the position of the node, counting from zero', () => {
      const graph = new Graph();
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

    it('keeps the inputs of the node in their slot', () => {
      const graph = new Graph();
      const find = graph.add(findUsers(), { filter: [] });
      const inputs = {
        filter: [new FilterData(find, idToUserId), new FilterData(find, emailToTitle)],
      };

      const del = graph.add(deletePosts(), inputs);

      expect(graph.inputsOf(del)).toBe(inputs);
    });

    it('keeps a slot with no edge', () => {
      const graph = new Graph();

      expect(graph.inputsOf(graph.add(findUsers(), { filter: [] }))).toEqual({ filter: [] });
    });

    it('makes the source of a data edge also return the columns the edge reads', () => {
      const graph = new Graph();
      const update = graph.add(updateUsers({ name: 'Ada' }), { filter: [] });
      expect(returned(graph, update)).toEqual([]);

      graph.add(deletePosts(), { filter: [new FilterData(update, idToUserId)] });
      graph.add(deletePosts(), {
        filter: [new FilterData(update, emailToTitle), new FilterData(update, idToUserId)],
      });

      expect(returned(graph, update)).toEqual(['id', 'email']);
    });

    it('leaves the inputs of a node whose statement it widens as they were', () => {
      const graph = new Graph();
      const find = graph.add(findUsers(), { filter: [] });
      const inputs = { filter: [new FilterData(find, sameId)] };
      const update = graph.add(updateUsers({ name: 'Ada' }), inputs);

      graph.add(deletePosts(), { filter: [new FilterData(update, idToUserId)] });

      expect(graph.inputsOf(update)).toBe(inputs);
    });

    it('does not change what a node returns when a node with no edge is added after it', () => {
      const graph = new Graph();
      const update = graph.add(updateUsers({ name: 'Ada' }), { filter: [] });

      graph.add(deleteUsers(), { filter: [] });

      expect(returned(graph, update)).toEqual([]);
    });

    it('leaves a node that runs no statement as it was when an edge reads from it', () => {
      const graph = new Graph();
      const find = graph.add(findUsers([], ['email']), { filter: [] });
      const union = new UnionAll();
      const unionId = graph.add(union, { rows: [new Rows(find, sameId)] });

      graph.add(updateUsers({ name: 'Ada' }), { filter: [new FilterData(unionId, sameId)] });

      expect(graph.nodes().find(([id]) => id === unionId)?.[1]).toBe(union);
      expect(returned(graph, find)).toEqual(['email', 'id']);
    });
  });

  describe('readersOf', () => {
    it('gives, for a position, each edge that reads from it with the position of its reader', () => {
      const graph = new Graph();
      const find = graph.add(findUsers(), { filter: [] });
      const toUpdate = new FilterData(find, sameId);
      const toDelete = new FilterData(find, idToUserId);
      const update = graph.add(updateUsers({ name: 'Ada' }), { filter: [toUpdate] });
      const del = graph.add(deletePosts(), { filter: [toDelete] });

      expect(graph.readersOf(find)).toEqual([
        { reader: update, edge: toUpdate },
        { reader: del, edge: toDelete },
      ]);
      expect(graph.readersOf(find)[0]?.edge).toBe(firstFilterOf(graph, update));
      expect(graph.readersOf(del)).toEqual([]);
    });
  });

  describe('replace', () => {
    it('puts the new node at the position and leaves the others where they are', () => {
      const graph = new Graph();
      const find = findUsers();
      const del = deletePosts();
      const otherUpdate = updateUsers({ name: 'Grace' });
      const findId = graph.add(find, { filter: [] });
      const update = graph.add(updateUsers({ name: 'Ada' }), { filter: [] });
      const delId = graph.add(del, { filter: [] });

      graph.replace(update, otherUpdate);

      expect(graph.nodes()).toEqual([
        [findId, find],
        [update, otherUpdate],
        [delId, del],
      ]);
    });

    it('touches no edge in either direction', () => {
      const graph = new Graph();
      const find = graph.add(findUsers(), { filter: [] });
      const into = new FilterData(find, sameId);
      const update = graph.add(updateUsers({ name: 'Ada' }, undefined, ['id']), {
        filter: [into],
      });
      const outOf = new FilterData(update, idToUserId);
      const del = graph.add(deletePosts(), { filter: [outOf] });

      graph.replace(update, updateUsers({ name: 'Grace' }));

      expect(firstFilterOf(graph, update)).toBe(into);
      expect(graph.readersOf(find)).toEqual([{ reader: update, edge: into }]);
      expect(graph.readersOf(find)[0]?.edge).toBe(into);
      expect(graph.readersOf(update)).toEqual([{ reader: del, edge: outOf }]);
      expect(firstFilterOf(graph, del)).toBe(outOf);
    });
  });

  describe('remove', () => {
    it('empties the position, and nodes skips it and keeps the other positions', () => {
      const graph = new Graph();
      const find = findUsers();
      const del = deletePosts();
      const findId = graph.add(find, { filter: [] });
      const update = graph.add(updateUsers({ name: 'Ada' }), { filter: [] });
      const delId = graph.add(del, { filter: [] });

      graph.remove(update);

      expect(graph.nodes()).toEqual([
        [findId, find],
        [delId, del],
      ]);
      expect([findId, delId]).toEqual([0, 2]);
    });

    it('takes the edges of a node that is both a source and a reader out of both sides', () => {
      const graph = new Graph();
      const find = graph.add(findUsers(), { filter: [] });
      const update = graph.add(updateUsers({ name: 'Ada' }), {
        filter: [new FilterData(find, sameId)],
      });
      const kept = new FilterData(find, idToUserId);
      const del = graph.add(deletePosts(), {
        filter: [kept, new FilterData(update, idToUserId)],
      });

      graph.remove(update);

      expect(graph.inputsOf(update)).toEqual({});
      expect(graph.readersOf(update)).toEqual([]);
      expect(graph.readersOf(find)).toEqual([{ reader: del, edge: kept }]);
      expect(graph.inputsOf(del)).toEqual({ filter: [kept] });
    });

    it('leaves the inputs and the readers of the other positions intact', () => {
      const graph = new Graph();
      const find = graph.add(findUsers(), { filter: [] });
      const removed = graph.add(updateUsers({ name: 'Ada' }), { filter: [] });
      const kept = new FilterData(find, idToUserId);
      const del = graph.add(deletePosts(), { filter: [kept] });

      graph.remove(removed);

      expect(graph.readersOf(find)).toEqual([{ reader: del, edge: kept }]);
      expect(firstFilterOf(graph, del)).toBe(kept);
    });

    it('keeps a slot that holds one edge when the source of that edge is removed', () => {
      const graph = new Graph();
      const left = graph.add(findUsers(), { filter: [] });
      const right = graph.add(findUsers(), { filter: [] });
      const inputs = { left: new Rows(left, sameId), right: new Rows(right, sameId) };
      const join = graph.add(new CrossJoin(), inputs);

      graph.remove(right);

      expect(graph.inputsOf(join)).toEqual(inputs);
      expect(graph.readersOf(left)).toEqual([{ reader: join, edge: inputs.left }]);
    });

    it('gives the next node the next position, not the emptied one', () => {
      const graph = new Graph();
      const find = graph.add(findUsers(), { filter: [] });
      graph.remove(find);

      const next = graph.add(deleteUsers(), { filter: [] });

      expect(next).not.toBe(find);
      expect(graph.nodes().map(([id]) => id)).toEqual([next]);
    });
  });

  describe('result', () => {
    it('names no node on a new graph', () => {
      expect(new Graph().result).toBeUndefined();
    });

    it('names the position it is given', () => {
      const graph = new Graph();
      const find = graph.add(findUsers(), { filter: [] });

      graph.setResult(find);

      expect(graph.result).toBe(find);
    });
  });
});
