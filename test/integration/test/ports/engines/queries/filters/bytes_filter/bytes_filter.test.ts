import { and, not } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const TEST_BYTES = new Uint8Array([116, 101, 115, 116]);
const T_BYTES = new Uint8Array([116]);

function withBytesFilter(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.TestModel.createAll([
      { id: 1, bInt: 5n, bytes: TEST_BYTES },
      { id: 2, bInt: 1n, bytes: T_BYTES },
      { id: 3 },
    ]);
    await fn(ctx);
  });
}

describe('ports/engines/queries/filters/bytes_filter', () => {
  it(
    'basic_where',
    () =>
      withBytesFilter(async ({ db }) => {
        expect(
          await db.public.TestModel.select('id')
            .where((m) => m.bytes.eq(TEST_BYTES))
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => and(m.bytes.neq(TEST_BYTES), m.bytes.isNotNull()))
            .all(),
        ).toEqual([{ id: 2 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => m.bytes.isNotNull())
            .all(),
        ).toEqual([{ id: 1 }, { id: 2 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'where_shorthands',
    () =>
      withBytesFilter(async ({ db }) => {
        expect(await db.public.TestModel.select('id').where({ bytes: TEST_BYTES }).all()).toEqual([
          { id: 1 },
        ]);
        expect(await db.public.TestModel.select('id').where({ bytes: null }).all()).toEqual([
          { id: 3 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'inclusion_filter',
    () =>
      withBytesFilter(async ({ db }) => {
        expect(
          await db.public.TestModel.select('id')
            .where((m) => m.bInt.in([5n, 1n]))
            .all(),
        ).toEqual([{ id: 1 }, { id: 2 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => and(m.bInt.notIn([1n]), m.bInt.isNotNull()))
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => and(not(m.bInt.in([1n])), m.bInt.isNotNull()))
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => m.bytes.in([TEST_BYTES, T_BYTES]))
            .all(),
        ).toEqual([{ id: 1 }, { id: 2 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => not(m.bytes.in([TEST_BYTES])))
            .all(),
        ).toEqual([{ id: 2 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'numeric_comparison_filters',
    () =>
      withBytesFilter(async ({ db }) => {
        expect(
          await db.public.TestModel.select('id')
            .where((m) => m.bInt.gt(1n))
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => not(m.bInt.gt(1n)))
            .all(),
        ).toEqual([{ id: 2 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => m.bInt.gte(1n))
            .all(),
        ).toEqual([{ id: 1 }, { id: 2 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => not(m.bInt.gte(5n)))
            .all(),
        ).toEqual([{ id: 2 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => m.bInt.lt(6n))
            .all(),
        ).toEqual([{ id: 1 }, { id: 2 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => not(m.bInt.lt(5n)))
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => m.bInt.lte(5n))
            .all(),
        ).toEqual([{ id: 1 }, { id: 2 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => not(m.bInt.lte(1n)))
            .all(),
        ).toEqual([{ id: 1 }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
