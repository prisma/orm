import type { JsonValue } from '@internal/contract/types';
import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  pgBitDescriptor,
  pgBoolDescriptor,
  pgEnumDescriptor,
  pgInetDescriptor,
  pgInt2Descriptor,
  pgInt4Descriptor,
  pgTextArrayDescriptor,
  pgTextDescriptor,
  pgTimetzDescriptor,
  pgTsqueryDescriptor,
  pgUuidDescriptor,
  pgVarbitDescriptor,
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
  {
    codec: pgBoolDescriptor.factory()(ctx),
    accepts: [true, false],
    rejects: ['true', 1, 0, null],
  },
  { codec: pgTimetzDescriptor.factory({})(ctx), accepts: ['03:04:05+02'], rejects: [1, null] },
  { codec: pgBitDescriptor.factory({})(ctx), accepts: ['1', '0'], rejects: [1, '2', 'a', null] },
  {
    codec: pgVarbitDescriptor.factory({})(ctx),
    accepts: ['1010', ''],
    rejects: [1010, '10a1', null],
  },
  {
    codec: pgUuidDescriptor.factory()(ctx),
    accepts: ['123e4567-e89b-12d3-a456-426614174000', '123E4567-E89B-12D3-A456-426614174000'],
    rejects: [1, 'not-a-uuid', '123e4567e89b12d3a456426614174000', null],
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
  {
    codec: pgDateStringDescriptor.factory()(ctx),
    accepts: ['2026-01-02', 'infinity'],
    rejects: [20260102, null],
  },
  {
    codec: pgTimestampStringDescriptor.factory({})(ctx),
    accepts: ['2026-01-02 03:04:05.123456', 'infinity'],
    rejects: [1, null],
  },
  {
    codec: pgTimestamptzStringDescriptor.factory({})(ctx),
    accepts: ['2026-01-02 03:04:05.123456+00', '-infinity'],
    rejects: [1, null],
  },
  {
    codec: pgTimeStringDescriptor.factory({})(ctx),
    accepts: ['03:04:05.123456'],
    rejects: [1, null],
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
