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
// The upstream computes the expected `date` value by stripping the time component; the
// Temporal equivalent is `PlainDateTime.toPlainDate()`, mirrored faithfully below.
//
// Values are compared through `toString()`. The original assertion was a `toMatchObject`, which
// a Temporal value defeats: it has no own enumerable properties, so a subset matcher finds nothing
// to compare and passes for any pair of same-typed values. (`toEqual` does not have this problem —
// Vitest compares these correctly — but the text also puts the actual value in the failure diff.)

// These cases have 2-digit calendar years (00–99 AD) in the date column.
// The it.fails markers were recorded against the retired Date-typed date codec, which misparsed
// PGlite's century-omitting wire format (year 31 read as 1931).
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

/**
 * One source string, the three representations the three columns take. Strings without an
 * offset are read as UTC, which is what `new Date(...)` did for the same inputs upstream.
 */
function representations(timestampString: string): {
  readonly date: Temporal.PlainDate;
  readonly timestamp: Temporal.PlainDateTime;
  readonly timestamptz: Temporal.Instant;
} {
  const timestamp = Temporal.PlainDateTime.from(timestampString);
  // `Instant.from` is the authority on whether the text carries an offset; anything it
  // refuses is offset-free and is read as UTC.
  let timestamptz: Temporal.Instant;
  try {
    timestamptz = Temporal.Instant.from(timestampString);
  } catch {
    timestamptz = timestamp.toZonedDateTime('UTC').toInstant();
  }
  return { date: timestamp.toPlainDate(), timestamp, timestamptz };
}

function asStrings(value: {
  readonly date: Temporal.PlainDate;
  readonly timestamp: Temporal.PlainDateTime;
  readonly timestamptz: Temporal.Instant;
}): Record<string, string> {
  return {
    date: value.date.toString(),
    timestamp: value.timestamp.toString(),
    timestamptz: value.timestamptz.toString(),
  };
}

describe('ports/prisma/functional/issues-28192-pg-historical-dates', () => {
  describe('historical dates with 2-digit years (00-99 AD)', () => {
    it.fails.each(twoDigitYearData)(
      'correctly parses $label',
      ({ timestampString }) =>
        withIssue28192(async ({ db }) => {
          const written = representations(timestampString);
          const result = await db.public.TestData.create(written);
          expect(asStrings(result)).toEqual(asStrings(written));
        }),
      timeouts.spinUpPpgDev,
    );
  });

  describe('historical dates with 3-digit+ years', () => {
    it.each(passingData)(
      'correctly parses $label',
      ({ timestampString }) =>
        withIssue28192(async ({ db }) => {
          const written = representations(timestampString);
          const result = await db.public.TestData.create(written);
          expect(asStrings(result)).toEqual(asStrings(written));
        }),
      timeouts.spinUpPpgDev,
    );
  });
});
