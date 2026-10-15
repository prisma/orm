import { describe, expect, it } from 'vitest';
import { Assert } from '../../src/mutation-graph/assert';
import { recordingRun } from './statements';

const missing = new Error('the related row does not exist');

describe('Assert', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(new Assert(missing))).toBe(true);
  });

  it('throws the error it was made with when its input has no row', () => {
    expect(() => new Assert(missing).execute({ rows: [] }, recordingRun())).toThrow(missing);
  });

  it('gives no row and runs no statement when its input has a row', async () => {
    const run = recordingRun();

    expect(await new Assert(missing).execute({ rows: [{ id: 7 }] }, run)).toEqual([]);
    expect(run).toMatchObject({ queried: [], executed: [] });
  });
});
