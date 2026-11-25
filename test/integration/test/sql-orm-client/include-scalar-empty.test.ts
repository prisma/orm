import { int4Column } from '@internal/adapter-postgres/column-types';
import { defineContract, field, model, rel } from '@internal/postgres/contract-builder';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { type IncludeStrategy, includeStrategies, postgresAdapterFor } from './helpers';
import {
  expectPerRelationStatements,
  timeouts,
  withPushedContractRuntime,
} from './integration-helpers';

const OwnerBase = model('Owner', {
  fields: { id: field.column(int4Column).id() },
}).sql({ table: 'score_owners' });

const Score = model('Score', {
  fields: {
    id: field.column(int4Column).id(),
    ownerId: field.column(int4Column).column('owner_id'),
    points: field.column(int4Column).optional(),
  },
  relations: { owner: rel.belongsTo(OwnerBase, { from: 'ownerId', to: 'id' }) },
}).sql({ table: 'scores' });

const Owner = OwnerBase.relations({
  scores: rel.hasMany(() => Score, { by: 'ownerId' }),
}).sql({ table: 'score_owners' });

const contract = defineContract({ version: 18, models: { Owner, Score } });

function ownersOf(
  runtime: Parameters<Parameters<typeof withPushedContractRuntime>[1]>[0],
  strategy: IncludeStrategy,
) {
  const context = createExecutionContext({
    contract,
    stack: createSqlExecutionStack({
      target: postgresTarget,
      adapter: postgresAdapterFor(strategy),
    }),
  });
  return new Collection({ runtime, context }, 'Owner', { namespaceId: 'public' });
}

describe.each(includeStrategies)(
  'scalar includes over no rows and over NULL values (%s)',
  (strategy) => {
    it(
      'give the empty aggregate result for a parent without children and for an all-NULL column',
      async () => {
        await withPushedContractRuntime(contract, async (runtime) => {
          await runtime.query('insert into score_owners (id) values (1), (2), (3)');
          await runtime.query(
            'insert into scores (id, owner_id, points) values (10, 1, null), (11, 1, null), (12, 3, 2), (13, 3, 4)',
          );

          runtime.resetExecutions();
          const rows = await ownersOf(runtime, strategy)
            .orderBy((owner) => owner.id.asc())
            .include('scores', (scores) =>
              scores.combine({
                count: scores.count(),
                sum: scores.sum('points'),
                avg: scores.avg('points'),
                min: scores.min('points'),
                max: scores.max('points'),
              }),
            )
            .all();
          expectPerRelationStatements(runtime, strategy, 6);

          expect(rows).toEqual([
            { id: 1, scores: { count: 2, sum: null, avg: null, min: null, max: null } },
            { id: 2, scores: { count: 0, sum: null, avg: null, min: null, max: null } },
            { id: 3, scores: { count: 2, sum: 6, avg: 3, min: 2, max: 4 } },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  },
);
