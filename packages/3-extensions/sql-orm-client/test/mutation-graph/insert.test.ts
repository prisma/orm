import { ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Insert } from '../../src/mutation-graph/insert';
import { columnsOf, insertInto, recordingRun } from './statements';

const userIdOf7 = { user_id: ParamRef.of(7, { name: 'user_id' }) };

describe('Insert', () => {
  it('holds its statement as SQL AST and is frozen', () => {
    const ast = insertInto('posts', [{ title: 'Hello' }]);
    const insert = new Insert(ast);

    expect(insert.ast).toBe(ast);
    expect(Object.isFrozen(insert)).toBe(true);
  });

  it('runs its statement as it is when the payload slot has no edge', async () => {
    const insert = new Insert(insertInto('posts', [{ title: 'Hello' }], ['id']));
    const run = recordingRun([{ id: 1 }]);

    expect(await insert.execute({ payload: null }, run)).toEqual([{ id: 1 }]);
    expect(run.queried).toEqual([insert.ast]);
  });

  it('adds the record of each edge to its row', async () => {
    const insert = new Insert(insertInto('posts', [{ title: 'Hello' }], ['id']));
    const run = recordingRun();
    const titleOfEdge = { views: ParamRef.of(3, { name: 'views' }) };

    await insert.execute({ payload: [[userIdOf7], [titleOfEdge]] }, run);

    expect(run.queried).toHaveLength(1);
    expect(run.queried[0]).toMatchObject({
      kind: 'insert',
      rows: [
        {
          title: { value: 'Hello' },
          user_id: { value: 7 },
          views: { value: 3 },
        },
      ],
    });
  });

  it('returns no rows and runs nothing when an edge has no source row', async () => {
    const insert = new Insert(insertInto('posts', [{ title: 'Hello' }], ['id']));
    const run = recordingRun([{ id: 1 }]);

    expect(await insert.execute({ payload: [[userIdOf7], []] }, run)).toEqual([]);
    expect(run.queried).toEqual([]);
    expect(run.executed).toEqual([]);
  });

  it('gives the affected row count when its statement returns no column', async () => {
    const insert = new Insert(insertInto('posts', [{ title: 'a' }, { title: 'b' }]));
    const run = recordingRun([], 2);

    expect(await insert.execute({ payload: null }, run)).toEqual({ affectedRows: 2 });
    expect(run.executed).toEqual([insert.ast]);
  });

  it('gives a node that also returns the columns it is asked for, once each', () => {
    const insert = new Insert(insertInto('users', [{ name: 'Ada' }], ['id']));

    const widened = insert.withReturning(columnsOf('users', ['email', 'id']));

    expect(widened).toBeInstanceOf(Insert);
    expect(widened.returns.map((column) => column.alias)).toEqual(['id', 'email']);
  });
});
