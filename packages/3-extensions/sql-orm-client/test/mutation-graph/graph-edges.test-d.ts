import { describe, it } from 'vitest';
import { CrossJoin } from '../../src/mutation-graph/cross-join';
import { FilterData } from '../../src/mutation-graph/filter-data';
import { Insert } from '../../src/mutation-graph/insert';
import { PayloadData } from '../../src/mutation-graph/payload-data';
import { Requires } from '../../src/mutation-graph/requires';
import { Rows } from '../../src/mutation-graph/rows';
import { StateEdge } from '../../src/mutation-graph/state';
import { UnionAll } from '../../src/mutation-graph/union-all';
import { columnMappings, findUsers, insertInto, newGraph } from './statements';

const sameId = columnMappings('users', 'users', [['id', 'id']]);

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
    graph.addRequiresEdge(find, insert);
    // @ts-expect-error a CrossJoin has no requires slot
    graph.addRequiresEdge(find, join);
  });

  it('add takes only edges of the kind each slot of the node holds', () => {
    const graph = newGraph();
    const find = graph.add(findUsers());
    const users = { namespaceId: 'public', tableName: 'users' };

    graph.add(findUsers(), { filter: [new FilterData(find, sameId)] });
    graph.add(new Insert(insertInto('users', [{ name: 'Ada' }])), {
      payload: [new PayloadData(find, sameId)],
    });
    graph.add(new CrossJoin(), { left: new Rows(find, sameId) });

    // @ts-expect-error a Find has no payload slot
    graph.add(findUsers(), { payload: [new PayloadData(find, sameId)] });
    // @ts-expect-error the filter slot of a Find holds FilterData edges
    graph.add(findUsers(), { filter: [new Rows(find, sameId)] });
    graph.add(findUsers(), { state: [new StateEdge(find, users)] });
    // @ts-expect-error the state slot of a Find holds StateEdge edges
    graph.add(findUsers(), { state: [new Requires(find)] });
  });
});
