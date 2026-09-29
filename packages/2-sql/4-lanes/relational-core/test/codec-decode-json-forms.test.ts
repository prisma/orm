import type { JsonValue } from '@internal/contract/types';
import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  sqlCharDescriptor,
  sqlFloatDescriptor,
  sqlIntDescriptor,
  sqlTextDescriptor,
  sqlVarcharDescriptor,
} from '../src/ast/sql-codecs';

const ctx: CodecInstanceContext = { name: 'decode-json-forms' };

// Accepted forms are what PostgreSQL and SQLite write for text and integer columns in JSON (a JSON string, a JSON number), and each codec's own `encodeJson` output.
const cases: readonly {
  readonly codec: { readonly id: string; decodeJson(json: JsonValue): unknown };
  readonly accepts: readonly JsonValue[];
  readonly rejects: readonly JsonValue[];
}[] = [
  { codec: sqlTextDescriptor.factory()(ctx), accepts: ['hello', ''], rejects: [1, true, null, []] },
  { codec: sqlCharDescriptor.factory({})(ctx), accepts: ['a  ', 'a'], rejects: [1, null] },
  { codec: sqlVarcharDescriptor.factory({})(ctx), accepts: ['hi'], rejects: [1, null] },
  // PostgreSQL writes a float8 NaN or infinity as the JSON strings "NaN", "Infinity", "-Infinity"; SQLite writes an infinity as 9.0e+999, which JSON.parse reads as Infinity.
  {
    codec: sqlFloatDescriptor.factory()(ctx),
    accepts: [1.5, 0, -2, 'NaN', 'Infinity', '-Infinity', Number.POSITIVE_INFINITY],
    rejects: ['1.5', 'nan', 'inf', true, null, {}],
  },
  {
    codec: sqlIntDescriptor.factory()(ctx),
    accepts: [42, -2147483648, 9007199254740991],
    rejects: ['42', 1.5, 9007199254740992, true, null],
  },
];

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

describe('sql/float@1 encodeJson and decodeJson agree on the non-finite values', () => {
  const codec = sqlFloatDescriptor.factory()(ctx);

  it('writes NaN and the infinities as the text PostgreSQL writes, and reads them back', () => {
    const values = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5];
    const stored = values.map((value) => codec.encodeJson(value));
    expect({ stored, read: stored.map((json) => codec.decodeJson(json)) }).toEqual({
      stored: ['NaN', 'Infinity', '-Infinity', 1.5],
      read: values,
    });
  });
});
