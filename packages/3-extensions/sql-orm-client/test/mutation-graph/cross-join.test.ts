import { describe, expect, it } from 'vitest';
import { CrossJoin } from '../../src/mutation-graph/cross-join';
import { recordingRun } from './statements';

describe('CrossJoin', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(new CrossJoin())).toBe(true);
  });

  it('makes one row from the first row of each side, side by side, without a statement', async () => {
    const run = recordingRun();

    const rows = await new CrossJoin().execute(
      {
        left: [{ id: 7, name: 'Ada', type: 'feature' }],
        right: [{ features__priority: 3 }],
      },
      run,
    );

    expect(rows).toEqual([{ id: 7, name: 'Ada', type: 'feature', features__priority: 3 }]);
    expect(run.queried).toEqual([]);
    expect(run.executed).toEqual([]);
  });

  it('gives no row when a side has no row', async () => {
    const join = new CrossJoin();
    const run = recordingRun();

    expect(await join.execute({ left: [], right: [{ features__priority: 3 }] }, run)).toEqual([]);
    expect(await join.execute({ left: [{ id: 7 }], right: [] }, run)).toEqual([]);
  });
});
