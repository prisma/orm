import { describe, expect, it } from 'vitest';
import { contract, plan, refusal, renameModel, schemaCollection } from './mongo-statement-fixtures';

/**
 * Statements in which leaving out statement k makes statement k+1 refused. Collection c<k> holds
 * P<k> and X<k>; statement k renames P<k> to X<k+1>. Once statement k-1 is left out, the origin's
 * X<k> pairs with the destination's X<k>, moves to d<k>, and splits c<k>.
 */
function chain(levels: number) {
  const indexes = Array.from({ length: levels }, (_, index) => index);
  const from = contract(
    'from',
    Object.fromEntries(
      indexes.flatMap((k) => [
        [`P${k}`, { collection: `c${k}`, fields: ['_id', `p${k}`] }],
        [`X${k}`, { collection: `c${k}`, fields: ['_id', `x${k}`] }],
      ]),
    ),
    Object.fromEntries(indexes.map((k) => [`c${k}`, {}])),
  );
  const to = contract(
    'to',
    Object.fromEntries(
      [...indexes, levels].map((k) => [
        `X${k}`,
        { collection: `d${k}`, fields: k === 0 ? ['_id', 'x0'] : ['_id', `p${k - 1}`] },
      ]),
    ),
    Object.fromEntries([...indexes, levels].map((k) => [`d${k}`, {}])),
  );
  return {
    from,
    to,
    schema: indexes.map((k) => schemaCollection(`c${k}`)),
    statements: indexes.map((k) => renameModel(`P${k}`, `X${k + 1}`)),
  };
}

describe('MongoMigrationPlanner, re-planning without the refused statements', () => {
  it('plans a chain of 12 refusals, each found only once the one before is left out, in well under a second', () => {
    const started = performance.now();
    const conflicts = refusal(plan(chain(12)));
    const elapsed = performance.now() - started;
    expect({ fast: elapsed < 1000, refusals: conflicts.length }).toEqual({
      fast: true,
      refusals: 12,
    });
  });
});
