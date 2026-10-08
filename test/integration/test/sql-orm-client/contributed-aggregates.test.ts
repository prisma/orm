/**
 * A contributed aggregate operation, end to end against PostgreSQL.
 *
 * The unit and type suites prove the ORM surfaces derive from the contributed
 * vocabulary. This proves the round trip: a test-only extension contributes
 * two operations the SQL aggregate alphabet does not name — `bitOr`, whose
 * lowering hook builds PostgreSQL's `bit_or`, and `tally`, which answers a
 * call carrying no input — and the client plans, renders, executes, and
 * decodes both, at the top level and as an include reducer, without any name
 * in the client or the lane spelling either one.
 *
 * The values are chosen so the declared output codec is the only thing that
 * explains the result: `bit_or` over 2^53 and 3 is an integer no JS number
 * holds exactly, and the built-in `sum` over the same rows produces the same
 * digits under a different declared codec — a decimal string beside a bigint.
 */

import { int4Column, int8Column } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { defineContract, field, model, rel } from '@internal/postgres/contract-builder';
import { type AggregateSpec, Collection } from '@internal/sql-orm-client';
import type { SqlAggregateDescriptor } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import { AggregateExpr, FunctionCallExpr } from '@internal/sql-relational-core/ast';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type SqlRuntimeExtensionDescriptor,
} from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

/** 2^53 and a value in its low bits: their bitwise OR is exact only as a bigint. */
const WIDE_WEIGHT = 9007199254740992n;
const LOW_BITS = 3n;
const COMBINED_BITS = WIDE_WEIGHT | LOW_BITS;

/**
 * Two operations outside the closed SQL aggregate alphabet, each carrying the
 * lowering hook the registry demands of a novel name. `bitOr` names an
 * operation on the client while its hook names PostgreSQL's function, so the
 * hook is visibly what mediates between the two; `tally` claims the no-input
 * match, which is what gives it a zero-argument call.
 */
const contributedAggregateDescriptors: readonly SqlAggregateDescriptor[] = [
  {
    operation: 'bitOr',
    input: { kind: 'codec', codecId: 'pg/int8@1' },
    output: { kind: 'codec', codecId: 'pg/int8@1' },
    nullable: true,
    lower: ({ expr }) => FunctionCallExpr.of('bit_or', expr === undefined ? [] : [expr]),
  },
  {
    operation: 'tally',
    input: { kind: 'none' },
    output: { kind: 'codec', codecId: 'pg/int8@1' },
    nullable: false,
    emptyResultWire: '0',
    lower: () => new AggregateExpr('count', undefined),
  },
];

const contributedAggregates: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension',
  id: 'test/contributed-aggregates',
  version: '0.0.0',
  familyId: 'sql',
  targetId: 'postgres',
  types: { aggregateDescriptors: contributedAggregateDescriptors },
  codecs: () => [],
  create() {
    return { familyId: 'sql', targetId: 'postgres' };
  },
};

const Reading = model('Reading', {
  fields: {
    id: field.column(int4Column).id(),
    weight: field.column(int8Column).optional(),
  },
}).sql({ table: 'contributed_readings' });

const Sample = model('Sample', {
  fields: {
    id: field.column(int4Column).id(),
    readingId: field.column(int4Column).column('reading_id'),
    weight: field.column(int8Column).optional(),
  },
  relations: {
    reading: rel.belongsTo(Reading, { from: 'readingId', to: 'id' }),
  },
}).sql({ table: 'contributed_samples' });

const ReadingWithSamples = Reading.relations({
  samples: rel.hasMany(() => Sample, { by: 'readingId' }),
}).sql({ table: 'contributed_readings' });

const contract = defineContract({ models: { Reading: ReadingWithSamples, Sample } });
const context = createExecutionContext({
  contract,
  stack: createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    extensions: [contributedAggregates],
  }),
});

/** The same contract over a stack the extension is absent from — what the contributed operations are measured against. */
const targetOnlyContext = createExecutionContext({
  contract,
  stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
});

async function setupTables(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('drop table if exists contributed_samples');
  await runtime.query('drop table if exists contributed_readings');
  await runtime.query('create table contributed_readings (id integer primary key, weight bigint)');
  await runtime.query(`
    create table contributed_samples (
      id integer primary key,
      reading_id integer not null,
      weight bigint
    )
  `);
  await runtime.query('insert into contributed_readings (id, weight) values (1, $1::bigint)', [
    String(WIDE_WEIGHT),
  ]);
  await runtime.query('insert into contributed_readings (id, weight) values (2, $1::bigint)', [
    String(LOW_BITS),
  ]);
  // A reading with no samples, so an include reducer has an empty input set to
  // answer for.
  await runtime.query('insert into contributed_readings (id, weight) values (3, null)');
  await runtime.query(
    'insert into contributed_samples (id, reading_id, weight) values (1, 1, $1::bigint)',
    [String(WIDE_WEIGHT)],
  );
  await runtime.query(
    'insert into contributed_samples (id, reading_id, weight) values (2, 1, $1::bigint)',
    [String(LOW_BITS)],
  );
}

