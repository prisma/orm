import {
  byteaColumn,
  int4Column,
  int8Column,
  intervalColumn,
  numericColumn,
} from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { vector } from '@internal/extension-pgvector/column-types';
import pgvector from '@internal/extension-pgvector/pack';
import pgvectorRuntime from '@internal/extension-pgvector/runtime';
import { defineContract, field, model, rel } from '@internal/postgres/contract-builder';
import { type AggregateSpec, Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

/**
 * The values a codec's JSON projection has to survive, chosen at the
 * boundaries rather than in the middle:
 *
 * - `DOD_NUMERIC` and `DOD_WIDE_INTEGER` are the two values this project was
 *   opened for. `json_build_object` renders a `numeric` through a double and
 *   loses them; the projection renders it through its own text form.
 * - `WIDE_BYTEA` is 80 bytes, past the 57 at which PostgreSQL's `encode`
 *   wraps base64 output — the defect a three-byte case would have missed.
 * - The interval carries every field, including a fractional second, and
 *   months past a year that the ISO rendering normalises but the value keeps.
 */
const DOD_NUMERIC = '1234567890.12345678901234567890';
const DOD_WIDE_INTEGER = '9007199254740993';
const WIDE_BYTEA = Uint8Array.from({ length: 80 }, (_, index) => index);
// Elements that a float4 holds exactly, so any difference on the way back is
// the projection's and not the storage type's rounding.
const VECTOR = [0.5, -0.25, 1.5];

const Reading = model('Reading', {
  fields: {
    id: field.column(int4Column).id(),
    amount: field.column(numericColumn(38, 20)).optional(),
    padded: field.column(numericColumn(10, 2)).optional(),
    counter: field.column(int8Column).optional(),
    payload: field.column(byteaColumn).optional(),
    elapsed: field.column(intervalColumn()).optional(),
    embedding: field.column(vector(3)).optional(),
  },
}).sql({ table: 'canonical_readings' });

const StationBase = model('Station', {
  fields: {
    id: field.column(int4Column).id(),
    readingId: field.column(int4Column).column('reading_id'),
    // A per-station tally wide enough to hold values a double cannot, so an
    // aggregate over it has something to lose.
    weight: field.column(int8Column).optional(),
  },
  relations: {
    reading: rel.belongsTo(Reading, { from: 'readingId', to: 'id' }),
  },
}).sql({ table: 'canonical_stations' });

const Station = StationBase;

const ReadingWithStations = Reading.relations({
  stations: rel.hasMany(() => StationBase, { by: 'readingId' }),
}).sql({ table: 'canonical_readings' });

const contract = defineContract({
  extensions: { pgvector },
  models: { Reading: ReadingWithStations, Station },
});
const context = createExecutionContext({
  contract,
  stack: createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    extensions: [pgvectorRuntime],
  }),
});

async function setupTables(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('create extension if not exists vector');
  await runtime.query('drop table if exists canonical_stations');
  await runtime.query('drop table if exists canonical_readings');
  await runtime.query(`
    create table canonical_readings (
      id integer primary key,
      amount numeric(38,20),
      padded numeric(10,2),
      counter bigint,
      payload bytea,
      elapsed interval,
      embedding vector(3)
    )
  `);
  await runtime.query(`
    create table canonical_stations (
      id integer primary key,
      reading_id integer not null,
      weight bigint
    )
  `);
  await runtime.query(
    `insert into canonical_readings (id, amount, padded, counter, payload, elapsed, embedding) values
       (1, $1::numeric, $2::numeric, $3::bigint, $4::bytea,
        interval '14 months 3 days 4 hours 5 minutes 6.123456 seconds', $5::vector)`,
    [DOD_NUMERIC, '1.5', DOD_WIDE_INTEGER, Buffer.from(WIDE_BYTEA), `[${VECTOR.join(',')}]`],
  );
  await runtime.query('insert into canonical_stations (id, reading_id) values (1, 1)');
}

