import { float4Column, float8Column, int4Column } from '@internal/adapter-postgres/column-types';
import { defineContract, field, model } from '@internal/postgres/contract-builder';
import { describe, expect, it } from 'vitest';
import { timeouts, withPushedContractRuntime } from './integration-helpers';

const pgFloat = { codecId: 'pg/float@1', nativeType: 'float8' } as const;
const sqlFloat = { codecId: 'sql/float@1', nativeType: 'float8' } as const;

const Reading = model('Reading', {
  fields: {
    id: field.column(int4Column).id(),
    sqlUp: field.column(sqlFloat).column('sql_up').default(Number.POSITIVE_INFINITY),
    sqlDown: field.column(sqlFloat).column('sql_down').default(Number.NEGATIVE_INFINITY),
    sqlNaN: field.column(sqlFloat).column('sql_nan').default(Number.NaN),
    pgUp: field.column(pgFloat).column('pg_up').default(Number.POSITIVE_INFINITY),
    doubleDown: field.column(float8Column).column('double_down').default(Number.NEGATIVE_INFINITY),
    singleNaN: field.column(float4Column).column('single_nan').default(Number.NaN),
  },
}).sql({ table: 'float_default_readings' });

const contract = defineContract({ models: { Reading } });

describe('a NaN or infinite float default authored in TypeScript', () => {
  it(
    'is planned, applied, and read back from a row that takes the defaults',
    async () => {
      await withPushedContractRuntime(contract, async (runtime) => {
        await runtime.query('insert into float_default_readings (id) values (1)');
        const rows = await runtime.query(
          'select sql_up, sql_down, sql_nan, pg_up, double_down, single_nan from float_default_readings',
        );
        expect(rows).toEqual([
          {
            sql_up: Number.POSITIVE_INFINITY,
            sql_down: Number.NEGATIVE_INFINITY,
            sql_nan: Number.NaN,
            pg_up: Number.POSITIVE_INFINITY,
            double_down: Number.NEGATIVE_INFINITY,
            single_nan: Number.NaN,
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
