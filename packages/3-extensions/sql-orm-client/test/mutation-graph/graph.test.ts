import { describe, expect, it } from 'vitest';
import { CrossJoin } from '../../src/mutation-graph/cross-join';
import type { NodeId } from '../../src/mutation-graph/edge';
import { FilterData } from '../../src/mutation-graph/filter-data';
import type { Graph } from '../../src/mutation-graph/graph';
import { Insert } from '../../src/mutation-graph/insert';
import { PayloadData } from '../../src/mutation-graph/payload-data';
import { removeUnreadFinds } from '../../src/mutation-graph/remove-unread-finds';
import { Requires } from '../../src/mutation-graph/requires';
import { Rows } from '../../src/mutation-graph/rows';
import { State, StateEdge } from '../../src/mutation-graph/state';
import { StatementNode } from '../../src/mutation-graph/statement-node';
import { UnionAll } from '../../src/mutation-graph/union-all';
import { printGraph } from './print-graph';
import {
  columnMappings,
  deletePosts,
  findUsers,
  insertInto,
  insertOwner,
  newGraph,
  newGraphWithoutReturning,
  updateUsers,
  visibleNodes,
} from './statements';

const sameId = columnMappings('users', 'users', [['id', 'id']]);
const idToUserId = columnMappings('users', 'posts', [['id', 'user_id']]);
const emailToTitle = columnMappings('users', 'posts', [['email', 'title']]);
const posts = { namespaceId: 'public', tableName: 'posts' };
const users = { namespaceId: 'public', tableName: 'users' };

function returned(graph: Graph, id: NodeId): string[] {
  return graph
    .nodes()
    .filter(([position]) => position === id)
    .flatMap(([, node]) => (node instanceof StatementNode ? node.returns : []))
    .map((column) => column.alias);
}

function filterOf(graph: Graph, id: NodeId): unknown {
  return graph.inputsOf(id)['filter'];
}

