import { describe, expect, it } from 'vitest';
import { UnionAll } from '../../src/mutation-graph/union-all';
import { recordingRun } from './statements';

describe('UnionAll', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(new UnionAll())).toBe(true);
  });

  it('gives all rows of its inputs, one input after another, without a statement', async () => {
    const run = recordingRun();

    const rows = await new UnionAll().execute(
      { rows: [[{ id: 1 }, { id: 2 }], [], [{ id: 3 }]] },
      run,
    );

    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(run.queried).toEqual([]);
    expect(run.executed).toEqual([]);
  });

  it('gives no row when the slot has no edge', async () => {
    expect(await new UnionAll().execute({ rows: null }, recordingRun())).toEqual([]);
  });
});
