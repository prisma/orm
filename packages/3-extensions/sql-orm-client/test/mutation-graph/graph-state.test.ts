import {
  ColumnRef,
  DeleteAst,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Delete } from '../../src/mutation-graph/delete';
import { Find } from '../../src/mutation-graph/find';
import { Graph } from '../../src/mutation-graph/graph';
import { Insert } from '../../src/mutation-graph/insert';
import { State, StateEdge } from '../../src/mutation-graph/state';
import { UnionAll } from '../../src/mutation-graph/union-all';
import { createCollectionFor } from '../collection-fixtures';
import { cascadeContract } from './cascade-contract';
import { printGraph } from './print-graph';
import {
  addFiltered,
  columnPairs,
  findUsers,
  findUsersWith,
  insertInto,
  newGraph,
  recordingRun,
  updateUsers,
} from './statements';

const users = { namespaceId: 'public', name: 'users' };
const posts = { namespaceId: 'public', name: 'posts' };
const sameId = columnPairs('users', 'users', [['id', 'id']]);
const withState = { state: true };

function cascadeTable(name: string): TableSource {
  return TableSource.named(name, undefined, 'public');
}

function findIn(name: string): Find {
  return new Find(
    SelectAst.from(cascadeTable(name)).withProjection([
      ProjectionItem.of('id', ColumnRef.of(name, 'id')),
    ]),
  );
}

describe('table state in the graph', () => {
  it('adds the first State of a table in front of the first node that reads it', () => {
    const graph = newGraph();
    graph.setResult(graph.add(findUsers()));

    expect(printGraph(graph, withState)).toBe(
      ['n1 State users', 'n2 Find users <- state n1', 'result: n2'].join('\n'),
    );
  });

  it('gives a node one state edge for each table its statement reads', () => {
    const { includes, tables } = createCollectionFor('User').collection.include('posts').state;
    const graph = newGraph();
    graph.add(findUsersWith({ includes, tables }));

    expect(printGraph(graph, withState)).toBe(
      [
        'n1 State users',
        'n2 State posts',
        'n3 Find users <- state n1, state n2',
        'result: none',
      ].join('\n'),
    );
  });

  it('adds a new State of the table a write changes, which later readers read', () => {
    const graph = newGraph();
    const find = graph.add(findUsers());
    addFiltered(graph, updateUsers({ name: 'Ada' }), [find, sameId]);
    graph.add(findUsers());

    expect(printGraph(graph, withState)).toBe(
      [
        'n1 State users',
        'n2 Find users <- state n1',
        "n3 Update users set name = 'Ada' <- FilterData n2 (id->id), state n1",
        'n4 State users <- state n3',
        'n5 Find users <- state n4',
        'result: none',
      ].join('\n'),
    );
  });

  it('adds a State only for the target of an insert', () => {
    const graph = newGraph();
    graph.add(new Insert(insertInto('posts', [{ title: 'Hello' }])));

    expect(printGraph(graph, withState)).toBe(
      [
        'n1 State posts',
        'n2 Insert posts <- state n1',
        'n3 State posts <- state n2',
        'result: none',
      ].join('\n'),
    );
  });

  it('adds a State for every table a delete changes through its foreign keys', () => {
    const graph = new Graph(cascadeContract);
    const find = graph.add(findIn('Org'));
    const del = graph.add(new Delete(DeleteAst.from(cascadeTable('Org'))));
    const orgId = ProjectionItem.of('id', ColumnRef.of('Org', 'id'));
    graph.addFilterDataEdge(find, del, [[orgId, orgId]]);
    graph.setResult(del);
    graph.add(findIn('Member'));

    expect(printGraph(graph, withState)).toBe(
      [
        'n1 State Org',
        'n2 Find Org <- state n1',
        'n3 Delete Org <- FilterData n2 (id->id), state n1',
        'n4 State Org <- state n3',
        'n5 State Team <- state n3',
        'n6 State Member <- state n3',
        'n7 State Badge <- state n3',
        'n8 Find Member <- state n6',
        'result: n3',
      ].join('\n'),
    );
  });

  it('adds no state to a node that runs no statement', () => {
    const graph = newGraph();
    const union = graph.add(new UnionAll());

    expect(graph.inputsOf(union)).toEqual({ rows: [] });
    expect(graph.nodes()).toHaveLength(1);
  });

  it('prints the graph without state by default', () => {
    const graph = newGraph();
    const find = graph.add(findUsers());
    graph.setResult(addFiltered(graph, updateUsers({ name: 'Ada' }), [find, sameId]));

    expect(printGraph(graph)).toBe(
      [
        'n1 Find users',
        "n2 Update users set name = 'Ada' <- FilterData n1 (id->id)",
        'result: n2',
      ].join('\n'),
    );
  });
});

describe('sameState', () => {
  it('holds for two reads of a table that nothing wrote in between', () => {
    const graph = newGraph();
    const first = graph.add(findUsers());
    const second = graph.add(findUsers());

    expect(graph.sameState(first, second, users)).toBe(true);
  });

  it('does not hold across a write to the table', () => {
    const graph = newGraph();
    const first = graph.add(findUsers());
    graph.add(updateUsers({ name: 'Ada' }));
    const second = graph.add(findUsers());

    expect(graph.sameState(first, second, users)).toBe(false);
  });

  it('holds for a table the write in between did not change', () => {
    const graph = newGraph();
    const first = graph.add(findUsers());
    graph.add(new Insert(insertInto('posts', [{ title: 'b' }])));
    const second = graph.add(findUsers());

    expect(graph.sameState(first, second, users)).toBe(true);
  });

  it('does not hold when a node does not read the table', () => {
    const graph = newGraph();
    const read = graph.add(findUsers());
    const insert = graph.add(new Insert(insertInto('posts', [{ title: 'a' }])));

    expect(graph.sameState(read, insert, posts)).toBe(false);
    expect(graph.sameState(read, insert, users)).toBe(false);
  });
});

describe('State', () => {
  it('runs no statement and gives no row', async () => {
    const run = recordingRun();

    expect(await new State(users).execute({ write: null }, run)).toEqual([]);
    expect(await new State(users).execute({ write: [[undefined]] }, run)).toEqual([]);
    expect(run).toMatchObject({ queried: [], executed: [] });
  });

  it('is frozen, and so is its edge', () => {
    expect(Object.isFrozen(new State(users))).toBe(true);
    expect(Object.isFrozen(new StateEdge(newGraph().add(new UnionAll()), users))).toBe(true);
  });
});
