import { describe, expect, it } from 'vitest';
import { Assert } from '../../src/mutation-graph/assert';
import { recordingRun } from './statements';

const missing = new Error('the related row does not exist');

describe('Assert', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(new Assert(missing))).toBe(true);
  });

  it('throws the error it was made with when its input has no row', () => {
    expect(() => new Assert(missing).execute({ rows: [], requires: null }, recordingRun())).toThrow(
      missing,
    );
  });

  it('gives no row and runs no statement when its input has a row', async () => {
    const run = recordingRun();

    expect(await new Assert(missing).execute({ rows: [{ id: 7 }], requires: null }, run)).toEqual(
      [],
    );
    expect(run).toMatchObject({ queried: [], executed: [] });
  });

  it('gives no row and does not throw when a node it requires produced no row', async () => {
    const run = recordingRun();

    expect(await new Assert(missing).execute({ rows: [], requires: [[]] }, run)).toEqual([]);
  });

  it('throws when every node it requires produced a row and its input has none', () => {
    expect(() =>
      new Assert(missing).execute({ rows: [], requires: [[undefined]] }, recordingRun()),
    ).toThrow(missing);
  });
});
