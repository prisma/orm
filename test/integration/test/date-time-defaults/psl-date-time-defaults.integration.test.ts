import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { authorSqlContractFromPsl, findStorageColumn } from '../scalar-lists/psl-list-authoring';
import { authorSqliteContractFromPsl } from './sqlite-authoring';

async function postgresDefaults(schema: string, columns: readonly string[]) {
  const authored = await authorSqlContractFromPsl(schema);
  expect(authored.diagnostics).toEqual([]);
  const contract = authored.contract;
  if (contract === undefined) throw new Error('authoring produced no contract');
  return Object.fromEntries(
    columns.map((column) => [column, findStorageColumn(contract, column)?.['default']]),
  );
}

const literal = (value: unknown) => ({ kind: 'literal', value });

/** The tag that writes a value of each Postgres column type these tests use. */
const TAG_OF: Readonly<Record<string, string>> = {
  TimestamptzTemporal: 'timestamptz',
  TimestampTemporal: 'timestamp',
  DateTemporal: 'date',
  TimeTemporal: 'time',
  Timetz: 'timetz',
};

describe('a PSL date or time default is stored in its data type canonical form', () => {
  it('stores one text for three texts of one instant', async () => {
    expect(
      await postgresDefaults(
        `model Event {
  id Int      @id
  a  TimestamptzTemporal @default(timestamptz\`2024-01-01T00:00:00Z\`)
  b  TimestamptzTemporal @default(timestamptz\`2024-01-01T00:00:00.000Z\`)
  c  TimestamptzTemporal @default(timestamptz\`2024-01-01T01:00:00+01:00\`)
}`,
        ['a', 'b', 'c'],
      ),
    ).toEqual({
      a: literal('2024-01-01T00:00:00Z'),
      b: literal('2024-01-01T00:00:00Z'),
      c: literal('2024-01-01T00:00:00Z'),
    });
  });

  it('stores the canonical form of a default written in another form, for each Postgres date and time type', async () => {
    expect(
      await postgresDefaults(
        `model Event {
  id        Int                @id
  instant   TimestamptzTemporal(3)     @default(timestamptz\`2024-01-01 01:00:00+01\`)
  jsDate    TimestamptzJsDate  @default(timestamptz\`2024-01-01 00:00:00.500+00\`)
  local     TimestampTemporal          @default(timestamp\`2024-01-01 12:34:56.500\`)
  localText TimestampString    @default(timestamp\`2024-01-01 12:34:56\`)
  day       DateTemporal               @default(date\`0044-03-15 BC\`)
  dayText   DateString         @default(date\`12026-01-02\`)
  clock     TimeTemporal               @default(time\`12:34\`)
  zoned     Timetz             @default(timetz\`12:34:56+02\`)
  history   TimestampTemporal(3)[]     @default([timestamp\`2024-01-01 00:00:00\`, timestamp\`2024-06-30 12:34:56.789000\`])
}`,
        ['instant', 'jsDate', 'local', 'localText', 'day', 'dayText', 'clock', 'zoned', 'history'],
      ),
    ).toEqual({
      instant: literal('2024-01-01T00:00:00Z'),
      jsDate: literal('2024-01-01T00:00:00.5Z'),
      local: literal('2024-01-01T12:34:56.5'),
      localText: literal('2024-01-01T12:34:56'),
      day: literal('-000043-03-15'),
      dayText: literal('+012026-01-02'),
      clock: literal('12:34:00'),
      zoned: literal('12:34:56+02:00'),
      history: literal(['2024-01-01T00:00:00', '2024-06-30T12:34:56.789']),
    });
  });

  it('stores the canonical form of a SQLite DateTime default', async () => {
    const result = await authorSqliteContractFromPsl(
      'model Event {\n  id Int @id\n  at DateTime @default(datetime`2024-01-01 01:00:00+01:00`)\n}',
    );
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    const contract = result.value as Contract<SqlStorage>;
    expect(findStorageColumn(contract, 'at')?.['default']).toEqual(
      literal('2024-01-01T00:00:00.000Z'),
    );
  });

  it.each([
    [
      'TimestampTemporal',
      '2024-01-01T00:00:00Z',
      'pg/timestamp holds no UTC offset, but "2024-01-01T00:00:00Z" has one. Leave it out, as in "2024-01-01T12:34:56".',
    ],
    [
      'TimestamptzTemporal',
      '2024-01-01 00:00:00',
      'pg/timestamptz needs a UTC offset, but "2024-01-01 00:00:00" has none. Add Z for UTC or an offset such as +02:00, as in "2024-01-01T12:34:56Z".',
    ],
    [
      'DateTemporal',
      '2024-02-30',
      '"2024-02-30" is not a date that exists. Write a real date, as in "2024-01-01".',
    ],
    [
      'TimeTemporal',
      '25:00:00',
      '"25:00:00" is not a time of day that exists: hours run from 00 to 23, and minutes and seconds from 00 to 59. Write one, as in "12:34:56".',
    ],
    [
      'Timetz',
      '12:34:56',
      'pg/timetz needs a UTC offset, but "12:34:56" has none. Add Z for UTC or an offset such as +02:00, as in "12:34:56+02:00".',
    ],
    [
      'TimestamptzTemporal',
      '2024-01-01T00:00:00.1234567Z',
      '"2024-01-01T00:00:00.1234567Z" has 7 digits after the decimal point, but pg/timestamptz holds microseconds, so at most 6. Round it, as in "2024-01-01T12:34:56.123456Z".',
    ],
  ])('refuses a %s default written %s', async (type, written, message) => {
    const result = await authorSqlContractFromPsl(
      `model Event {\n  id Int @id\n  at ${type} @default(${TAG_OF[type]}\`${written}\`)\n}`,
    );
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_LITERAL',
        message: `Field "Event.at": ${message}`,
      }),
    ]);
  });

  it('refuses a SQLite DateTime default with no UTC offset', async () => {
    const result = await authorSqliteContractFromPsl(
      'model Event {\n  id Int @id\n  at DateTime @default(datetime`2024-01-01 00:00:00`)\n}',
    );
    expect(result.ok ? [] : result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_LITERAL',
        message:
          'Field "Event.at": sqlite/datetime needs a UTC offset, but "2024-01-01 00:00:00" has none. Add Z for UTC or an offset such as +02:00, as in "2024-01-01T12:34:56Z".',
      }),
    ]);
  });

  it('refuses a SQLite DateTime default with more digits than milliseconds', async () => {
    const result = await authorSqliteContractFromPsl(
      'model Event {\n  id Int @id\n  at DateTime @default(datetime`2024-01-01T00:00:00.1234Z`)\n}',
    );
    expect(result.ok ? [] : result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_LITERAL',
        message:
          'Field "Event.at": "2024-01-01T00:00:00.1234Z" has 4 digits after the decimal point, but sqlite/datetime holds milliseconds, so at most 3. Round it, as in "2024-01-01T12:34:56.123Z".',
      }),
    ]);
  });
});

