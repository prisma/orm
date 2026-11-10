import { ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { InsertChunked } from '../../src/mutation-graph/insert-chunked';
import { columnsOf, insertInto, recordingRun } from './statements';

const first = insertInto('users', [{ name: 'Ada' }, { name: 'Grace' }], ['id']);
const second = insertInto('users', [{ name: 'Edsger', email: 'e@d.nl' }], ['id']);
const invitedBy7 = { invited_by_id: ParamRef.of(7, { name: 'invited_by_id' }) };

describe('InsertChunked', () => {
  it('holds its statements as SQL AST and is frozen', () => {
    const chunked = new InsertChunked([first, second]);

    expect(chunked.asts).toEqual([first, second]);
    expect(Object.isFrozen(chunked)).toBe(true);
    expect(Object.isFrozen(chunked.asts)).toBe(true);
  });

  it('runs its statements in order and gives their rows one statement after another', async () => {
    const run = recordingRun([{ id: 1 }]);

    const rows = await new InsertChunked([first, second]).execute(
      { payload: null, state: null, requires: null },
      run,
    );

    expect(rows).toEqual([{ id: 1 }, { id: 1 }]);
    expect(run.queried).toEqual([first, second]);
  });

  it('gives the sum of the affected row counts when its statements return no column', async () => {
    const run = recordingRun([], 2);
    const counted = new InsertChunked([
      insertInto('users', [{ name: 'Ada' }]),
      insertInto('users', [{ name: 'Grace', email: 'g@h.io' }]),
    ]);

    expect(await counted.execute({ payload: null, state: null, requires: null }, run)).toEqual({
      affectedRows: 4,
    });
    expect(run.executed).toEqual(counted.asts);
    expect(run.queried).toEqual([]);
  });

  it('gives a node whose every statement also returns the columns it is asked for', () => {
    const widened = new InsertChunked([first, second]).withReturning(columnsOf('users', ['email']));

    expect(widened).toBeInstanceOf(InsertChunked);
    expect(widened.returns.map((column) => column.alias)).toEqual(['id', 'email']);
    expect(widened.asts.map((ast) => (ast.returning ?? []).map((column) => column.alias))).toEqual([
      ['id', 'email'],
      ['id', 'email'],
    ]);
  });

  it('adds the record of each edge to every row of every statement', async () => {
    const run = recordingRun();
    const viewsOfEdge = { views: ParamRef.of(3, { name: 'views' }) };

    await new InsertChunked([first, second]).execute(
      { payload: [[invitedBy7], [viewsOfEdge]], state: null, requires: null },
      run,
    );

    expect(run.queried).toMatchObject([
      {
        kind: 'insert',
        rows: [
          { name: { value: 'Ada' }, invited_by_id: { value: 7 }, views: { value: 3 } },
          { name: { value: 'Grace' }, invited_by_id: { value: 7 }, views: { value: 3 } },
        ],
      },
      {
        kind: 'insert',
        rows: [
          {
            name: { value: 'Edsger' },
            email: { value: 'e@d.nl' },
            invited_by_id: { value: 7 },
            views: { value: 3 },
          },
        ],
      },
    ]);
  });

  it('returns no rows and runs nothing when an edge has no source row', async () => {
    const run = recordingRun([{ id: 1 }]);

    expect(
      await new InsertChunked([first, second]).execute(
        { payload: [[invitedBy7], []], state: null, requires: null },
        run,
      ),
    ).toEqual([]);
    expect(run).toMatchObject({ queried: [], executed: [] });
  });

  it('refuses two edges that give one column of a junction different values, before running', () => {
    const chunked = new InsertChunked([first, second], { relation: 'tags', junction: 'post_tags' });
    const run = recordingRun();
    const invitedBy8 = { invited_by_id: ParamRef.of(8, { name: 'invited_by_id' }) };

    expect(() =>
      chunked.execute({ payload: [[invitedBy7], [invitedBy8]], state: null, requires: null }, run),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.RELATION_MUTATION_INVALID',
        meta: { relation: 'tags', junction: 'post_tags', column: 'invited_by_id' },
      }),
    );
    expect(run).toMatchObject({ queried: [], executed: [] });
  });

  it('keeps its junction when asked to return more columns', () => {
    const junction = { relation: 'tags', junction: 'post_tags' };

    expect(
      new InsertChunked([first], junction).withReturning(columnsOf('users', ['email'])),
    ).toMatchObject({
      junction,
    });
  });
});
