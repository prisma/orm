/**
 * Representative application values for every built-in SQLite codec descriptor,
 * exercised against a real database by the conformance suite.
 *
 * `notYetCanonical` marks a case that fails today: the projection will not
 * execute, or `fromWire` refuses the row's or the projection's value, or reads
 * them to different application values. The suite asserts a marked case still
 * fails and still fails the recorded way, so a case cannot be fixed without
 * updating this file.
 *
 * A case is only as good as the boundary it crosses. A value chosen for being
 * typical is the one least likely to expose a format defect, so prefer values
 * that sit just past a representation's limits over values that sit comfortably
 * inside all of them.
 */

import { DatabaseSync } from 'node:sqlite';
import type { SqliteCodecConformanceCase } from '../../src/index';

/**
 * Whether this platform's `node:sqlite` reads -2^63 as a number. It throws for every other INTEGER past 2^53, but on some platforms (CI's Linux) it returns this one value, the only one whose magnitude int64 cannot hold, as a number, which `fromWire` refuses; on others (macOS) it throws as for the rest.
 */
function readsLowestInt64AsNumber(): boolean {
  const database = new DatabaseSync(':memory:');
  try {
    database.prepare('SELECT -9223372036854775808 AS x').get();
    return true;
  } catch {
    return false;
  } finally {
    database.close();
  }
}

const instantsEqual = (left: unknown, right: unknown): boolean =>
  left instanceof Temporal.Instant && right instanceof Temporal.Instant && left.equals(right);

const plainDatesEqual = (left: unknown, right: unknown): boolean =>
  left instanceof Temporal.PlainDate && right instanceof Temporal.PlainDate && left.equals(right);

const plainTimesEqual = (left: unknown, right: unknown): boolean =>
  left instanceof Temporal.PlainTime && right instanceof Temporal.PlainTime && left.equals(right);