describe('integration/include canonical JSON', () => {
  it(
    'each codec survives an ORM include exactly',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupTables(runtime);

        // What an unprojected `json_build_object` produces, recorded beside
        // the include so the two can be compared rather than described. The
        // numeric arrives through a double; the bytea in PostgreSQL's own
        // hex escape, which is not base64.
        const [raw] = await runtime.query<{ value: Record<string, unknown> }>(`
            select json_build_object(
              'amount', amount,
              'counter', counter,
              'payload', payload
            ) as value
            from canonical_readings where id = 1
          `);
        const rawValue = raw?.value as { amount: number; counter: number; payload: string };
        expect(rawValue).toMatchObject({
          amount: 1234567890.1234567,
          counter: 9007199254740992,
        });
        expect(rawValue.payload).toMatch(/^\\x/);

        const stations = new Collection({ runtime, context }, 'Station', {
          namespaceId: 'public',
        });
        const rows = await stations
          .select('id')
          .include('reading', (reading) =>
            reading.select('amount', 'padded', 'counter', 'payload', 'elapsed', 'embedding'),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            reading: {
              amount: DOD_NUMERIC,
              padded: '1.50',
              counter: 9007199254740993n,
              payload: WIDE_BYTEA,
              elapsed: { months: 14, days: 3, micros: 14706123456n },
              embedding: VECTOR,
            },
          },
        ]);
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );

  /**
   * The slice recorded scale-padding as a tripwire: `numeric(p,s)` pads, so
   * `col::text` might disagree with `toDataTypeValue`. Probed against a live
   * server, the padding happens on **write** — `'1.5'` inserted into
   * `numeric(10,2)` is stored as `1.50` — so the projection reports what is
   * stored, exactly, and there is nothing for it to disagree with. The same
   * write-side normalisation rounds `numeric(38)` (scale 0) to an integer.
   * Both are storage semantics, visible here rather than left as prose.
   */
  it(
    'a scale-padded numeric round-trips as the padded value the database holds',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupTables(runtime);

        const [stored] = await runtime.query<{ padded: string }>(
          'select padded::text as padded from canonical_readings where id = 1',
        );
        expect(stored?.padded).toBe('1.50');

        const stations = new Collection({ runtime, context }, 'Station', {
          namespaceId: 'public',
        });
        const rows = await stations
          .select('id')
          .include('reading', (reading) => reading.select('padded'))
          .all();

        expect(rows).toEqual([{ id: 1, reading: { padded: '1.50' } }]);
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a null column stays null rather than becoming a projected string',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupTables(runtime);
        await runtime.query('insert into canonical_readings (id) values (3)');
        await runtime.query('insert into canonical_stations (id, reading_id) values (3, 3)');

        const stations = new Collection({ runtime, context }, 'Station', {
          namespaceId: 'public',
        });
        const rows = await stations
          .select('id')
          .include('reading', (reading) =>
            reading.select('amount', 'counter', 'payload', 'elapsed', 'embedding'),
          )
          .all();

        expect(rows[1]).toEqual({
          id: 3,
          reading: {
            amount: null,
            counter: null,
            payload: null,
            elapsed: null,
            embedding: null,
          },
        });
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a lossless aggregate past 2^53 survives both the top-level read and the include',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupTables(runtime);
        // A second reading, so `sum` has to compute a value rather than echo
        // one: 9007199254740993 + 2 is 9007199254740995, which no double holds.
        await runtime.query('insert into canonical_readings (id, counter) values (2, 2)');
        await runtime.query(
          'insert into canonical_stations (id, reading_id, weight) values (2, 1, $1::bigint)',
          [DOD_WIDE_INTEGER],
        );

        const readings = new Collection({ runtime, context }, 'Reading', {
          namespaceId: 'public',
        });

        // The contract is authored in this file, so its static aggregate map
        // is unknown and the typed builder surface is empty; dispatch
        // dynamically, as the include reducer below already does.
        const stats = await readings.aggregate((aggregate) => {
          const dynamic = aggregate as Record<string, (field?: string) => AggregateSpec[string]>;
          return { total: dynamic['sumBigInt']!('counter'), peak: dynamic['max']!('counter') };
        });

        // The lossless sum reads PostgreSQL's numeric total as an unbounded
        // bigint; the maximum keeps the column's own bigint. Both are exact,
        // which the same values read as numbers are not.
        expect(stats).toEqual({ total: 9007199254740995n, peak: 9007199254740993n });
        expect(BigInt(Number(stats.total))).not.toBe(stats.total);
        expect(BigInt(Number(stats.peak))).not.toBe(9007199254740993n);

        // The include refinement's cardinality inference does not read a
        // `hasMany` attached to a model declared in this file as to-many, so it
        // types the scalar reducers away; the relation is to-many and the shape
        // asserted below is what the query returns.
        const reduceToMax = (related: unknown): unknown =>
          (related as { max: (field: string) => unknown }).max('weight');
        const withStations = await readings
          .where((reading) => reading.id.eq(1))
          .select('id')
          .include('stations', (stations) => reduceToMax(stations) as never)
          .all();

        // The include carries its value inside a JSON document, where a number
        // would have rounded it on the way out of the database.
        expect(withStations).toEqual([{ id: 1, stations: 9007199254740993n }]);
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );
});
