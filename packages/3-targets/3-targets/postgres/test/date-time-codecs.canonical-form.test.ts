import type { JsonValue } from '@internal/contract/types';
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import { pgIntervalDescriptor, pgTimetzDescriptor } from '../src/core/codecs';
import { pgTimestamptzDateDescriptor } from '../src/core/date-codecs';
import {
  pgDateTemporalDescriptor,
  pgTimestampTemporalDescriptor,
  pgTimestamptzTemporalDescriptor,
  pgTimeTemporalDescriptor,
} from '../src/core/temporal-codecs';
import {
  pgDateStringDescriptor,
  pgTimeStringDescriptor,
  pgTimestampStringDescriptor,
  pgTimestamptzStringDescriptor,
} from '../src/core/temporal-string-codecs';

const ctx = { name: '<test>' };
const instantTemporal = pgTimestamptzTemporalDescriptor.factory({})(ctx);
const instantDate = pgTimestamptzDateDescriptor.factory({})(ctx);
const instantString = pgTimestamptzStringDescriptor.factory({})(ctx);
const dateTimeTemporal = pgTimestampTemporalDescriptor.factory({})(ctx);
const dateTimeString = pgTimestampStringDescriptor.factory({})(ctx);
const dateTemporal = pgDateTemporalDescriptor.factory()(ctx);
const dateString = pgDateStringDescriptor.factory()(ctx);
const timeTemporal = pgTimeTemporalDescriptor.factory({})(ctx);
const timeString = pgTimeStringDescriptor.factory({})(ctx);
const timetz = pgTimetzDescriptor.factory({})(ctx);
const interval = pgIntervalDescriptor.factory({})(ctx);

describe('every codec of a date or time type writes one text for one value', () => {
  it.each<readonly [string, string, readonly JsonValue[]]>([
    [
      'pg/timestamptz',
      '2024-01-01T00:00:00.5Z',
      [
        instantTemporal.encodeJson(Temporal.Instant.from('2024-01-01T01:00:00.500+01:00')),
        instantDate.encodeJson(new Date('2024-01-01T00:00:00.500Z')),
        instantString.encodeJson('2024-01-01 00:00:00.5+00'),
      ],
    ],
    [
      'pg/timestamptz before year 1',
      '-000043-03-15T00:00:00Z',
      [
        instantTemporal.encodeJson(Temporal.Instant.from('-000043-03-15T00:00:00Z')),
        instantDate.encodeJson(new Date('-000043-03-15T00:00:00.000Z')),
        instantString.encodeJson('0044-03-15 00:00:00+00 BC'),
      ],
    ],
    [
      'pg/timestamp',
      '2024-01-01T12:34:56.5',
      [
        dateTimeTemporal.encodeJson(Temporal.PlainDateTime.from('2024-01-01T12:34:56.5')),
        dateTimeString.encodeJson('2024-01-01 12:34:56.500'),
      ],
    ],
    [
      'pg/date',
      '2024-01-01',
      [
        dateTemporal.encodeJson(Temporal.PlainDate.from('2024-01-01')),
        dateString.encodeJson('2024-01-01'),
      ],
    ],
    [
      'pg/date before year 1',
      '-000043-03-15',
      [
        dateTemporal.encodeJson(Temporal.PlainDate.from('-000043-03-15')),
        dateString.encodeJson('0044-03-15 BC'),
      ],
    ],
    [
      'pg/time',
      '12:34:56.5',
      [
        timeTemporal.encodeJson(Temporal.PlainTime.from('12:34:56.5')),
        timeString.encodeJson('12:34:56.500000'),
      ],
    ],
    ['pg/timetz', '12:34:56+02:00', [timetz.encodeJson('12:34:56+02')]],
    [
      'pg/interval',
      'P1Y2M3DT4H5M6.5S',
      [interval.encodeJson({ months: 14, days: 3, micros: 14_706_500_000n })],
    ],
  ])('%s: every codec writes %s', (_type, standard, written) => {
    expect(written).toEqual(written.map(() => standard));
  });
});

describe('a codec still reads the text a contract held before the standard text', () => {
  it('pg/timestamptz-temporal@1 reads a millisecond instant', () => {
    expect(instantTemporal.decodeJson('2024-01-01T00:00:00.000Z').toString()).toBe(
      '2024-01-01T00:00:00Z',
    );
  });

  it('pg/timestamp-string@1 reads a timestamp written with a space', () => {
    expect(dateTimeString.decodeJson('2024-01-01 00:00:00')).toBe('2024-01-01 00:00:00');
  });

  it('pg/timetz@1 reads an offset written in hours', () => {
    expect(timetz.decodeJson('12:34:56+02')).toBe('12:34:56+02');
  });
});
