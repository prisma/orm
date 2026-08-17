import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/28192-pg-historical-dates
// (postgres only; optOut excludes all others).
//
// Subject: postgres timestamps with historical/2-digit-year dates (years 00-99 AD)
// round-trip correctly through the ORM — the date, timestamp, and timestamptz fields
// all preserve the original Date value.
//
// In prisma-next the three columns carry representation-explicit codecs:
// `pg/date-temporal@1` reads a `Temporal.PlainDate`, `pg/timestamp-temporal@1` a
// `Temporal.PlainDateTime`, and `pg/timestamptz-temporal@1` a `Temporal.Instant`. Each parses
// PostgreSQL's own text rather than going through a `Date`.
//
// The upstream computes the expected `date` value by stripping the time component:
//   const date = new Date(new Date(timestampString).toISOString().split('T')[0])
// This is mirrored faithfully below.

// These cases have 2-digit calendar years (00–99 AD) in the date column.
// The it.fails markers were recorded against the retired Date-typed date codec, which misparsed
// PGlite's century-omitting wire format (year 31 read as 1931). The replacement parses server
// text through Temporal instead, so whether the gap survives is unverified — these need
// re-validating once the fixtures are regenerated.
const twoDigitYearData = [
  { label: '31 AD timestamp', timestampString: '0031-01-01T00:00:00.000Z' },
  { label: '32 AD timestamp', timestampString: '0032-01-01T00:00:00.000Z' },
  { label: '40 AD timestamp', timestampString: '0040-01-01T00:00:00.000Z' },
  { label: '99 AD timestamp', timestampString: '0099-12-31T23:59:59.999Z' },
] satisfies Array<{ label: string; timestampString: string }>;

// These cases round-trip correctly through all three column types.
const passingData = [
  { label: '120 AD timestamp', timestampString: '0120-01-01T00:00:00+00:00' },
  { label: 'timestamp with milliseconds', timestampString: '0040-06-15 12:30:45.123' },
  { label: 'modern date timestamp', timestampString: '1999-12-31 23:59:59.999' },
  { label: '3-digit year timestamp', timestampString: '0999-06-15 12:00:00' },
  {
    label: 'timestamptz with milliseconds and timezone',
    timestampString: '0050-01-15 10:20:30.456+02',
  },
] satisfies Array<{ label: string; timestampString: string }>;

function withIssue28192(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/issues-28192-pg-historical-dates', () => {
  describe('historical dates with 2-digit years (00-99 AD)', () => {
    it.fails.each(twoDigitYearData)(
      'correctly parses $label',
      ({ timestampString }) =>
        withIssue28192(async ({ db }) => {
          const timestamp = new Date(timestampString);
          const result = await db.public.TestData.create({
            date: timestamp,
            timestamp,
            timestamptz: timestamp,
          });

          // date strips the time component; upstream derives expected date identically.
          const datePart = new Date(timestampString).toISOString().split('T')[0] ?? '';
          const date = new Date(datePart);
          expect(result).toMatchObject({ date, timestamp, timestamptz: timestamp });
        }),
      timeouts.spinUpPpgDev,
    );
  });

  describe('historical dates with 3-digit+ years', () => {
    it.each(passingData)(
      'correctly parses $label',
      ({ timestampString }) =>
        withIssue28192(async ({ db }) => {
          const timestamp = new Date(timestampString);
          const result = await db.public.TestData.create({
            date: timestamp,
            timestamp,
            timestamptz: timestamp,
          });

          // date strips the time component; upstream derives expected date identically.
          const datePart = new Date(timestampString).toISOString().split('T')[0] ?? '';
          const date = new Date(datePart);
          expect(result).toMatchObject({ date, timestamp, timestamptz: timestamp });
        }),
      timeouts.spinUpPpgDev,
    );
  });
});
