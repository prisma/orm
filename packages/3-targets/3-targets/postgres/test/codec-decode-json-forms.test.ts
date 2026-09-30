import type { JsonValue } from '@internal/contract/types';
import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  pgBitDescriptor,
  pgBoolDescriptor,
  pgCharDescriptor,
  pgEnumDescriptor,
  pgFloat4Descriptor,
  pgFloat8Descriptor,
  pgFloatDescriptor,
  pgInetDescriptor,
  pgInt2Descriptor,
  pgInt4Descriptor,
  pgIntDescriptor,
  pgNumericDescriptor,
  pgTextArrayDescriptor,
  pgTextDescriptor,
  pgTimetzDescriptor,
  pgTsqueryDescriptor,
  pgUuidDescriptor,
  pgVarbitDescriptor,
  pgVarcharDescriptor,
  postgresSqlCharDescriptor,
  postgresSqlIntDescriptor,
  postgresSqlVarcharDescriptor,
} from '../src/core/codecs';
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

const ctx: CodecInstanceContext = { name: 'decode-json-forms' };

interface DecodeJsonCase {
  readonly codec: { readonly id: string; decodeJson(json: JsonValue): unknown };
  /** The JSON PostgreSQL produces for the type (`to_json`, `json_agg`) and the codec's own `encodeJson` output. */
  readonly accepts: readonly JsonValue[];
  readonly rejects: readonly JsonValue[];
}

