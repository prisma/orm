import { describe, expect, it, vi } from 'vitest';
import type * as StatementPlanning from '../src/core/migrations/mongo-statement-planning';
import { planStatements } from '../src/core/migrations/mongo-statement-planning';
import { contract, plan, refusal, renameModel, schemaCollection } from './mongo-statement-fixtures';

vi.mock('../src/core/migrations/mongo-statement-planning', async (importOriginal) => {
  const original = await importOriginal<typeof StatementPlanning>();
  return { ...original, planStatements: vi.fn(original.planStatements) };
});

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
});
