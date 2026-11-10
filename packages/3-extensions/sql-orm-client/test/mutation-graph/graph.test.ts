import { describe, expect, it } from 'vitest';
import { CrossJoin } from '../../src/mutation-graph/cross-join';
import type { NodeId } from '../../src/mutation-graph/edge';
import { FilterData } from '../../src/mutation-graph/filter-data';
import type { Graph } from '../../src/mutation-graph/graph';
import { Insert } from '../../src/mutation-graph/insert';
import { PayloadData } from '../../src/mutation-graph/payload-data';
import { Requires } from '../../src/mutation-graph/requires';
import { Rows } from '../../src/mutation-graph/rows';
import { State, StateEdge } from '../../src/mutation-graph/state';
import { StatementNode } from '../../src/mutation-graph/statement-node';
import { UnionAll } from '../../src/mutation-graph/union-all';
import { printGraph } from './print-graph';
import {
  columnMappings,
  deletePosts,
  deleteUsers,
  findUsers,
  insertInto,
  newGraph,
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
      const user = graph.add(new Insert(insertInto('users', [{ name: 'Ada' }])));
      const find = graph.add(findUsers([], ['name']));

      graph.add(new Insert(insertInto('posts', [{ title: 'Hello' }])), {
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
  });

  describe('moveReaders', () => {
    it('points every edge that reads one node at another, in the slot it was in', () => {
      const graph = newGraph();
      const first = graph.add(findUsers());
      const second = graph.add(findUsers());
      const del = graph.add(deletePosts(), { filter: [new FilterData(first, idToUserId)] });
      const join = graph.add(new CrossJoin(), {
        left: new Rows(first, sameId),
        right: new Rows(second, sameId),
      });

      graph.moveReaders(first, second);

      expect(printGraph(graph)).toBe(
        [
          'n1 Find users',
          'n2 Find users',
          'n3 Delete posts <- FilterData n2 (id->user_id)',
          'n4 CrossJoin <- Rows n2, Rows n2',
          'result: none',
        ].join('\n'),
      );
      expect(graph.readersOf(first)).toEqual([]);
      expect(graph.readersOf(second)).toEqual([
        { reader: join, edge: new Rows(second, sameId) },
        { reader: del, edge: new FilterData(second, idToUserId) },
        { reader: join, edge: new Rows(second, sameId) },
      ]);
    });

    it('keeps the new values a FilterData edge gives and moves Requires edges', () => {
      const graph = newGraph();
      const first = graph.add(findUsers());
      const second = graph.add(findUsers());
      const update = graph.add(updateUsers({ name: 'Ada' }), {
        filter: [new FilterData(first, sameId, { id: 2 })],
        requires: [new Requires(first)],
      });

      graph.moveReaders(first, second);

      expect(graph.inputsOf(update)).toEqual({
        filter: [new FilterData(second, sameId, { id: 2 })],
        payload: [],
        state: [],
        requires: [new Requires(second)],
      });
    });

    it('makes the node the edges now read return the columns they read', () => {
      const graph = newGraph();
      const first = graph.add(findUsers([], ['id', 'email']));
      const second = graph.add(findUsers([], ['name']));
      graph.add(deletePosts(), {
        filter: [new FilterData(first, idToUserId), new FilterData(first, emailToTitle)],
      });

      graph.moveReaders(first, second);

      expect(returned(graph, second)).toEqual(['name', 'id', 'email']);
    });
  });

  describe('addFilterDataEdge', () => {
    it('puts a FilterData edge into the filter slot of the target, in the order they are added', () => {
      const graph = newGraph();
      const find = graph.add(findUsers([], ['id', 'email']));
      const del = graph.add(deletePosts());

      graph.addFilterDataEdge(find, del, idToUserId);
      graph.addFilterDataEdge(find, del, emailToTitle);

      expect(filterOf(graph, del)).toEqual([
        new FilterData(find, idToUserId),
        new FilterData(find, emailToTitle),
      ]);
    });

    it('makes the source return the columns the edge reads', () => {
      const graph = newGraph();
      const update = graph.add(updateUsers({ name: 'Ada' }));
      expect(returned(graph, update)).toEqual([]);

      graph.addFilterDataEdge(update, graph.add(deletePosts()), idToUserId);
      const del = graph.add(deletePosts());
      graph.addFilterDataEdge(update, del, emailToTitle);
      graph.addFilterDataEdge(update, del, idToUserId);

      expect(returned(graph, update)).toEqual(['id', 'email']);
    });

    it('leaves the inputs of the source as they were when it widens it', () => {
      const graph = newGraph();
      const find = graph.add(findUsers());
      const update = graph.add(updateUsers({ name: 'Ada' }));
      graph.addFilterDataEdge(find, update, sameId);

      graph.addFilterDataEdge(update, graph.add(deletePosts()), idToUserId);

      expect(filterOf(graph, update)).toEqual([new FilterData(find, sameId)]);
    });

    it('does not change what a node returns when a node with no edge is added after it', () => {
      const graph = newGraph();
      const update = graph.add(updateUsers({ name: 'Ada' }));

      graph.add(deleteUsers());

      expect(returned(graph, update)).toEqual([]);
    });
  });

  describe('addPayloadDataEdge', () => {
    it('puts a PayloadData edge into the payload slot of the target and widens the source', () => {
      const graph = newGraph();
      const user = graph.add(new Insert(insertInto('users', [{ name: 'Ada' }])));
      const post = graph.add(new Insert(insertInto('posts', [{ title: 'Hello' }])));

      graph.addPayloadDataEdge(user, post, idToUserId);

      expect(graph.inputsOf(post)['payload']).toEqual([new PayloadData(user, idToUserId)]);
      expect(returned(graph, user)).toEqual(['id']);
    });
  });

  describe('addRowsEdge', () => {
    it('puts a Rows edge into a list slot, in the order they are added', () => {
      const graph = newGraph();
      const first = graph.add(findUsers());
      const second = graph.add(findUsers());
      const union = graph.add(new UnionAll());

      graph.addRowsEdge(first, union, 'rows', sameId);
      graph.addRowsEdge(second, union, 'rows', sameId);

      expect(graph.inputsOf(union)).toEqual({
        rows: [new Rows(first, sameId), new Rows(second, sameId)],
      });
    });

    it('puts a Rows edge into a slot that holds one edge', () => {
      const graph = newGraph();
      const left = graph.add(findUsers());
      const right = graph.add(findUsers());
      const join = graph.add(new CrossJoin());

      graph.addRowsEdge(left, join, 'left', sameId);
      graph.addRowsEdge(right, join, 'right', sameId);

      expect(graph.inputsOf(join)).toEqual({
        left: new Rows(left, sameId),
        right: new Rows(right, sameId),
      });
    });

    it('widens a source that runs a statement and leaves one that runs none as it was', () => {
      const graph = newGraph();
      const find = graph.add(findUsers([], ['email']));
      const union = new UnionAll();
      const unionId = graph.add(union);

      graph.addRowsEdge(find, unionId, 'rows', sameId);
      graph.addFilterDataEdge(unionId, graph.add(updateUsers({ name: 'Ada' })), sameId);

      expect(graph.nodes().find(([id]) => id === unionId)?.[1]).toBe(union);
      expect(returned(graph, find)).toEqual(['email', 'id']);
    });
  });

  describe('addRequiresEdge', () => {
    it('puts a Requires edge into the requires slot and leaves what the source returns as it was', () => {
      const graph = newGraph();
      const find = graph.add(findUsers([], ['email']));
      const update = graph.add(updateUsers({ name: 'Ada' }));

      graph.addRequiresEdge(find, update);

      expect(graph.inputsOf(update)['requires']).toEqual([new Requires(find)]);
      expect(returned(graph, find)).toEqual(['email']);
      expect(graph.columnsReadFrom(find)).toEqual([]);
    });
  });

  describe('columnsReadFrom', () => {
    it('gives the columns every edge from the node reads, in the order the edges were added', () => {
      const graph = newGraph();
      const find = graph.add(findUsers());
      const union = graph.add(new UnionAll());

      graph.addFilterDataEdge(find, graph.add(deletePosts()), emailToTitle);
      graph.addRowsEdge(find, union, 'rows', sameId);

      expect(graph.columnsReadFrom(find).map((column) => column.alias)).toEqual(['email', 'id']);
      expect(graph.columnsReadFrom(union)).toEqual([]);
    });

    it('leaves out the columns of an edge whose reader was removed', () => {
      const graph = newGraph();
      const find = graph.add(findUsers());
      const removed = graph.add(new UnionAll());
      graph.addRowsEdge(find, removed, 'rows', emailToTitle);
      graph.addRowsEdge(find, graph.add(new UnionAll()), 'rows', sameId);

      graph.remove(removed);

      expect(graph.columnsReadFrom(find).map((column) => column.alias)).toEqual(['id']);
    });
  });

  describe('readersOf', () => {
    it('gives, for a position, each edge that reads from it with the position of its reader', () => {
      const graph = newGraph();
      const find = graph.add(findUsers());
      const update = graph.add(updateUsers({ name: 'Ada' }));
      const del = graph.add(deletePosts());
      graph.addFilterDataEdge(find, update, sameId);
      graph.addFilterDataEdge(find, del, idToUserId);

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
      const update = graph.add(updateUsers({ name: 'Ada' }, undefined, ['id']));
      graph.addFilterDataEdge(find, update, sameId);
      const del = graph.add(deletePosts());
      graph.addFilterDataEdge(update, del, idToUserId);
      const into = graph.inputsOf(update);
      const outOf = graph.readersOf(update);

      graph.replace(update, updateUsers({ name: 'Grace' }));

      expect(graph.inputsOf(update)).toBe(into);
      expect(graph.readersOf(update)).toBe(outOf);
    });
  });

  describe('remove', () => {
    it('empties the position, and nodes skips it and keeps the other positions', () => {
      const graph = newGraph();
      const first = new UnionAll();
      const third = new UnionAll();
      const firstId = graph.add(first);
      const second = graph.add(new UnionAll());
      const thirdId = graph.add(third);

      graph.remove(second);

      expect(graph.nodes()).toEqual([
        [firstId, first],
        [thirdId, third],
      ]);
      expect([firstId, thirdId]).toEqual([0, 2]);
    });

    it('takes the edges of a node that is both a source and a reader out of both sides', () => {
      const graph = newGraph();
      const find = graph.add(findUsers());
      const union = graph.add(new UnionAll());
      graph.addRowsEdge(find, union, 'rows', sameId);
      const other = graph.add(new UnionAll());
      graph.addRowsEdge(find, other, 'rows', idToUserId);
      graph.addRowsEdge(union, other, 'rows', sameId);

      graph.remove(union);

      expect(graph.inputsOf(union)).toEqual({});
      expect(graph.readersOf(union)).toEqual([]);
      expect(graph.readersOf(find)).toEqual([{ reader: other, edge: new Rows(find, idToUserId) }]);
      expect(graph.inputsOf(other)).toEqual({ rows: [new Rows(find, idToUserId)] });
    });

    it('keeps a slot that holds one edge when the source of that edge is removed', () => {
      const graph = newGraph();
      const left = graph.add(new UnionAll());
      const right = graph.add(new UnionAll());
      const join = graph.add(new CrossJoin());
      graph.addRowsEdge(left, join, 'left', sameId);
      graph.addRowsEdge(right, join, 'right', sameId);

      graph.remove(right);

      expect(graph.inputsOf(join)).toEqual({
        left: new Rows(left, sameId),
        right: new Rows(right, sameId),
      });
      expect(graph.readersOf(left)).toEqual([{ reader: join, edge: new Rows(left, sameId) }]);
    });

    it('gives the next node the next position, not the emptied one', () => {
      const graph = newGraph();
      const first = graph.add(new UnionAll());
      graph.remove(first);

      const next = graph.add(new UnionAll());

      expect(next).not.toBe(first);
      expect(graph.nodes().map(([id]) => id)).toEqual([next]);
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