describe('Graph', () => {
  describe('add', () => {
    it('returns the position of the node, counting from zero', () => {
      const graph = newGraph();
      const union = new UnionAll();
      const join = new CrossJoin();

      const unionId = graph.add(union);
      const joinId = graph.add(join);

      expect([unionId, joinId]).toEqual([0, 1]);
      expect(graph.nodes()).toEqual([
        [unionId, union],
        [joinId, join],
      ]);
    });

    it('gives each list slot of the node no edge, and leaves a slot for one edge unset', () => {
      const graph = newGraph();

      expect(graph.inputsOf(graph.add(new UnionAll()))).toEqual({ rows: [] });
      expect(graph.inputsOf(graph.add(new CrossJoin()))).toEqual({});
    });
  });

  describe('stateEdgesFor', () => {
    it('gives an edge from the current State of each table the statements of a node read', () => {
      const graph = newGraph();
      const update = graph.add(updateUsers({ name: 'Ada' }));
      const [written] = graph.readersOf(update);

      const edges = graph.stateEdgesFor(findUsers());

      expect(edges).toEqual(written === undefined ? [] : [new StateEdge(written.reader, users)]);
      expect(edges).toHaveLength(1);
      expect(printGraph(graph, { state: true })).toBe(
        ["n1 Update users set name = 'Ada'", 'n2 State users <- state n1', 'result: none'].join(
          '\n',
        ),
      );
    });

    it('adds the first State of a table that no node has read or written', () => {
      const graph = newGraph();

      const [edge] = graph.stateEdgesFor(findUsers());

      expect(graph.nodes()).toEqual([[edge?.from, new State(users)]]);
    });
  });

  describe('add with inputs', () => {
    it('adds the node with each edge in its slot, and the source lists the node as its reader', () => {
      const graph = newGraph();
      const find = graph.add(findUsers([], ['id', 'email']));

      const del = graph.add(deletePosts(), {
        filter: [new FilterData(find, idToUserId), new FilterData(find, emailToTitle)],
      });

      expect(printGraph(graph)).toBe(
        [
          'n1 Find users',
          'n2 Delete posts <- FilterData n1 (id->user_id), FilterData n1 (email->title)',
          'result: none',
        ].join('\n'),
      );
      expect(graph.readersOf(find)).toEqual([
        { reader: del, edge: new FilterData(find, idToUserId) },
        { reader: del, edge: new FilterData(find, emailToTitle) },
      ]);
    });

    it('adds the state edges the caller passes, and none when it passes none', () => {
      const graph = newGraph();
      const update = graph.add(updateUsers({ name: 'Ada' }));
      const unread = findUsers();
      const read = findUsers();

      graph.add(unread, {});
      graph.add(read, { state: graph.stateEdgesFor(read) });

      expect(printGraph(graph, { state: true })).toBe(
        [
          "n1 Update users set name = 'Ada'",
          'n2 State users <- state n1',
          'n3 Find users',
          'n4 Find users <- state n2',
          'result: none',
        ].join('\n'),
      );
      expect(graph.readersOf(update)).toEqual([{ reader: 1, edge: new StateEdge(update, users) }]);
    });

    it('makes each source of a data edge return the columns the edge reads', () => {
      const graph = newGraph();
      const user = graph.add(new Insert(insertInto('users', [{ name: 'Ada' }]), insertOwner));
      const find = graph.add(findUsers([], ['name']));

      graph.add(new Insert(insertInto('posts', [{ title: 'Hello' }]), insertOwner), {
        payload: [new PayloadData(user, idToUserId)],
        requires: [new Requires(find)],
      });

      expect([returned(graph, user), returned(graph, find)]).toEqual([['id'], ['name']]);
    });

    it('puts an edge into a slot that holds one edge', () => {
      const graph = newGraph();
      const left = graph.add(findUsers());
      const right = graph.add(findUsers());

      const join = graph.add(new CrossJoin(), {
        left: new Rows(left, sameId),
        right: new Rows(right, sameId),
      });

      expect(graph.inputsOf(join)).toEqual({
        left: new Rows(left, sameId),
        right: new Rows(right, sameId),
      });
    });

    it('widens the source by the columns each edge reads, once each, and leaves its inputs as they were', () => {
      const graph = newGraph();
      const find = graph.add(findUsers());
      const update = graph.add(updateUsers({ name: 'Ada' }), {
        filter: [new FilterData(find, sameId)],
      });
      expect(returned(graph, update)).toEqual([]);

      graph.add(deletePosts(), { filter: [new FilterData(update, idToUserId)] });
      graph.add(deletePosts(), {
        filter: [new FilterData(update, emailToTitle), new FilterData(update, idToUserId)],
      });

      expect(returned(graph, update)).toEqual(['id', 'email']);
      expect(filterOf(graph, update)).toEqual([new FilterData(find, sameId)]);
    });

    it('puts Rows edges into a list slot in their order, and widens only a source that runs a statement', () => {
      const graph = newGraph();
      const find = graph.add(findUsers([], ['email']));
      const second = graph.add(findUsers());
      const union = new UnionAll();
      const unionId = graph.add(union, {
        rows: [new Rows(find, sameId), new Rows(second, sameId)],
      });

      graph.add(updateUsers({ name: 'Ada' }), { filter: [new FilterData(unionId, sameId)] });

      expect(graph.inputsOf(unionId)).toEqual({
        rows: [new Rows(find, sameId), new Rows(second, sameId)],
      });
      expect(graph.nodeAt(unionId)).toBe(union);
      expect(returned(graph, find)).toEqual(['email', 'id']);
    });

    it('puts a Requires edge into the requires slot and leaves what the source returns as it was', () => {
      const graph = newGraph();
      const find = graph.add(findUsers([], ['email']));

      const update = graph.add(updateUsers({ name: 'Ada' }), { requires: [new Requires(find)] });

      expect(graph.inputsOf(update)['requires']).toEqual([new Requires(find)]);
      expect(returned(graph, find)).toEqual(['email']);
      expect(graph.columnsReadFrom(find)).toEqual([]);
    });
  });

  describe('columnsReadFrom', () => {
    it('gives the columns every edge from the node reads, in the order the edges were added', () => {
      const graph = newGraph();
      const find = graph.add(findUsers());
      graph.add(deletePosts(), { filter: [new FilterData(find, emailToTitle)] });
      const union = graph.add(new UnionAll(), { rows: [new Rows(find, sameId)] });

      expect(graph.columnsReadFrom(find).map((column) => column.alias)).toEqual(['email', 'id']);
      expect(graph.columnsReadFrom(union)).toEqual([]);
    });

    it('leaves out the columns of an edge whose reader was removed', () => {
      const graph = newGraphWithoutReturning();
      const find = graph.add(findUsers());
      graph.add(findUsers(), { filter: [new FilterData(find, sameId)] });
      graph.add(deletePosts(), { filter: [new FilterData(find, emailToTitle)] });

      removeUnreadFinds(graph);

      expect(graph.columnsReadFrom(find).map((column) => column.alias)).toEqual(['email']);
    });
  });

  describe('readersOf', () => {
    it('gives, for a position, each edge that reads from it with the position of its reader', () => {
      const graph = newGraph();
      const find = graph.add(findUsers());
      const update = graph.add(updateUsers({ name: 'Ada' }), {
        filter: [new FilterData(find, sameId)],
      });
      const del = graph.add(deletePosts(), { filter: [new FilterData(find, idToUserId)] });

      expect(graph.readersOf(find)).toEqual([
        { reader: update, edge: new FilterData(find, sameId) },
        { reader: del, edge: new FilterData(find, idToUserId) },
      ]);
      expect(graph.readersOf(find)[0]?.edge).toBe([filterOf(graph, update)].flat()[0]);
      expect(graph.readersOf(del)).toEqual([
        { reader: expect.any(Number), edge: new StateEdge(del, posts) },
      ]);
    });
  });

  describe('replace', () => {
    it('puts the new node at the position and leaves the others where they are', () => {
      const graph = newGraph();
      const find = findUsers();
      const del = deletePosts();
      const otherUpdate = updateUsers({ name: 'Grace' });
      const findId = graph.add(find);
      const update = graph.add(updateUsers({ name: 'Ada' }));
      const delId = graph.add(del);

      graph.replace(update, otherUpdate);

      expect(visibleNodes(graph)).toEqual([
        [findId, find],
        [update, otherUpdate],
        [delId, del],
      ]);
    });

    it('touches no edge in either direction', () => {
      const graph = newGraph();
      const find = graph.add(findUsers());
      const update = graph.add(updateUsers({ name: 'Ada' }, undefined, ['id']), {
        filter: [new FilterData(find, sameId)],
      });
      graph.add(deletePosts(), { filter: [new FilterData(update, idToUserId)] });
      const into = graph.inputsOf(update);
      const outOf = graph.readersOf(update);

      graph.replace(update, updateUsers({ name: 'Grace' }));

      expect(graph.inputsOf(update)).toBe(into);
      expect(graph.readersOf(update)).toBe(outOf);
    });
  });

  describe('forwarding an id', () => {
    function forwarded() {
      const graph = newGraph();
      const from = graph.add(findUsers([], ['id', 'email']));
      const to = graph.add(findUsers([], ['id', 'email']));
      graph.forward(from, to);
      return { graph, from, to };
    }

    it('gives an edge added with the inputs of a node the node the id stands for as its source', () => {
      const { graph, from, to } = forwarded();

      const del = graph.add(deletePosts(), { filter: [new FilterData(from, idToUserId)] });

      expect(graph.inputsOf(del)['filter']).toEqual([new FilterData(to, idToUserId)]);
      expect(graph.readersOf(to)).toEqual([{ reader: del, edge: new FilterData(to, idToUserId) }]);
    });

    it('sets the node the id stands for as the result', () => {
      const { graph, from, to } = forwarded();

      graph.setResult(from);

      expect(graph.result).toBe(to);
    });

    it('gives the readers, the inputs, the node and the columns read of the node the id stands for', () => {
      const { graph, from, to } = forwarded();
      graph.add(deletePosts(), { filter: [new FilterData(to, idToUserId)] });

      expect({
        readers: graph.readersOf(from),
        inputs: graph.inputsOf(from),
        node: graph.nodeAt(from),
        columns: graph.columnsReadFrom(from),
      }).toEqual({
        readers: graph.readersOf(to),
        inputs: graph.inputsOf(to),
        node: graph.nodeAt(to),
        columns: graph.columnsReadFrom(to),
      });
    });

    it('replaces the node the id stands for', () => {
      const { graph, from, to } = forwarded();
      const replacement = findUsers([], ['name']);

      graph.replace(from, replacement);

      expect(graph.nodeAt(to)).toBe(replacement);
    });

    it('follows a forwarded id to the last node it stands for', () => {
      const { graph, from, to } = forwarded();
      const last = graph.add(findUsers());

      graph.forward(to, last);
      graph.setResult(from);

      expect(graph.result).toBe(last);
    });

    it('gives each position its own node and inputs in entries', () => {
      const { graph, from } = forwarded();

      expect(graph.entries().find(({ id }) => id === from)).toEqual({
        id: from,
        node: graph.nodes().find(([id]) => id === from)?.[1],
        inputs: { filter: [], state: [], requires: [] },
      });
    });
  });

  describe('result', () => {
    it('names no node on a new graph', () => {
      expect(newGraph().result).toBeUndefined();
    });

    it('names the position it is given', () => {
      const graph = newGraph();
      const union = graph.add(new UnionAll());

      graph.setResult(union);

      expect(graph.result).toBe(union);
    });
  });
});
