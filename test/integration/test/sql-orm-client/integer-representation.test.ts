import postgresAdapter from '@internal/adapter-postgres/runtime';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { rejectionShape } from './error-shape';
import type { Contract } from './fixtures/integer-representation/generated/contract';
import contractJson from './fixtures/integer-representation/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

/**
 * End-to-end proof of the integer-representation types on PostgreSQL, driven
 * through the real emitted fixture (`fixtures/integer-representation/generated/`):
 * `Meter.peak` is `BigIntNumber` (`pg/int8number@1`, int8 read as a JS number)
 * and `Meter.lifetime` is `UnboundedInt` (`pg/unboundedint@1`, unconstrained
 * numeric read as a bigint). Boundary values only — a value inside the safe
 * range proves nothing about the guard.
 */

/** 2^53 − 1, the largest integer a JS number holds exactly. */
const MAX_SAFE = 9007199254740991;
/** 2^53, the first integer past the safe range on either side. */
const FIRST_UNSAFE = 9007199254740992;
/** 2^64 + 1 — past 2^63, outside int8 entirely. */
const PAST_TWO_63 = 18446744073709551617n;

const contract = new PostgresContractSerializer().deserializeContract<Contract>(contractJson);
const context = createExecutionContext<Contract>({
  contract,
  stack: createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    extensions: [],
  }),
});

function createMeters(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context }, 'Meter', { namespaceId: 'public' });
}

function createSamples(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context }, 'Sample', { namespaceId: 'public' });
}

async function setupTables(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('drop table if exists int_repr_samples');
  await runtime.query('drop table if exists int_repr_meters');
  await runtime.query(`
    create table int_repr_meters (
      id integer primary key,
      peak bigint not null,
      lifetime numeric not null
    )
  `);
  await runtime.query(`
    create table int_repr_samples (
      id integer primary key,
      meter_id integer not null references int_repr_meters(id),
      reading bigint not null
    )
  `);
}

