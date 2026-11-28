import { describe, expect, it, vi } from 'vitest';
import type * as StatementPlanning from '../src/core/migrations/mongo-statement-planning';
import { planStatements } from '../src/core/migrations/mongo-statement-planning';
import { contract, plan, refusal, renameModel, schemaCollection } from './mongo-statement-fixtures';

vi.mock('../src/core/migrations/mongo-statement-planning', async (importOriginal) => {
  const original = await importOriginal<typeof StatementPlanning>();
  return { ...original, planStatements: vi.fn(original.planStatements) };
});

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

describe('MongoMigrationPlanner, the plan without the statements of a route', () => {
  it('is made once for all the refusals that share the route', () => {
    const groups = Array.from({ length: 8 }, (_, index) => index);
    const models = (side: 'from' | 'to') =>
      Object.fromEntries(
        groups.flatMap((index) => [
          [`Stay${index}`, { collection: `shared${index}`, fields: ['_id', `stay${index}`] }],
          side === 'from'
            ? [`Go${index}`, { collection: `shared${index}`, fields: ['_id', `go${index}`] }]
            : [`Gone${index}`, { collection: `moved${index}`, fields: ['_id', `go${index}`] }],
        ]),
      );
    const collections = (side: 'from' | 'to') =>
      Object.fromEntries(
        groups.flatMap((index) => [
          [`shared${index}`, {}],
          ...(side === 'to' ? [[`moved${index}`, {}]] : []),
        ]),
      );
    const from = contract('from', models('from'), collections('from'));
    const to = contract('to', models('to'), collections('to'));
    const schema = groups.map((index) => schemaCollection(`shared${index}`));
    const statements = groups.map((index) => renameModel(`Go${index}`, `Gone${index}`));
    vi.mocked(planStatements).mockClear();
    const conflicts = refusal(plan({ from, to, schema, statements }));
    expect({
      statementPlans: vi.mocked(planStatements).mock.calls.length,
      moves: conflicts.map(({ why }) => (why ?? '').split('rawAggregate(').length - 1),
    }).toEqual({ statementPlans: 2, moves: [8, 0, 0, 0, 0, 0, 0, 0] });
  });

  it('plans a chain of 12 refusals, each found only once the one before is left out, without the statements once per level', async () => {
    const { planStatements: original } = await vi.importActual<typeof StatementPlanning>(
      '../src/core/migrations/mongo-statement-planning',
    );
    const limit = 100;
    vi.mocked(planStatements).mockClear();
    vi.mocked(planStatements).mockImplementation((input) => {
      if (vi.mocked(planStatements).mock.calls.length > limit) {
        throw new Error(`more than ${limit} statement plans`);
      }
      return original(input);
    });
    try {
      const conflicts = refusal(plan(chain(12)));
      expect({
        refusals: conflicts.length,
        statementPlans: vi.mocked(planStatements).mock.calls.length,
      }).toEqual({ refusals: 12, statementPlans: 13 });
    } finally {
      vi.mocked(planStatements).mockImplementation(original);
    }
  });
});