export const sqliteConformanceCases: readonly SqliteCodecConformanceCase[] = [
  { codecId: 'sql/char@1', label: 'single character', value: 'a', storageType: 'TEXT' },
  { codecId: 'sql/varchar@1', label: 'text', value: 'hello', storageType: 'TEXT' },
  { codecId: 'sql/int@1', label: 'integer', value: 42, storageType: 'INTEGER' },
  { codecId: 'sql/float@1', label: 'finite float', value: 1.5, storageType: 'REAL' },
  { codecId: 'sqlite/text@1', label: 'text', value: 'hello', storageType: 'TEXT' },
  { codecId: 'sqlite/text@1', label: 'empty text', value: '', storageType: 'TEXT' },
  { codecId: 'sqlite/text@1', label: 'digits', value: '42', storageType: 'TEXT' },
  {
    codecId: 'sql/int@1',
    label: 'largest safe integer',
    value: 9007199254740991,
    storageType: 'INTEGER',
  },
  { codecId: 'sqlite/integer@1', label: 'integer', value: 42, storageType: 'INTEGER' },
  // `sqlite/integer` stores digit text, and the safe-range boundaries are where a
  // projection that reached JSON as a number would first lose a digit.
  {
    codecId: 'sqlite/integer@1',
    label: 'largest safe integer',
    value: 9007199254740991,
    storageType: 'INTEGER',
  },
  {
    codecId: 'sqlite/integer@1',
    label: 'smallest safe integer',
    value: -9007199254740991,
    storageType: 'INTEGER',
  },
  { codecId: 'sqlite/real@1', label: 'finite float', value: 1.5, storageType: 'REAL' },
  // hex() never wraps, so a blob's boundary is not length but case: a value whose
  // hex is all digits cannot tell uppercase from lowercase.
  {
    codecId: 'sqlite/blob@1',
    label: 'byte string whose hex is all digits',
    value: new Uint8Array([0x01, 0x23, 0x45]),
    storageType: 'BLOB',
  },
  {
    codecId: 'sqlite/blob@1',
    label: 'byte string whose hex needs letters',
    value: new Uint8Array([0x0a, 0xbc, 0xde, 0xff]),
    storageType: 'BLOB',
  },
  {
    codecId: 'sqlite/blob@1',
    label: 'byte string past any plausible wrap width',
    value: Uint8Array.from({ length: 200 }, (_, index) => (index * 7) % 256),
    storageType: 'BLOB',
  },
  {
    codecId: 'sqlite/blob@1',
    label: 'empty byte string',
    value: new Uint8Array(),
    storageType: 'BLOB',
  },
  {
    codecId: 'sql/raw@1',
    typeParams: { sql: 'geometry' },
    literalValuesAbsent: true,
    label: 'BLOB, as the driver reads it',
    value: new Uint8Array([0x00, 0x01, 0x0a, 0xff]),
    storageType: 'geometry',
  },
  {
    codecId: 'sql/raw@1',
    typeParams: { sql: 'geometry' },
    literalValuesAbsent: true,
    label: 'empty BLOB',
    value: new Uint8Array(),
    storageType: 'geometry',
  },
  {
    codecId: 'sql/raw@1',
    typeParams: { sql: 'geometry' },
    literalValuesAbsent: true,
    label: 'INTEGER',
    value: 42,
    storageType: 'geometry',
  },
  {
    codecId: 'sql/raw@1',
    typeParams: { sql: 'geometry' },
    literalValuesAbsent: true,
    label: 'REAL',
    value: 1.5,
    storageType: 'geometry',
  },
  {
    codecId: 'sql/raw@1',
    typeParams: { sql: 'geometry' },
    literalValuesAbsent: true,
    label: 'TEXT',
    value: 'POINT(1 2)',
    storageType: 'geometry',
  },
  {
    codecId: 'sqlite/datetime@1',
    label: 'instant with milliseconds',
    value: new Date('2026-01-02T03:04:05.678Z'),
    storageType: 'TEXT',
  },
  {
    codecId: 'sqlite/datetime@1',
    label: 'instant with a trailing zero in its milliseconds',
    value: new Date('2026-01-02T03:04:05.500Z'),
    storageType: 'TEXT',
  },
  { codecId: 'sqlite/json@1', label: 'document', value: { a: 1, b: ['x'] }, storageType: 'TEXT' },
  // A document is not always an object: the stored text has to carry every JSON
  // shape, including the scalars whose text form looks like a stored string.
  {
    codecId: 'sqlite/json@1',
    label: 'array at the top level',
    value: [1, 'two', null],
    storageType: 'TEXT',
  },
  {
    codecId: 'sqlite/json@1',
    label: 'string at the top level',
    value: 'plain',
    storageType: 'TEXT',
  },
  { codecId: 'sqlite/json@1', label: 'number at the top level', value: 42, storageType: 'TEXT' },
  { codecId: 'sqlite/json@1', label: 'null at the top level', value: null, storageType: 'TEXT' },
  {
    codecId: 'sqlite/json@1',
    label: 'document whose keys are not in sorted order',
    value: { b: 1, a: 2 },
    storageType: 'TEXT',
  },
  {
    codecId: 'sqlite/json@1',
    label: 'document whose strings need escaping',
    value: { 'k"y': 'v\\a"l', nested: ['x\ny'] },
    storageType: 'TEXT',
  },
  {
    codecId: 'sqlite/bigint@1',
    label: 'small integer',
    value: 42n,
    storageType: 'INTEGER',
  },
  {
    codecId: 'sqlite/bigint@1',
    label: 'integer beyond double precision',
    value: 9007199254740993n,
    storageType: 'INTEGER',
    notYetCanonical: {
      kind: 'row-execution',
      reason:
        'node:sqlite reads an INTEGER past 2^53 only when asked for a bigint, and the runtime driver does not ask, so a row cannot hold this value; the projection carries it as decimal text',
    },
  },
  {
    codecId: 'sqlite/bigint@1',
    label: 'int64 lower bound',
    value: -9223372036854775808n,
    storageType: 'INTEGER',
    notYetCanonical: readsLowestInt64AsNumber()
      ? {
          kind: 'row-from-wire-rejects',
          reason:
            'node:sqlite on this platform reads -2^63 as a number rather than refusing it, and fromWire refuses a number outside the safe integer range, which may have been rounded; the projection carries it as decimal text',
        }
      : {
          kind: 'row-execution',
          reason:
            'node:sqlite reads an INTEGER past 2^53 only when asked for a bigint, and the runtime driver does not ask, so a row cannot hold this value; the projection carries it as decimal text',
        },
  },
  {
    codecId: 'sqlite/bigint@1',
    label: 'int64 upper bound',
    value: 9223372036854775807n,
    storageType: 'INTEGER',
    notYetCanonical: {
      kind: 'row-execution',
      reason:
        'node:sqlite reads an INTEGER past 2^53 only when asked for a bigint, and the runtime driver does not ask, so a row cannot hold this value; the projection carries it as decimal text',
    },
  },
  // The safe-range boundaries are the values a JSON-number canonical form is
  // most likely to mangle, so they are the ones that pin it.
  {
    codecId: 'sqlite/bigintnumber@1',
    label: 'largest safe integer',
    value: 9007199254740991,
    storageType: 'INTEGER',
  },
  {
    codecId: 'sqlite/bigintnumber@1',
    label: 'smallest safe integer',
    value: -9007199254740991,
    storageType: 'INTEGER',
  },
  {
    codecId: 'sqlite/bigintnumber@1',
    label: 'small integer',
    value: 42,
    storageType: 'INTEGER',
  },
  {
    codecId: 'sqlite/text@1',
    label: 'text needing JSON escaping',
    value: 'quote " backslash \\ newline \n',
    storageType: 'TEXT',
  },
  {
    codecId: 'sqlite/text@1',
    label: 'text beyond the basic plane',
    value: 'a\u{1F600}b',
    storageType: 'TEXT',
  },
  // SQLite writes an infinity as the JSON number 9.0e+999, which parses back to
  // Infinity; the float projections write the text toDataTypeValue writes instead.
  {
    codecId: 'sqlite/real@1',
    label: 'positive infinity',
    value: Number.POSITIVE_INFINITY,
    storageType: 'REAL',
  },
  {
    codecId: 'sqlite/real@1',
    label: 'negative infinity',
    value: Number.NEGATIVE_INFINITY,
    storageType: 'REAL',
  },
  {
    codecId: 'sql/float@1',
    label: 'positive infinity',
    value: Number.POSITIVE_INFINITY,
    storageType: 'REAL',
  },
  {
    codecId: 'sql/float@1',
    label: 'negative infinity',
    value: Number.NEGATIVE_INFINITY,
    storageType: 'REAL',
  },
  {
    codecId: 'sqlite/real@1',
    label: 'float not exactly representable',
    value: 0.1,
    storageType: 'REAL',
  },
  // The Temporal-backed codecs' application value is a `Temporal.*`, and every two Temporal values
  // of a kind are deep-equal, so these cases give the round trip its own equality.
  {
    codecId: 'sqlite/datetime-temporal@1',
    label: 'instant with milliseconds',
    value: Temporal.Instant.from('2026-01-02T03:04:05.678Z'),
    storageType: 'TEXT',
    valueEquality: instantsEqual,
    projectionEquality: instantsEqual,
  },
  {
    codecId: 'sqlite/datetime-temporal@1',
    label: 'instant on a whole second',
    value: Temporal.Instant.from('2026-01-02T03:04:05Z'),
    storageType: 'TEXT',
    valueEquality: instantsEqual,
    projectionEquality: instantsEqual,
  },
  {
    codecId: 'sqlite/datetime-temporal@1',
    label: 'instant past the year 9999',
    value: Temporal.Instant.from('+012026-01-02T03:04:05.678Z'),
    storageType: 'TEXT',
    valueEquality: instantsEqual,
    projectionEquality: instantsEqual,
  },
  {
    codecId: 'sqlite/date-temporal@1',
    label: 'leap day',
    value: Temporal.PlainDate.from('2024-02-29'),
    storageType: 'TEXT',
    valueEquality: plainDatesEqual,
    projectionEquality: plainDatesEqual,
  },
  {
    codecId: 'sqlite/date-temporal@1',
    label: 'earliest date SQLite reads',
    value: Temporal.PlainDate.from('0000-01-01'),
    storageType: 'TEXT',
    valueEquality: plainDatesEqual,
    projectionEquality: plainDatesEqual,
  },
  {
    codecId: 'sqlite/date-temporal@1',
    label: 'latest date SQLite reads',
    value: Temporal.PlainDate.from('9999-12-31'),
    storageType: 'TEXT',
    valueEquality: plainDatesEqual,
    projectionEquality: plainDatesEqual,
  },
  {
    codecId: 'sqlite/time-temporal@1',
    label: 'time of day with milliseconds',
    value: Temporal.PlainTime.from('03:04:05.678'),
    storageType: 'TEXT',
    valueEquality: plainTimesEqual,
    projectionEquality: plainTimesEqual,
  },
  {
    codecId: 'sqlite/time-temporal@1',
    label: 'midnight',
    value: Temporal.PlainTime.from('00:00'),
    storageType: 'TEXT',
    valueEquality: plainTimesEqual,
    projectionEquality: plainTimesEqual,
  },
  {
    codecId: 'sqlite/time-temporal@1',
    label: 'last millisecond of the day',
    value: Temporal.PlainTime.from('23:59:59.999'),
    storageType: 'TEXT',
    valueEquality: plainTimesEqual,
    projectionEquality: plainTimesEqual,
  },
  // The `*-string` codecs' application value is the text their data type stores, which a row and a
  // projection both carry as it is.
  {
    codecId: 'sqlite/datetime-string@1',
    label: 'instant with milliseconds',
    value: '2026-01-02T03:04:05.678Z',
    storageType: 'TEXT',
  },
  {
    codecId: 'sqlite/datetime-string@1',
    label: 'instant on a whole second',
    value: '2026-01-02T03:04:05.000Z',
    storageType: 'TEXT',
  },
  {
    codecId: 'sqlite/datetime-string@1',
    label: 'instant past the year 9999',
    value: '+012026-01-02T03:04:05.678Z',
    storageType: 'TEXT',
  },
  { codecId: 'sqlite/date-string@1', label: 'leap day', value: '2024-02-29', storageType: 'TEXT' },
  {
    codecId: 'sqlite/date-string@1',
    label: 'earliest date SQLite reads',
    value: '0000-01-01',
    storageType: 'TEXT',
  },
  {
    codecId: 'sqlite/date-string@1',
    label: 'latest date SQLite reads',
    value: '9999-12-31',
    storageType: 'TEXT',
  },
  {
    codecId: 'sqlite/time-string@1',
    label: 'time of day with milliseconds',
    value: '03:04:05.678',
    storageType: 'TEXT',
  },
  {
    codecId: 'sqlite/time-string@1',
    label: 'midnight',
    value: '00:00:00.000',
    storageType: 'TEXT',
  },
  {
    codecId: 'sqlite/time-string@1',
    label: 'last millisecond of the day',
    value: '23:59:59.999',
    storageType: 'TEXT',
  },
  // A duration is stored as written, so a component of every unit and a sign on each component
  // must come back as they went.
  {
    codecId: 'sqlite/duration-string@1',
    label: 'hours and minutes',
    value: 'PT1H30M',
    storageType: 'TEXT',
  },
  {
    codecId: 'sqlite/duration-string@1',
    label: 'every component',
    value: 'P1Y2M3DT4H5M6.5S',
    storageType: 'TEXT',
  },
  { codecId: 'sqlite/duration-string@1', label: 'negative', value: '-P1D', storageType: 'TEXT' },
  {
    codecId: 'sqlite/duration-string@1',
    label: 'a sign on each component',
    value: 'P1M-1DT-1H',
    storageType: 'TEXT',
  },
  { codecId: 'sqlite/duration-string@1', label: 'zero', value: 'PT0S', storageType: 'TEXT' },
  // Every column can be NULL, and no `value` denotes it: NULL is a state of the
  // column rather than something a codec can be handed. Most codecs reject
  // `null`; the JSON codecs accept it, but there `value: null` means a JSON
  // `null` document stored in the column, not an empty column. A NULL case
  // stores SQL NULL and requires the projection to carry absence through as
  // absence — the dimension that let an assembled projection report an absent
  // value as a present one.
  {
    codecId: 'sql/char@1',
    label: 'null',
    value: undefined,
    storageType: 'TEXT',
    nullValue: true,
  },
  {
    codecId: 'sql/float@1',
    label: 'null',
    value: undefined,
    storageType: 'REAL',
    nullValue: true,
  },
  {
    codecId: 'sql/int@1',
    label: 'null',
    value: undefined,
    storageType: 'INTEGER',
    nullValue: true,
  },
  {
    codecId: 'sql/varchar@1',
    label: 'null',
    value: undefined,
    storageType: 'TEXT',
    nullValue: true,
  },
  {
    codecId: 'sqlite/bigint@1',
    label: 'null',
    value: undefined,
    storageType: 'INTEGER',
    nullValue: true,
  },
  {
    codecId: 'sqlite/bigintnumber@1',
    label: 'null',
    value: undefined,
    storageType: 'INTEGER',
    nullValue: true,
  },
  {
    codecId: 'sqlite/blob@1',
    label: 'null',
    value: undefined,
    storageType: 'BLOB',
    nullValue: true,
  },
  {
    codecId: 'sql/raw@1',
    typeParams: { sql: 'geometry' },
    label: 'null',
    value: undefined,
    storageType: 'geometry',
    nullValue: true,
  },
  {
    codecId: 'sqlite/datetime@1',
    label: 'null',
    value: undefined,
    storageType: 'TEXT',
    nullValue: true,
  },
  {
    codecId: 'sqlite/date-string@1',
    label: 'null',
    value: undefined,
    storageType: 'TEXT',
    nullValue: true,
  },
  {
    codecId: 'sqlite/date-temporal@1',
    label: 'null',
    value: undefined,
    storageType: 'TEXT',
    nullValue: true,
  },
  {
    codecId: 'sqlite/datetime-string@1',
    label: 'null',
    value: undefined,
    storageType: 'TEXT',
    nullValue: true,
  },
  {
    codecId: 'sqlite/datetime-temporal@1',
    label: 'null',
    value: undefined,
    storageType: 'TEXT',
    nullValue: true,
  },
  {
    codecId: 'sqlite/duration-string@1',
    label: 'null',
    value: undefined,
    storageType: 'TEXT',
    nullValue: true,
  },
  {
    codecId: 'sqlite/time-string@1',
    label: 'null',
    value: undefined,
    storageType: 'TEXT',
    nullValue: true,
  },
  {
    codecId: 'sqlite/time-temporal@1',
    label: 'null',
    value: undefined,
    storageType: 'TEXT',
    nullValue: true,
  },
  {
    codecId: 'sqlite/integer@1',
    label: 'null',
    value: undefined,
    storageType: 'INTEGER',
    nullValue: true,
  },
  {
    codecId: 'sqlite/json@1',
    label: 'null',
    value: undefined,
    storageType: 'TEXT',
    nullValue: true,
  },
  {
    codecId: 'sqlite/real@1',
    label: 'null',
    value: undefined,
    storageType: 'REAL',
    nullValue: true,
  },
  {
    codecId: 'sqlite/text@1',
    label: 'null',
    value: undefined,
    storageType: 'TEXT',
    nullValue: true,
  },
];