/** The contract is authored here, so its static aggregate map is unknown and the derived builder surface is empty; the contributed names dispatch dynamically. */
type DynamicAggregates = Record<string, (field?: string) => AggregateSpec[string]>;

function readingsCollection(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context }, 'Reading', { namespaceId: 'public' });
}

describe('integration/contributed aggregate operations', () => {
  it(
    'a contributed operation reaches the database and decodes through its declared codec',
    async () => {
      await withCollectionRuntime(
        async (runtime) => {
          await setupTables(runtime);
          runtime.resetExecutions();

          const stats = await readingsCollection(runtime).aggregate((aggregate) => {
            const dynamic = aggregate as DynamicAggregates;
            return {
              bits: dynamic['bitOr']!('weight'),
              rows: dynamic['tally']!(),
              total: dynamic['sumBigInt']!('weight'),
            };
          });

          // `bitOr` and `sumBigInt` fold the same rows to the same digits, and
          // both carry them exactly: the contributed operation declares
          // `pg/int8@1`, the target's lossless sum over a bigint declares
          // `pg/unboundedint@1`. `tally` counts rows, so the weightless third
          // reading counts too.
          expect(stats).toEqual({
            bits: COMBINED_BITS,
            rows: 3n,
            total: WIDE_WEIGHT + LOW_BITS,
          });
          expect(BigInt(Number(stats.bits))).not.toBe(COMBINED_BITS);

          // The hook's function is what reached SQL — the alphabet has no name
          // for it, and no lane or client source spells it out.
          expect(runtime.executions).toHaveLength(1);
          expect(runtime.executions[0]?.sql.toLowerCase()).toContain('bit_or(');
        },
        contract,
        [contributedAggregates],
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a contributed operation reduces an include, carried through the JSON envelope',
    async () => {
      await withCollectionRuntime(
        async (runtime) => {
          await setupTables(runtime);

          const reduceToBits = (related: unknown): unknown =>
            (related as DynamicAggregates)['bitOr']!('weight');
          const rows = await readingsCollection(runtime)
            .where((reading) => reading.id.eq(1))
            .select('id')
            .include('samples', (samples) => reduceToBits(samples) as never)
            .all();

          // The reducer's value crosses the boundary inside a JSON document,
          // where its declared codec's projection is what keeps it exact.
          expect(rows).toEqual([{ id: 1, samples: COMBINED_BITS }]);
        },
        contract,
        [contributedAggregates],
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'an empty input set answers per the declared row: null where nullable, the zero otherwise',
    async () => {
      await withCollectionRuntime(
        async (runtime) => {
          await setupTables(runtime);

          const overNoRows = await readingsCollection(runtime)
            .where((reading) => reading.id.eq(404))
            .aggregate((aggregate) => {
              const dynamic = aggregate as DynamicAggregates;
              return { bits: dynamic['bitOr']!('weight'), rows: dynamic['tally']!() };
            });

          expect(overNoRows).toEqual({ bits: null, rows: 0n });

          const reduceToTally = (related: unknown): unknown =>
            (related as DynamicAggregates)['tally']!();
          const rows = await readingsCollection(runtime)
            .where((reading) => reading.id.eq(3))
            .select('id')
            .include('samples', (samples) => reduceToTally(samples) as never)
            .all();

          expect(rows).toEqual([{ id: 3, samples: 0n }]);
        },
        contract,
        [contributedAggregates],
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'the same query against a stack without the extension has no such operation',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupTables(runtime);

        const readings = new Collection({ runtime, context: targetOnlyContext }, 'Reading', {
          namespaceId: 'public',
        });
        const stats = await readings.aggregate((aggregate) => {
          const dynamic = aggregate as DynamicAggregates & Record<string, unknown>;
          expect(dynamic['bitOr']).toBeUndefined();
          expect(dynamic['tally']).toBeUndefined();
          return { total: dynamic['sumBigInt']!('weight') };
        });

        expect(stats).toEqual({ total: WIDE_WEIGHT + LOW_BITS });
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );
});