describe('a quoted string on a Postgres date, time, interval or bytes column', () => {
  it.each([
    ['TimestamptzTemporal', '2024-01-01T00:00:00Z', 'timestamptz'],
    ['TimestampTemporal', '2024-01-01 12:34:56', 'timestamp'],
    ['DateTemporal', '2024-01-01', 'date'],
    ['TimeTemporal', '12:34:56', 'time'],
    ['Timetz', '12:34:56+02:00', 'timetz'],
    ['IntervalParts', 'P1D', 'interval'],
    ['Bytes', '\\x68656c6c6f', 'bytea'],
  ])('on a %s column is refused, showing the tag to write', async (type, written, tag) => {
    const result = await authorSqlContractFromPsl(
      `model Event {\n  id Int @id\n  at ${type} @default("${written.replaceAll('\\', '\\\\')}")\n}`,
    );
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: expect.stringContaining(`write ${tag}\`${written}\``),
      }),
    ]);
  });

  it('stores an interval and bytes written with their tags', async () => {
    expect(
      await postgresDefaults(
        `model Event {
  id    Int      @id
  span  IntervalParts @default(interval\`1 day 02:00:00\`)
  bytes Bytes    @default(bytea\`\\x68656c6c6f\`)
}`,
        ['span', 'bytes'],
      ),
    ).toEqual({ span: literal('P1DT2H'), bytes: literal('aGVsbG8=') });
  });
});

describe('infinity on a column whose codec holds a Temporal value or a Date', () => {
  it.each([
    ['TimestamptzTemporal', 'timestamptz', 'pg/timestamptz-temporal@1', 'pg/timestamptz-string@1'],
    ['TimestamptzJsDate', 'timestamptz', 'pg/timestamptz-date@1', 'pg/timestamptz-string@1'],
    ['DateTemporal', 'date', 'pg/date-temporal@1', 'pg/date-string@1'],
  ])(
    'is refused on a %s column, naming the text codec that holds it',
    async (type, tag, codecId, textCodecId) => {
      const result = await authorSqlContractFromPsl(
        `model Event {\n  id Int @id\n  at ${type} @default(${tag}\`infinity\`)\n}`,
      );
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_LITERAL',
          message: expect.stringContaining(codecId),
        }),
      ]);
      expect(result.diagnostics[0]?.message).toContain(textCodecId);
    },
  );

  it('is stored on a column whose codec holds text', async () => {
    expect(
      await postgresDefaults(
        'model Event {\n  id Int @id\n  at TimestamptzString @default(timestamptz`infinity`)\n}',
        ['at'],
      ),
    ).toEqual({ at: literal('infinity') });
  });
});
