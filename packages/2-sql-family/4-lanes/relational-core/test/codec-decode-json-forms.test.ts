import type { JsonValue } from '@internal/contract/types';
import type { Codec } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  readStored,
  sqlCharCodec,
  sqlFloatCodec,
  sqlIntCodec,
  sqlTextCodec,
  sqlVarcharCodec,
  storedJson,
} from './template-codecs';

type ReadingCodec = Pick<Codec, 'id' | 'dataType' | 'fromDataTypeValue'>;

// Accepted forms are what PostgreSQL and SQLite write for text and integer columns in JSON (a JSON string, a JSON number), and each codec's own `toDataTypeValue` output. Which JSON a column stores is its data type's to decide, and a family template has none of its own; the template codec refuses only a value its application type cannot hold.
const accepting: readonly {
  readonly codec: ReadingCodec;
  readonly accepts: readonly JsonValue[];
}[] = [
  { codec: sqlTextCodec(), accepts: ['hello', ''] },
  { codec: sqlCharCodec(), accepts: ['a  ', 'a'] },
  { codec: sqlVarcharCodec(), accepts: ['hi'] },
  // The family codecs take any string, whatever the declared length: SQLite stores longer text, and PostgreSQL's length rule is the Postgres data type's.
  { codec: sqlVarcharCodec({ length: 3 }), accepts: ['abc', 'abcd', 'ab  '] },
  { codec: sqlCharCodec({ length: 3 }), accepts: ['abc', 'abcd', 'ab '] },
];

const refusing: readonly {
  readonly codec: ReadingCodec;
  readonly accepts: readonly JsonValue[];
  readonly rejects: readonly JsonValue[];
}[] = [
  // A float writes NaN and the infinities as the text PostgreSQL writes for them in JSON; SQLite's float projections write the same text.
  {
    codec: sqlFloatCodec(),
    accepts: [1.5, 0, -2, 'NaN', 'Infinity', '-Infinity'],
    rejects: ['1.5', 'nan', 'inf', Number.POSITIVE_INFINITY, true, null, {}],
  },
  {
    codec: sqlIntCodec(),
    accepts: [42, -2147483648, 9007199254740991],
    rejects: ['42', 1.5, 9007199254740992, true, null],
  },
];

describe('fromDataTypeValue reads every value its application type holds', () => {
  for (const { codec, accepts } of [...accepting, ...refusing]) {
    it(`${codec.id} accepts ${JSON.stringify(accepts)}`, () => {
      for (const json of accepts) expect(() => readStored(codec, json)).not.toThrow();
    });
  }
});

describe('fromDataTypeValue refuses a value its application type cannot hold', () => {
  for (const { codec, rejects } of refusing) {
    it(`${codec.id} refuses ${JSON.stringify(rejects)}`, () => {
      for (const json of rejects) {
        expect(() => readStored(codec, json)).toThrow(
          expect.objectContaining({
            code: 'RUNTIME.DECODE_FAILED',
            meta: expect.objectContaining({ codecId: codec.id }),
          }),
        );
      }
    });
  }
});

describe('sql/float@1 toDataTypeValue and fromDataTypeValue agree on the non-finite values', () => {
  const codec = sqlFloatCodec();

  it('writes NaN and the infinities as the text PostgreSQL writes, and reads them back', () => {
    const values = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5];
    const stored = values.map((value) => storedJson(codec, value));
    expect({ stored, read: stored.map((json) => readStored(codec, json)) }).toEqual({
      stored: ['NaN', 'Infinity', '-Infinity', 1.5],
      read: values,
    });
  });
});