describe('integration/integer representation types', () => {
  it(
    'writes and reads both types at the safe-range boundary and past 2^63',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupTables(runtime);
        const meters = createMeters(runtime);

        await meters.create({ id: 1, peak: MAX_SAFE, lifetime: PAST_TWO_63 });
        await meters.create({ id: 2, peak: -MAX_SAFE, lifetime: -PAST_TWO_63 });

        const rows = await meters
          .select('id', 'peak', 'lifetime')
          .orderBy((meter) => meter.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 1, peak: MAX_SAFE, lifetime: PAST_TWO_63 },
          { id: 2, peak: -MAX_SAFE, lifetime: -PAST_TWO_63 },
        ]);

        type Row = (typeof rows)[number];
        expectTypeOf<Row['peak']>().toEqualTypeOf<number>();
        expectTypeOf<Row['lifetime']>().toEqualTypeOf<bigint>();
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );

  // The include nests the related rows through the database-side JSON
  // envelope, and `pg/int8number@1` is the one codec whose canonical JSON is a
  // number rather than decimal text — the boundary value proves that
  // projection survives the nested-document path exactly.
  it(
    'carries a BigIntNumber column through an include at the safe-range boundary',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupTables(runtime);
        const meters = createMeters(runtime);
        const samples = createSamples(runtime);

        await meters.create({ id: 1, peak: 0, lifetime: 0n });
        await samples.create({ id: 1, meterId: 1, reading: MAX_SAFE });
        await samples.create({ id: 2, meterId: 1, reading: -MAX_SAFE });

        const rows = await meters
          .select('id')
          .include('samples', (sample) => sample.select('id', 'reading').orderBy((s) => s.id.asc()))
          .orderBy((meter) => meter.id.asc())
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            samples: [
              { id: 1, reading: MAX_SAFE },
              { id: 2, reading: -MAX_SAFE },
            ],
          },
        ]);
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reading a stored value past the safe range through BigIntNumber raises RUNTIME.DECODE_FAILED',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupTables(runtime);
        // Out of band on purpose: the encode guard refuses to write this
        // value, so only raw SQL can arrange the stored state the decode
        // guard exists for.
        await runtime.query(
          `insert into int_repr_meters (id, peak, lifetime) values (10, ${FIRST_UNSAFE}, 0)`,
        );
        const meters = createMeters(runtime);

        const shape = await rejectionShape(
          meters
            .select('id', 'peak')
            .where((meter) => meter.id.eq(10))
            .all(),
        );
        expect(shape).toEqual({
          name: 'StructuredError',
          message: `pg/int8number@1 value must be an integer within the safe integer range, got ${FIRST_UNSAFE}`,
          code: 'RUNTIME.DECODE_FAILED',
          meta: { codecId: 'pg/int8number@1', received: String(FIRST_UNSAFE) },
        });
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reading a stored value past the safe range through an include raises RUNTIME.DECODE_FAILED',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupTables(runtime);
        const meters = createMeters(runtime);
        await meters.create({ id: 1, peak: 0, lifetime: 0n });
        // Out of band on purpose: the encode guard refuses to write this
        // value, so only raw SQL can arrange the stored state the decode
        // guard exists for.
        await runtime.query(
          `insert into int_repr_samples (id, meter_id, reading) values (10, 1, ${FIRST_UNSAFE})`,
        );

        const shape = await rejectionShape(
          meters
            .select('id')
            .where((meter) => meter.id.eq(1))
            .include('samples', (sample) => sample.select('id', 'reading'))
            .all(),
        );
        // The include decode wraps the codec's structured error in the
        // runtime's column-context envelope, with the codec error on `cause`.
        expect(shape).toEqual({
          name: 'RuntimeError',
          message: `Failed to decode column int_repr_samples.reading with codec 'pg/int8number@1': pg/int8number@1 JSON value must be a decimal integer string from -9007199254740991 to 9007199254740991`,
          code: 'RUNTIME.DECODE_FAILED',
          category: 'RUNTIME',
          severity: 'error',
          details: {
            table: 'int_repr_samples',
            column: 'reading',
            codec: 'pg/int8number@1',
          },
          cause: {
            name: 'StructuredError',
            message:
              'pg/int8number@1 JSON value must be a decimal integer string from -9007199254740991 to 9007199254740991',
            code: 'RUNTIME.DECODE_FAILED',
            meta: { codecId: 'pg/int8number@1', received: JSON.stringify(String(FIRST_UNSAFE)) },
          },
        });
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'writing past the safe range through BigIntNumber raises RUNTIME.ENCODE_FAILED',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupTables(runtime);
        const meters = createMeters(runtime);

        const shape = await rejectionShape(
          meters.create({ id: 20, peak: FIRST_UNSAFE, lifetime: 0n }),
        );
        expect(shape).toEqual({
          name: 'StructuredError',
          message: `pg/int8number@1 value must be an integer within the safe integer range, got ${FIRST_UNSAFE}`,
          code: 'RUNTIME.ENCODE_FAILED',
          meta: { codecId: 'pg/int8number@1', received: String(FIRST_UNSAFE) },
        });
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'writing a non-integral number through BigIntNumber raises RUNTIME.ENCODE_FAILED',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupTables(runtime);
        const meters = createMeters(runtime);

        const shape = await rejectionShape(meters.create({ id: 21, peak: 1.5, lifetime: 0n }));
        expect(shape).toEqual({
          name: 'StructuredError',
          message:
            'pg/int8number@1 value must be an integer within the safe integer range, got 1.5',
          code: 'RUNTIME.ENCODE_FAILED',
          meta: { codecId: 'pg/int8number@1', received: '1.5' },
        });
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );

  // The aggregate method set and its result decoding are both derived from the
  // contract's emitted rows, so this reduces columns whose codecs the derivation
  // never names. The bare operations answer in the JS types a caller expects —
  // `sum` and `avg` over either integer column as a `number` — except where the
  // column's own family already carries the result: `sum` over
  // `pg/unboundedint@1` stays unbounded, since that column's author chose the
  // exact representation. `min`/`max` resolve to the input codec itself.
  it(
    'reduces BigIntNumber and UnboundedInt columns through their declared result codecs',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupTables(runtime);
        const meters = createMeters(runtime);

        await meters.create({ id: 1, peak: 10, lifetime: PAST_TWO_63 });
        await meters.create({ id: 2, peak: 30, lifetime: PAST_TWO_63 });

        const stats = await meters.aggregate((agg) => ({
          rows: agg.count(),
          peakSum: agg.sum('peak'),
          peakAvg: agg.avg('peak'),
          peakMin: agg.min('peak'),
          peakMax: agg.max('peak'),
          lifetimeSum: agg.sum('lifetime'),
          lifetimeAvg: agg.avg('lifetime'),
          lifetimeMin: agg.min('lifetime'),
          lifetimeMax: agg.max('lifetime'),
        }));

        expect(stats).toEqual({
          rows: 2,
          peakSum: 40,
          peakAvg: 20,
          peakMin: 10,
          peakMax: 30,
          lifetimeSum: 36893488147419103234n,
          lifetimeAvg: 1.8446744073709552e19,
          lifetimeMin: PAST_TWO_63,
          lifetimeMax: PAST_TWO_63,
        });

        expectTypeOf(stats).toEqualTypeOf<{
          rows: number;
          peakSum: number | null;
          peakAvg: number | null;
          peakMin: number | null;
          peakMax: number | null;
          lifetimeSum: bigint | null;
          lifetimeAvg: number | null;
          lifetimeMin: bigint | null;
          lifetimeMax: bigint | null;
        }>();
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );

  // A total is free to leave the range the column itself guards, which is the
  // whole reason the bare operation guards it again on the way back.
  it(
    'refuses a bare sum past the safe range rather than rounding it',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupTables(runtime);
        const meters = createMeters(runtime);

        await meters.create({ id: 1, peak: MAX_SAFE, lifetime: 0n });
        await meters.create({ id: 2, peak: MAX_SAFE, lifetime: 0n });

        const shape = await rejectionShape(meters.aggregate((agg) => ({ total: agg.sum('peak') })));
        expect(shape).toEqual({
          name: 'StructuredError',
          message: `pg/int8number@1 value must be an integer within the safe integer range, got ${2 * MAX_SAFE}`,
          code: 'RUNTIME.DECODE_FAILED',
          meta: { codecId: 'pg/int8number@1', received: String(2 * MAX_SAFE) },
        });
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );

  // The include path is the subtler one: the total is projected as a JSON
  // number, so `JSON.parse` has already rounded it by the time the codec reads
  // it. Rounding is monotone, which is what makes the post-parse guard
  // un-foolable — the rounded value is still outside the safe range.
  it(
    'refuses a bare sum past the safe range through the include path too',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupTables(runtime);
        const meters = createMeters(runtime);
        const samples = createSamples(runtime);

        await meters.create({ id: 1, peak: 0, lifetime: 0n });
        await samples.create({ id: 1, meterId: 1, reading: MAX_SAFE });
        await samples.create({ id: 2, meterId: 1, reading: MAX_SAFE });

        const shape = await rejectionShape(
          meters
            .select('id')
            .include('samples', (sample) => sample.sum('reading'))
            .all(),
        );
        // The include decode wraps the codec's structured error in the
        // runtime's column-context envelope, naming the reducer's alias where a
        // scalar include names the column, with the codec error on `cause`.
        expect(shape).toEqual({
          name: 'RuntimeError',
          message: `Failed to decode column int_repr_samples.samples with codec 'pg/int8number@1': pg/int8number@1 JSON value must be a decimal integer string from -9007199254740991 to 9007199254740991`,
          code: 'RUNTIME.DECODE_FAILED',
          category: 'RUNTIME',
          severity: 'error',
          details: {
            table: 'int_repr_samples',
            column: 'samples',
            codec: 'pg/int8number@1',
          },
          cause: {
            name: 'StructuredError',
            message:
              'pg/int8number@1 JSON value must be a decimal integer string from -9007199254740991 to 9007199254740991',
            code: 'RUNTIME.DECODE_FAILED',
            meta: { codecId: 'pg/int8number@1', received: JSON.stringify(String(2 * MAX_SAFE)) },
          },
        });
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );

  // The lossless variant is the escape hatch the guard points at, and over a
  // 64-bit column it reads PostgreSQL's `numeric` total rather than casting
  // back to `int8` — so 2^63 is not a wall either.
  it(
    'reads a lossless sum exactly, past 2^53 and past 2^63',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupTables(runtime);
        const meters = createMeters(runtime);

        await meters.create({ id: 1, peak: MAX_SAFE, lifetime: PAST_TWO_63 });
        await meters.create({ id: 2, peak: MAX_SAFE, lifetime: PAST_TWO_63 });

        const stats = await meters.aggregate((agg) => ({
          rows: agg.countBigInt(),
          peakSum: agg.sumBigInt('peak'),
          lifetimeSum: agg.sumBigInt('lifetime'),
        }));

        expect(stats).toEqual({
          rows: 2n,
          peakSum: 18014398509481982n,
          lifetimeSum: 36893488147419103234n,
        });

        expectTypeOf(stats).toEqualTypeOf<{
          rows: bigint;
          peakSum: bigint | null;
          lifetimeSum: bigint | null;
        }>();
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );

  // A mean is a fraction, and the two forms answer it differently on purpose:
  // the bare operation rounds the exact mean once into a double, the suffixed
  // one hands back PostgreSQL's own `numeric`, digits and all. 31/3 has no
  // finite binary expansion, so the two answers are different text — a mean
  // that terminated would read the same whichever form produced it.
  it(
    'answers avg as a number and avgDecimal as the exact decimal text',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupTables(runtime);
        const meters = createMeters(runtime);

        await meters.create({ id: 1, peak: 10, lifetime: 0n });
        await meters.create({ id: 2, peak: 10, lifetime: 0n });
        await meters.create({ id: 3, peak: 11, lifetime: 0n });

        const stats = await meters.aggregate((agg) => ({
          mean: agg.avg('peak'),
          exactMean: agg.avgDecimal('peak'),
        }));

        expect(stats).toEqual({
          mean: 10.333333333333334,
          exactMean: '10.3333333333333333',
        });
        expect(String(stats.mean)).not.toBe(stats.exactMean);

        expectTypeOf(stats).toEqualTypeOf<{
          mean: number | null;
          exactMean: string | null;
        }>();
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );
});