// The accepted forms are what PostgreSQL 17 (PGlite) wrote for each type, recorded with `to_json`, `json_build_object` and `json_agg`.
const cases: readonly DecodeJsonCase[] = [
  {
    codec: pgTextDescriptor.factory()(ctx),
    accepts: ['hello', ''],
    rejects: [1, true, null, [], {}],
  },
  {
    codec: pgEnumDescriptor.factory({ typeName: 'mood' })(ctx),
    accepts: ['happy'],
    rejects: [1, false, null],
  },
  {
    codec: pgInt4Descriptor.factory()(ctx),
    accepts: [42, -2147483648, 2147483647, 0],
    rejects: ['42', 1.5, 2147483648, -2147483649, true, null],
  },
  {
    codec: pgInt2Descriptor.factory()(ctx),
    accepts: [7, -32768, 32767],
    rejects: ['7', 1.5, 32768, -32769, null],
  },
  ...[pgFloat8Descriptor, pgFloat4Descriptor, pgFloatDescriptor].map((descriptor) => ({
    codec: descriptor.factory()(ctx),
    accepts: [1.5, -2, 0, 'NaN', 'Infinity', '-Infinity'],
    rejects: ['1.5', 'nan', true, null, []],
  })),
  {
    codec: pgFloat4Descriptor.factory()(ctx),
    accepts: [3.4e38, -3.4e38, 1e-40, -0],
    rejects: [1e300, 3.5e38, -3.5e38, 1e-50],
  },
  {
    codec: postgresSqlIntDescriptor.factory()(ctx),
    accepts: [2147483647, -2147483648],
    rejects: [2147483648, 3000000000, -2147483649],
  },
  ...[pgCharDescriptor, postgresSqlCharDescriptor].flatMap((descriptor) => [
    {
      codec: descriptor.factory({ length: 3 })(ctx),
      accepts: ['abc', 'ab', 'abc  ', '\u{1F600}\u{1F600}\u{1F600}'],
      rejects: ['abcd', ' abc', 1, null],
    },
    { codec: descriptor.factory({})(ctx), accepts: ['a', 'a  ', ''], rejects: ['ab'] },
  ]),
  ...[pgVarcharDescriptor, postgresSqlVarcharDescriptor].flatMap((descriptor) => [
    {
      codec: descriptor.factory({ length: 3 })(ctx),
      accepts: ['abc', '', '\u{1F600}\u{1F600}\u{1F600}'],
      rejects: ['abcd', 'abc ', 1, null],
    },
    { codec: descriptor.factory({})(ctx), accepts: ['a'.repeat(1000)], rejects: [1] },
  ]),
  {
    codec: pgBoolDescriptor.factory()(ctx),
    accepts: [true, false],
    rejects: ['true', 1, 0, null],
  },
  {
    codec: pgBitDescriptor.factory({})(ctx),
    accepts: ['1', '0'],
    rejects: [1, '2', 'a', '01', '', null],
  },
  {
    codec: pgBitDescriptor.factory({ length: 4 })(ctx),
    accepts: ['1010'],
    rejects: ['101', '10101'],
  },
  {
    codec: pgVarbitDescriptor.factory({ length: 4 })(ctx),
    accepts: ['1010', '1', ''],
    rejects: ['10101'],
  },
  {
    codec: pgNumericDescriptor.factory({ precision: 5, scale: 2 })(ctx),
    accepts: ['123.45', '-999.99', '1.5', '1.50', '0', '0.01', 'NaN'],
    rejects: ['1234.5', '1000', '1.555', '0.001', 'Infinity', '-Infinity', '1e3', '+1', 'abc'],
  },
  {
    codec: pgNumericDescriptor.factory({ precision: 3 })(ctx),
    accepts: ['999', '-999', '007'],
    rejects: ['1000', '1.5'],
  },
  {
    codec: pgNumericDescriptor.factory({})(ctx),
    accepts: ['123456789012345678901234567890.123', 'Infinity', 'NaN'],
    rejects: ['1e3', 'abc', ''],
  },
  {
    codec: pgIntDescriptor.factory()(ctx),
    accepts: [2147483647, -2147483648],
    rejects: [2147483648, 3000000000, -2147483649],
  },
  {
    codec: pgVarbitDescriptor.factory({})(ctx),
    accepts: ['1010', ''],
    rejects: [1010, '10a1', null],
  },
  {
    codec: pgUuidDescriptor.factory()(ctx),
    accepts: ['123e4567-e89b-12d3-a456-426614174000'],
    rejects: [
      1,
      'not-a-uuid',
      '123e4567-e89b-12d3-a456-42661417400',
      '123E4567-E89B-12D3-A456-426614174000',
      '123e4567e89b12d3a456426614174000',
      '{123e4567-e89b-12d3-a456-426614174000}',
      '123e-4567-e89b-12d3-a456-4266-1417-4000',
      null,
    ],
  },
  {
    codec: pgInetDescriptor.factory()(ctx),
    accepts: ['192.168.0.1', '::1', '10.0.0.0/8'],
    rejects: [192, null],
  },
  {
    codec: pgTsqueryDescriptor.factory()(ctx),
    accepts: ["'zebra' & !'graze'"],
    rejects: [1, null],
  },
  {
    codec: pgTextArrayDescriptor.factory()(ctx),
    accepts: [['a', 'b'], [], ['a', null]],
    rejects: ['a', [1], [true], null, {}],
  },
  // The date and time codecs that carry PostgreSQL's own text take the canonical form their `encodeJson` writes and
  // what PostgreSQL writes for the type as text and as JSON: `::text` and `to_json` under the ISO DateStyle, in the
  // time zones UTC, Europe/Amsterdam, Asia/Kolkata and America/St_Johns, at each precision from 0 to 6. PostgreSQL holds
  // years the canonical form does not, and `24:00:00` as a time of day.
  {
    codec: pgDateStringDescriptor.factory()(ctx),
    accepts: [
      '2026-01-02',
      '0044-03-15 BC',
      '4713-11-24 BC',
      '0001-01-01 BC',
      '10000-01-01',
      '275760-09-13',
      '5874897-12-31',
      'infinity',
      '-infinity',
      '-000043-03-15',
      '0000-01-01',
      '+010000-01-01',
    ],
    rejects: [
      20260102,
      null,
      'not a date',
      '2024-02-30',
      '2024-13-01',
      '2024-1-1',
      '0000-01-01 BC',
      '-000043-03-15 BC',
      '2024-01-01 12:00:00',
      '12:00:00',
      'Infinity',
    ],
  },
  {
    codec: pgTimestampStringDescriptor.factory({})(ctx),
    accepts: [
      '2026-01-02 03:04:05.123456',
      '2024-01-01T12:00:00',
      '2024-01-01 12:34:56',
      '2024-01-01 12:34:56.1',
      '2024-01-01T12:34:56.12',
      '2024-01-01 12:34:56.123',
      '2024-01-01 12:34:56.1235',
      '2024-01-01 12:34:56.12346',
      '0044-03-15 12:00:00 BC',
      '0044-03-15T12:00:00 BC',
      '4713-11-24 00:00:00 BC',
      '10000-01-01 00:00:00',
      '294276-12-31 23:59:59',
      '294276-12-31T23:59:59',
      'infinity',
      '-infinity',
      '-000043-03-15T12:00:00',
      '+010000-01-01T00:00:00',
      '2024-01-01T12:34:56.5',
    ],
    rejects: [
      1,
      null,
      'not a date',
      '2024-01-01',
      '2024-01-01 12:00:00+00',
      '2024-01-01 24:00:00',
      '2024-02-30 12:00:00',
      '2024-01-01 12:00',
      '2024-01-01 12:00:00.1234567',
    ],
  },
  {
    codec: pgTimestamptzStringDescriptor.factory({})(ctx),
    accepts: [
      '2026-01-02 03:04:05.123456+00',
      '2024-01-01T12:00:00+00:00',
      '2024-01-01 13:00:00+01',
      '2024-01-01T13:00:00+01:00',
      '2024-01-01 17:30:00+05:30',
      '2024-01-01T09:04:56.1-03:30',
      '1800-01-01 00:17:30+00:17:30',
      '1800-01-01T00:17:30+00:17:30',
      '1799-12-31 20:29:08-03:30:52',
      '0044-03-15 12:00:00+00 BC',
      '0044-03-15T08:29:08-03:30:52 BC',
      '294277-01-01 00:59:59+01',
      '294277-01-01T05:29:59+05:30',
      'infinity',
      '-infinity',
      '2024-01-01T12:00:00Z',
      '-000043-03-15T12:00:00Z',
    ],
    rejects: [
      1,
      null,
      'not a date',
      '2024-01-01 12:00:00',
      '2024-01-01',
      '2024-02-30 12:00:00+00',
      '2024-01-01 12:00:00+16',
    ],
  },
  {
    codec: pgTimeStringDescriptor.factory({})(ctx),
    accepts: [
      '03:04:05.123456',
      '00:00:00',
      '12:34:56',
      '24:00:00',
      '23:59:59.999999',
      '12:34:56.1',
      '12:34:56.12',
      '12:34:56.123',
      '12:34:56.1235',
      '12:34:56.12346',
      '12:00:00.5',
    ],
    rejects: [
      1,
      null,
      'noon',
      '25:00:00',
      '24:00:00.5',
      '24:00:01',
      '12:60:00',
      '12:00',
      '12:00:00+00',
      '2024-01-01 12:00:00',
    ],
  },
  {
    codec: pgTimetzDescriptor.factory({})(ctx),
    accepts: [
      '03:04:05+02',
      '03:04:05+00',
      '12:00:00+01:30:15',
      '12:00:00-15:59',
      '12:00:00+15:59:59',
      '24:00:00+00',
      '12:34:56.5+05:45',
      '12:34:56.123456+02',
      '12:00:00Z',
      '12:00:00+02:00',
    ],
    rejects: [
      1,
      null,
      'noon',
      '12:00:00',
      '12:00:00+16:00',
      '25:00:00+00',
      '2024-01-01 12:00:00+00',
    ],
  },
  { codec: pgDateTemporalDescriptor.factory()(ctx), accepts: ['2026-01-02'], rejects: [1, null] },
  {
    codec: pgTimestampTemporalDescriptor.factory({})(ctx),
    accepts: ['2026-01-02 03:04:05.123456'],
    rejects: [1, null],
  },
  {
    codec: pgTimestamptzTemporalDescriptor.factory({})(ctx),
    accepts: ['2026-01-02 03:04:05.123456+00'],
    rejects: [1, null],
  },
  {
    codec: pgTimeTemporalDescriptor.factory({})(ctx),
    accepts: ['03:04:05.123456'],
    rejects: [1, null],
  },
];

