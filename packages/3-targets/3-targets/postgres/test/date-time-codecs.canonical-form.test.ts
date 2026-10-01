import type { JsonValue } from '@internal/contract/types';
import { type Codec, createDataTypeLookup } from '@internal/framework-components/codec';
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';
import { postgresDataTypes } from '../src/core/data-types';
import { pgTimestamptzTemporalDescriptor } from '../src/core/temporal-codecs';

const dataTypes = createDataTypeLookup(postgresDataTypes);

/** Every codec of a type that declares a canonical form, found in the target's codec registry. */
const codecsWithCanonicalForm = codecDescriptors.flatMap((descriptor) =>
  dataTypes.get(descriptor.dataType)?.toCanonicalForm === undefined
    ? []
    : [
        {
          codecId: descriptor.codecId,
          dataType: descriptor.dataType,
          codec: descriptor.factory({} as never)({ name: '<test>' }) as Codec,
        },
      ],
);

/** Values in canonical form that every codec of the type holds. */
const everyCodecHolds: Readonly<Record<string, readonly string[]>> = {
  'pg/timestamptz': [
    '2024-01-01T00:00:00Z',
    '2024-01-01T00:00:00.5Z',
    '-000043-03-15T00:00:00Z',
    '+012026-01-02T03:04:05Z',
  ],
  'pg/timestamp': ['2024-01-01T12:34:56.5', '-000043-03-15T00:00:00'],
  'pg/date': ['2024-01-01', '-000043-03-15'],
  'pg/time': ['12:34:56.123456', '00:00:00'],
  'pg/timetz': ['12:34:56+02:00', '12:34:56Z'],
  'pg/interval': ['P1Y2M3DT4H5M6.5S', 'PT0S'],
  'pg/int8': ['0', '-1', '9007199254740991'],
};

/** Values in canonical form that only some codecs of the type hold. */
const someCodecsHold: Readonly<Record<string, readonly string[]>> = {
  'pg/timestamptz': ['infinity', '-infinity'],
  'pg/timestamp': ['infinity'],
  'pg/date': ['-infinity'],
};

/** The codecs that hold `infinity` and `-infinity`: those whose value is PostgreSQL's own text. */
const holdsInfinity: ReadonlySet<string> = new Set([
  'pg/date-string@1',
  'pg/timestamp-string@1',
  'pg/timestamptz-string@1',
]);

/**
 * The codecs that refuse to read a value with a digit below one microsecond: one whose value cannot
 * carry it, and those whose value is PostgreSQL's own text, which PostgreSQL never writes with one.
 */
const refusesToReadBelowMicroseconds: ReadonlySet<string> = new Set([
  'pg/timestamptz-date@1',
  'pg/timestamp-string@1',
  'pg/timestamptz-string@1',
  'pg/time-string@1',
  'pg/timetz@1',
]);

/** Text with a digit below one microsecond, which no type holds. */
const belowMicroseconds: Readonly<Record<string, string>> = {
  'pg/timestamptz': '2024-01-01T00:00:00.123456789Z',
  'pg/timestamp': '2024-01-01T00:00:00.1234567',
  'pg/time': '12:00:00.1234567',
  'pg/timetz': '12:00:00.1234567+02:00',
};

function decoded(codec: Codec, json: JsonValue): { readonly value: unknown } | undefined {
  try {
    return { value: codec.decodeJson(json) };
  } catch {
    return undefined;
  }
}

describe('every codec of a type with a canonical form writes it', () => {
  it('finds a codec for every type the tables cover, and a table for every such type', () => {
    expect(new Set(codecsWithCanonicalForm.map(({ dataType }) => dataType))).toEqual(
      new Set(Object.keys(everyCodecHolds)),
    );
  });

  describe.each(codecsWithCanonicalForm)('$codecId', ({ codecId, codec, dataType }) => {
    it.each(everyCodecHolds[dataType] ?? [])('writes %s back as it read it', (canonical) => {
      expect(codec.encodeJson(codec.decodeJson(canonical))).toBe(canonical);
    });

    it.each(someCodecsHold[dataType] ?? [])(
      'writes %s back as it read it if it holds it, and otherwise refuses to read it',
      (canonical) => {
        const read = decoded(codec, canonical);
        expect(read === undefined ? 'refused' : codec.encodeJson(read.value)).toBe(
          holdsInfinity.has(codecId) ? canonical : 'refused',
        );
      },
    );

    const tooPrecise = belowMicroseconds[dataType];
    it.runIf(tooPrecise !== undefined && refusesToReadBelowMicroseconds.has(codecId))(
      'refuses to read a value with a digit below one microsecond',
      () => {
        expect(decoded(codec, tooPrecise ?? '')).toBeUndefined();
      },
    );

    it.runIf(tooPrecise !== undefined && !refusesToReadBelowMicroseconds.has(codecId))(
      'refuses to write a value with a digit below one microsecond, rather than rounding it',
      () => {
        expect(() => codec.encodeJson(codec.decodeJson(tooPrecise ?? ''))).toThrow(
          expect.objectContaining({
            code: 'CONTRACT.CAST_REFUSED',
            message: expect.stringContaining(`${dataType} holds microseconds`),
          }),
        );
      },
    );
  });

  it('refuses a Temporal.Instant with nanoseconds', () => {
    const codec = pgTimestamptzTemporalDescriptor.factory({})({ name: '<test>' });
    expect(() => codec.encodeJson(Temporal.Instant.from('2024-01-01T00:00:00.123456789Z'))).toThrow(
      expect.objectContaining({
        message:
          '"2024-01-01T00:00:00.123456789Z" has 9 digits after the decimal point, but pg/timestamptz holds microseconds, so at most 6. Round it, as in "2024-01-01T12:34:56.123456Z".',
      }),
    );
  });
});

describe('a codec still reads the text a contract held before the canonical form', () => {
  const codecOf = (codecId: string): Codec => {
    const found = codecsWithCanonicalForm.find((entry) => entry.codecId === codecId);
    if (found === undefined) throw new Error(`no codec ${codecId}`);
    return found.codec;
  };

  it('pg/timestamptz-temporal@1 reads a millisecond instant', () => {
    expect(
      String(codecOf('pg/timestamptz-temporal@1').decodeJson('2024-01-01T00:00:00.000Z')),
    ).toBe('2024-01-01T00:00:00Z');
  });

  it('pg/timestamp-string@1 reads a timestamp written with a space', () => {
    expect(codecOf('pg/timestamp-string@1').decodeJson('2024-01-01 00:00:00')).toBe(
      '2024-01-01 00:00:00',
    );
  });

  it('pg/timetz@1 reads an offset written in hours', () => {
    expect(codecOf('pg/timetz@1').decodeJson('12:34:56+02')).toBe('12:34:56+02');
  });
});
