import { float4Column, float8Column, int4Column } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import {
  defineContract,
  field,
  model,
  postgres18,
  postgresDriver,
  rel,
} from '@internal/postgres/contract-builder';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { type IncludeStrategy, includeStrategies, withIncludeStrategy } from './helpers';
import {
  expectPerRelationStatements,
  timeouts,
  withPushedContractRuntime,
} from './integration-helpers';

const pgFloat = { codecId: 'pg/float@1' } as const;
const sqlFloat = { codecId: 'sql/float@1' } as const;

const PointBase = model('Point', {
  fields: {
    id: field.column(int4Column).id(),
    seriesId: field.column(int4Column).column('series_id'),
    double: field.column(float8Column),
    single: field.column(float4Column),
    pgFloat: field.column(pgFloat).column('pg_float'),
    sqlFloat: field.column(sqlFloat).column('sql_float'),
  },
}).sql({ table: 'float_points' });

const Series = model('Series', {
  fields: { id: field.column(int4Column).id() },
  relations: { points: rel.hasMany(() => PointBase, { by: 'seriesId' }) },
}).sql({ table: 'float_series' });

const contract = defineContract({
  requiredCapabilities: [...postgres18, ...postgresDriver],
  models: { Series, Point: PointBase },
});
function contextOf(strategy: IncludeStrategy) {
  return createExecutionContext({
    contract: withIncludeStrategy(contract, strategy),
    stack: createSqlExecutionStack({
      target: postgresTarget,
      adapter: postgresAdapter,
    }),
  });
}

describe.each(includeStrategies)(
  'a float column holding NaN or an infinity, read through a relation include (%s)',
  (strategy) => {
    const context = contextOf(strategy);
    it(
      'comes back as NaN, Infinity and -Infinity for every float codec',
      async () => {
        await withPushedContractRuntime(contract, async (runtime) => {
          await runtime.query(`
          insert into float_series (id) values (1);
          insert into float_points (id, series_id, double, single, pg_float, sql_float) values
            (1, 1, 'NaN', 'NaN', 'NaN', 'NaN'),
            (2, 1, 'Infinity', 'Infinity', 'Infinity', 'Infinity'),
            (3, 1, '-Infinity', '-Infinity', '-Infinity', '-Infinity'),
            (4, 1, 1.5, 1.5, 1.5, 1.5);
        `);
          const series = new Collection({ runtime, context }, 'Series', { namespaceId: 'public' });

          runtime.resetExecutions();
          const rows = await series
            .select('id')
            .include('points', (point) =>
              point
                .select('id', 'double', 'single', 'pgFloat', 'sqlFloat')
                .orderBy((p) => p['id']!.asc()),
            )
            .all();
          expectPerRelationStatements(runtime, strategy, 2);

          const same = (value: number) => ({
            double: value,
            single: value,
            pgFloat: value,
            sqlFloat: value,
          });
          expect(rows).toEqual([
            {
              id: 1,
              points: [
                { id: 1, ...same(Number.NaN) },
                { id: 2, ...same(Number.POSITIVE_INFINITY) },
                { id: 3, ...same(Number.NEGATIVE_INFINITY) },
                { id: 4, ...same(1.5) },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  },
);
