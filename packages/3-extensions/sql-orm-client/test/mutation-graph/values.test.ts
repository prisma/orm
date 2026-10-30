import { describe, expect, it } from 'vitest';
import { Values } from '../../src/mutation-graph/values';
import { recordingRun } from './statements';

describe('Values', () => {
  it('gives the rows it was built with and runs nothing', async () => {
    const run = recordingRun();
    const values = new Values([{ email: 'ada@example.com' }]);

    expect(await values.execute({}, run)).toEqual([{ email: 'ada@example.com' }]);
    expect({
      queried: run.queried,
      executed: run.executed,
      frozen: Object.isFrozen(values),
    }).toEqual({ queried: [], executed: [], frozen: true });
  });
});
