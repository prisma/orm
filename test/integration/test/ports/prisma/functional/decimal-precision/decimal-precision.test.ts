import type { Numeric } from '@internal/target-postgres/codec-types';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/decimal/precision
// (postgres matrix rows only; sqlite + mongodb opted out upstream).
//
// Upstream is a @fast-check property test: for each (precision, scale) matrix
// entry it generates in-range decimal strings, writes them via Prisma.Decimal,
// and asserts `result.decimal.toFixed() === input` (no precision loss). The
// postgres-applicable precisions are (10,0), (20,10) and (38,30) — each a
// distinct `Numeric(p, s)` column here (see the fixture named types).
//
// The port replaces random generation with representative full-precision values
// per column and asserts the same round-trip property. prisma-next returns
// Numeric as a branded string (no Prisma.Decimal), so `String(value) === input`
// is the equivalent of `toFixed() === input`.

function withDecimalPrecision(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/decimal-precision', () => {
  it(
    'numeric(10,0) round-trips a 9-digit integer without loss',
    () =>
      withDecimalPrecision(async ({ db }) => {
        const created = await db.public.TestModel.create({
          d10_0: '123456789' as Numeric<10, 0>,
        });
        expect(String(created.d10_0)).toBe('123456789');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'numeric(10,0) round-trips a single digit',
    () =>
      withDecimalPrecision(async ({ db }) => {
        const created = await db.public.TestModel.create({ d10_0: '1' as Numeric<10, 0> });
        expect(String(created.d10_0)).toBe('1');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'numeric(20,10) round-trips 10 integer + 10 fractional digits',
    () =>
      withDecimalPrecision(async ({ db }) => {
        const created = await db.public.TestModel.create({
          d20_10: '1234567890.1234567890' as Numeric<20, 10>,
        });
        expect(String(created.d20_10)).toBe('1234567890.1234567890');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'numeric(20,10) round-trips a full-scale fractional value',
    () =>
      withDecimalPrecision(async ({ db }) => {
        const created = await db.public.TestModel.create({
          d20_10: '9.9999999999' as Numeric<20, 10>,
        });
        expect(String(created.d20_10)).toBe('9.9999999999');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'numeric(38,30) round-trips 8 integer + 30 fractional digits',
    () =>
      withDecimalPrecision(async ({ db }) => {
        const created = await db.public.TestModel.create({
          d38_30: '12345678.123456789012345678901234567890' as Numeric<38, 30>,
        });
        expect(String(created.d38_30)).toBe('12345678.123456789012345678901234567890');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'numeric(38,30) round-trips a 30-digit fractional tail',
    () =>
      withDecimalPrecision(async ({ db }) => {
        const created = await db.public.TestModel.create({
          d38_30: '1.000000000000000000000000000001' as Numeric<38, 30>,
        });
        expect(String(created.d38_30)).toBe('1.000000000000000000000000000001');
      }),
    timeouts.spinUpPpgDev,
  );
});
