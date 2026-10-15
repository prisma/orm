import { describe, it } from 'vitest';
import { CrossJoin } from '../../src/mutation-graph/cross-join';
import { Insert } from '../../src/mutation-graph/insert';
import { UnionAll } from '../../src/mutation-graph/union-all';
import { columnPairs, findUsers, insertInto, newGraph } from './statements';

const sameId = columnPairs('users', 'users', [['id', 'id']]);

describe('graph edge methods', () => {
  it('take only a target that has the slot the edge goes into', () => {
    const graph = newGraph();
    const find = graph.add(findUsers());
    const insert = graph.add(new Insert(insertInto('users', [{ name: 'Ada' }])));
    const join = graph.add(new CrossJoin());
    const union = graph.add(new UnionAll());

    graph.addFilterDataEdge(find, find, sameId);
    graph.addPayloadDataEdge(find, insert, sameId);
    graph.addRowsEdge(find, join, 'left', sameId);
    graph.addRowsEdge(find, union, 'rows', sameId);

    // @ts-expect-error an Insert has no filter slot
    graph.addFilterDataEdge(find, insert, sameId);
    // @ts-expect-error a Find has no payload slot
    graph.addPayloadDataEdge(find, find, sameId);
    // @ts-expect-error a CrossJoin has no rows slot
    graph.addRowsEdge(find, join, 'rows', sameId);
    // @ts-expect-error a Find has no slot for Rows edges
    graph.addRowsEdge(find, find, 'filter', sameId);
  });
});