describe('the float codecs write NaN and the infinities as the text PostgreSQL writes, and read them back', () => {
  for (const descriptor of [pgFloat8Descriptor, pgFloat4Descriptor, pgFloatDescriptor]) {
    it(descriptor.codecId, () => {
      const codec = descriptor.factory()(ctx);
      const values = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
      const stored = values.map((value) => codec.encodeJson(value));
      expect({ stored, read: stored.map((json) => codec.decodeJson(json)) }).toEqual({
        stored: ['NaN', 'Infinity', '-Infinity'],
        read: values,
      });
    });
  }
});

describe('pg/text-array@1 decodeJson', () => {
  it('keeps a NULL element as null', () => {
    expect(pgTextArrayDescriptor.factory()(ctx).decodeJson(['a', null, ''])).toEqual([
      'a',
      null,
      '',
    ]);
  });
});

describe('decodeJson reads the stored JSON form of its type and refuses any other', () => {
  for (const { codec, accepts, rejects } of cases) {
    it(`${codec.id} accepts ${JSON.stringify(accepts)}`, () => {
      for (const json of accepts) expect(() => codec.decodeJson(json)).not.toThrow();
    });

    it(`${codec.id} refuses ${JSON.stringify(rejects)}`, () => {
      for (const json of rejects) {
        expect(() => codec.decodeJson(json)).toThrow(
          expect.objectContaining({
            code: 'RUNTIME.DECODE_FAILED',
            meta: expect.objectContaining({ codecId: codec.id }),
          }),
        );
      }
    });
  }
});

