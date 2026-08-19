import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/multiple-types
// (postgres matrix entry only; mongo-only features skipped).
//
// The upstream suite compares $queryRaw vs findMany for various scalar types.
// In prisma-next there is no $queryRaw, so all "differences between queryRaw
// and findMany" tests are non-portable.
//
// Prisma-next type differences from upstream Prisma Client:
//   - BigInt  → bigint   (pg/int8@1 carries the full signed 64-bit range, which a
//                         JS number cannot hold past 2^53)
//   - Decimal → string   (pg/numeric@1 codec output is `string`, not Prisma.Decimal)
//   - DateTime → Temporal.Instant (Prisma returns a Date; pg/timestamptz-temporal@1 parses
//                         PostgreSQL's own text into an instant instead)
//   - Bytes   → Uint8Array (same as Prisma, but always a plain Uint8Array not Buffer)
//   - Bool    → boolean  (same as Prisma)
//   - Int     → number   (same as Prisma)
//   - Float   → number   (same as Prisma)
//   - String  → string   (same as Prisma)
//
// Non-portable tests (no $queryRaw):
//   - 'shows differences between queryRaw and findMany' — the only test whose
//     subject is the queryRaw-vs-findMany comparison itself; recorded in the ledger.
// All other tests (including '2 records, 1st with null, 2nd with values should
// succeed') are ported via findMany, which is their observable subject here.

const instant = Temporal.Instant.from('1900-10-10T01:10:10.001Z');

function withMultipleTypes(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/multiple-types', () => {
  it(
    'Bool field: true or false should succeed',
    () =>
      withMultipleTypes(async ({ db }) => {
        await db.public.TestModel.create({ bool: true });
        await db.public.TestModel.create({ bool: false });

        const resultFromFindMany = await db.public.TestModel.all();
        const boolValues = resultFromFindMany.map((r) => r.bool).sort();

        expect(resultFromFindMany).toHaveLength(2);
        expect(boolValues).toEqual([false, true]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'String field: true or false as string should succeed',
    () =>
      withMultipleTypes(async ({ db }) => {
        await db.public.TestModel.create({ string: 'true' });
        await db.public.TestModel.create({ string: 'false' });

        const resultFromFindMany = await db.public.TestModel.all();
        const stringValues = resultFromFindMany.map((r) => r.string).sort();

        expect(resultFromFindMany).toHaveLength(2);
        expect(stringValues).toEqual(['false', 'true']);
      }),
    timeouts.spinUpPpgDev,
  );

  // Non-portable: 'shows differences between queryRaw and findMany'
  // prisma-next has no $queryRaw — recorded as non-ported in inbox ledger.

  it(
    'a record with all fields set to null should succeed',
    () =>
      withMultipleTypes(async ({ db }) => {
        await db.public.TestModel.create({});

        const resultFromFindMany = await db.public.TestModel.all();

        expect(resultFromFindMany).toHaveLength(1);
        expect(resultFromFindMany[0]).toMatchObject({
          bInt: null,
          bool: null,
          bytes: null,
          dec: null,
          dt: null,
          float: null,
          int: null,
          string: null,
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    '2 records, 1st with null, 2nd with values should succeed',
    () =>
      withMultipleTypes(async ({ db }) => {
        await db.public.TestModel.create({});
        await db.public.TestModel.create({
          string: 'str',
          int: 42,
          bInt: 12345n,
          float: 0.125,
          bytes: Uint8Array.from([1, 2, 3]),
          bool: true,
          dt: instant,
          dec: '0.0625',
        });

        const resultFromFindMany = await db.public.TestModel.all();

        expect(resultFromFindMany).toHaveLength(2);
        // The all-null row has null bool; the values row has bool: true — sort by bool to stabilize
        const [nullRow, valuesRow] = resultFromFindMany.sort((a, b) => {
          if (a.bool === null) return -1;
          if (b.bool === null) return 1;
          return 0;
        });
        expect(nullRow).toMatchObject({
          bInt: null,
          bool: null,
          bytes: null,
          dec: null,
          dt: null,
          float: null,
          int: null,
          string: null,
        });
        // bInt comes back as bigint (pg/int8@1 codec output)
        // dec comes back as string (pg/numeric@1 codec output)
        expect(valuesRow).toMatchObject({
          string: 'str',
          int: 42,
          bInt: 12345n,
          float: 0.125,
          bytes: Uint8Array.from([1, 2, 3]),
          bool: true,
          dec: '0.0625',
        });
        // `dt` is asserted through its text because the assertion above is a `toMatchObject`,
        // which a Temporal value defeats: no own enumerable properties, so the subset matcher
        // finds nothing to compare and passes for any instant.
        expect(valuesRow?.dt?.toString()).toBe(instant.toString());
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'all fields are null',
    () =>
      withMultipleTypes(async ({ db }) => {
        await db.public.TestModel.create({});

        const resultFromFindMany = await db.public.TestModel.all();

        expect(resultFromFindMany).toHaveLength(1);
        expect(resultFromFindMany[0]).toMatchObject({
          bInt: null,
          bool: null,
          bytes: null,
          dec: null,
          dt: null,
          float: null,
          int: null,
          string: null,
        });
      }),
    timeouts.spinUpPpgDev,
  );
});
