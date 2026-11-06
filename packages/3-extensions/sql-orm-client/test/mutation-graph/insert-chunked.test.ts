import { describe, expect, it } from 'vitest';
import { InsertChunked } from '../../src/mutation-graph/insert-chunked';
import { columnsOf, insertInto, recordingRun } from './statements';

const first = insertInto('users', [{ name: 'Ada' }, { name: 'Grace' }], ['id']);
const second = insertInto('users', [{ name: 'Edsger', email: 'e@d.nl' }], ['id']);

describe('InsertChunked', () => {
  it('holds its statements as SQL AST and is frozen', () => {
    const chunked = new InsertChunked([first, second]);

    expect(chunked.asts).toEqual([first, second]);
    expect(Object.isFrozen(chunked)).toBe(true);
    expect(Object.isFrozen(chunked.asts)).toBe(true);
  });

  it('runs its statements in order and gives their rows one statement after another', async () => {
    const run = recordingRun([{ id: 1 }]);

    const rows = await new InsertChunked([first, second]).execute({}, run);

    expect(rows).toEqual([{ id: 1 }, { id: 1 }]);
    expect(run.queried).toEqual([first, second]);
  });

  it('gives the sum of the affected row counts when its statements return no column', async () => {
    const run = recordingRun([], 2);
    const counted = new InsertChunked([
      insertInto('users', [{ name: 'Ada' }]),
      insertInto('users', [{ name: 'Grace', email: 'g@h.io' }]),
    ]);

    expect(await counted.execute({}, run)).toEqual({ affectedRows: 4 });
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
});