describe('pg/uuid@1 encodeJson', () => {
  it('writes a UUID in the form PostgreSQL writes, which decodeJson reads', () => {
    const codec = pgUuidDescriptor.factory()(ctx);
    const written = [
      'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11',
      '{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}',
      'a0eebc999c0b4ef8bb6d6bb9bd380a11',
    ].map((value) => codec.encodeJson(value));
    expect(written.map((json) => codec.decodeJson(json))).toEqual([
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    ]);
  });
});

describe('the length and scale checks on a long run of padding', () => {
  const run = 50_000;

  it.each([
    [
      'pg/char@1 with a length',
      () => pgCharDescriptor.factory({ length: run + 1 })(ctx),
      `${' '.repeat(run)}x${' '.repeat(run - 1)}`,
    ],
    [
      'pg/numeric@1 with a scale',
      () => pgNumericDescriptor.factory({ precision: 5, scale: 2 })(ctx),
      `1.${'0'.repeat(run)}1${'0'.repeat(run - 1)}`,
    ],
  ])('%s decides in time linear in the length', (_name, build, json) => {
    const codec = build();
    const started = performance.now();
    let refused = false;
    try {
      codec.decodeJson(json);
    } catch {
      refused = true;
    }
    expect({ withinBound: performance.now() - started < timeouts.default, refused }).toEqual({
      withinBound: true,
      refused: _name.startsWith('pg/numeric'),
    });
  });
});

describe('the date and time codecs that carry PostgreSQL text read what they write', () => {
  it.each([
    ['pg/date-string@1', pgDateStringDescriptor.factory()(ctx), '0044-03-15 BC', '-000043-03-15'],
    [
      'pg/timestamp-string@1',
      pgTimestampStringDescriptor.factory({})(ctx),
      '2024-01-01 12:34:56.500',
      '2024-01-01T12:34:56.5',
    ],
    [
      'pg/timestamptz-string@1',
      pgTimestamptzStringDescriptor.factory({})(ctx),
      '2024-01-01 01:00:00+01',
      '2024-01-01T00:00:00Z',
    ],
    ['pg/time-string@1', pgTimeStringDescriptor.factory({})(ctx), '12:34', '12:34:00'],
    ['pg/timetz@1', pgTimetzDescriptor.factory({})(ctx), '12:34:56+02', '12:34:56+02:00'],
  ])('%s stores %s as %s and reads that text back unchanged', (_id, codec, value, stored) => {
    const json = codec.encodeJson(value);
    expect({ json, read: codec.decodeJson(json) }).toEqual({ json: stored, read: stored });
  });
});
