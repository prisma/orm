import { and, not, or } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

function withFilters(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.Vehicle.createAll([
      { id: 'vehicle-1', unique: 1, brand: 'Porsche', parked: true },
      { id: 'vehicle-2', unique: 2, brand: 'BMW', parked: false },
      { id: 'vehicle-3', unique: 3, brand: 'Mercedes', parked: true },
    ]);
    await ctx.db.public.User.createAll([
      { id: 'user-1', name: 'Paul', unique: 1, vehicle_id: 'vehicle-1' },
      { id: 'user-2', name: 'Bernd', unique: 2, vehicle_id: 'vehicle-2' },
      { id: 'user-3', name: 'Michael', unique: 3, vehicle_id: 'vehicle-3' },
      { id: 'user-4', name: 'John', unique: 4 },
    ]);
    await ctx.db.public.ParkingLot.createAll([
      { id: 'lot-1', area: 'PrenzlBerg', unique: 1, capacity: 12, size: 300.5 },
      { id: 'lot-2', area: 'Moabit', unique: 2, capacity: 34, size: 100.5 },
    ]);
    await fn(ctx);
  });
}

function userUniques(db: Parameters<Parameters<typeof withFilters>[0]>[0]['db']) {
  return db.public.User.select('unique').orderBy((user) => user.unique.asc());
}

describe('ports/engines/queries/filters/filters', () => {
  it(
    'no_filter',
    () =>
      withFilters(async ({ db }) => {
        expect(await userUniques(db).all()).toEqual([
          { unique: 1 },
          { unique: 2 },
          { unique: 3 },
          { unique: 4 },
        ]);
        expect(
          await db.public.Vehicle.select('unique')
            .orderBy((row) => row.unique.asc())
            .all(),
        ).toEqual([{ unique: 1 }, { unique: 2 }, { unique: 3 }]);
        expect(
          await db.public.ParkingLot.select('unique')
            .orderBy((row) => row.unique.asc())
            .all(),
        ).toEqual([{ unique: 1 }, { unique: 2 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'simple',
    () =>
      withFilters(async ({ db }) => {
        expect(
          await userUniques(db)
            .where((user) => user.name.eq('John'))
            .all(),
        ).toEqual([{ unique: 4 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'inverted_simple',
    () =>
      withFilters(async ({ db }) => {
        expect(
          await userUniques(db)
            .where((user) => not(user.name.eq('John')))
            .all(),
        ).toEqual([{ unique: 1 }, { unique: 2 }, { unique: 3 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'implicit_not_equals',
    () =>
      withFilters(async ({ db }) => {
        expect(
          await userUniques(db)
            .where((user) => user.name.neq('John'))
            .all(),
        ).toEqual([{ unique: 1 }, { unique: 2 }, { unique: 3 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'implicit_equals',
    () =>
      withFilters(async ({ db }) => {
        expect(await userUniques(db).where({ name: 'John' }).all()).toEqual([{ unique: 4 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'implicit_equals_null',
    () =>
      withFilters(async ({ db }) => {
        expect(await userUniques(db).where({ name: null }).all()).toEqual([]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'in_list',
    () =>
      withFilters(async ({ db }) => {
        expect(
          await userUniques(db)
            .where((user) => user.name.in(['Bernd', 'Paul']))
            .all(),
        ).toEqual([{ unique: 1 }, { unique: 2 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'not_in_list',
    () =>
      withFilters(async ({ db }) => {
        expect(
          await userUniques(db)
            .where((user) => user.name.notIn(['Bernd', 'Paul']))
            .all(),
        ).toEqual([{ unique: 3 }, { unique: 4 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'relation_null',
    () =>
      withFilters(async ({ db }) => {
        expect(
          await userUniques(db)
            .where((user) => user.ride.none())
            .all(),
        ).toEqual([{ unique: 4 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'empty_and',
    () =>
      withFilters(async ({ db }) => {
        expect(
          await userUniques(db)
            .where(() => and())
            .all(),
        ).toEqual([{ unique: 1 }, { unique: 2 }, { unique: 3 }, { unique: 4 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'empty_or',
    () =>
      withFilters(async ({ db }) => {
        expect(
          await userUniques(db)
            .where(() => or())
            .all(),
        ).toEqual([]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'greater_than',
    () =>
      withFilters(async ({ db }) => {
        expect(
          await db.public.ParkingLot.where((lot) => lot.size.gt(100.500000000001))
            .select('unique')
            .all(),
        ).toEqual([{ unique: 1 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'inverted_null',
    () =>
      withFilters(async ({ db }) => {
        expect(
          await userUniques(db)
            .where((user) => user.name.isNotNull())
            .all(),
        ).toEqual([{ unique: 1 }, { unique: 2 }, { unique: 3 }, { unique: 4 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'inverted_null_required',
    () =>
      withFilters(async ({ db }) => {
        await expect(
          db.public.User.where((user) => {
            // @ts-expect-error The faithful invalid null operand is rejected by the target type surface.
            return user.unique.neq(null);
          })
            .select('unique')
            .all(),
        ).rejects.toThrow();
      }),
    timeouts.spinUpPpgDev,
  );
});
