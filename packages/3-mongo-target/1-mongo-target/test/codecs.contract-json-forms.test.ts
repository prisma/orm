import type { JsonValue } from '@internal/contract/types';
import { type Codec, readContractValue } from '@internal/framework-components/codec';
import { Double, Timestamp } from 'bson';
import { describe, expect, it } from 'vitest';
import {
  mongoBinaryCodec,
  mongoBooleanCodec,
  mongoBsonCodec,
  mongoDateCodec,
  mongoDecimal128Codec,
  mongoDescriptorById,
  mongoDoubleCodec,
  mongoInt32Codec,
  mongoInt64Codec,
  mongoInt64NumberCodec,
  mongoObjectIdCodec,
  mongoStringCodec,
  mongoVectorCodec,
} from '../src/core/codecs';

interface StoredFormCase {
  readonly codec: Pick<Codec, 'id' | 'dataType' | 'fromDataTypeValue'>;
  /** Each stored JSON form the codec writes, with the value it reads back. */
  readonly reads: readonly (readonly [JsonValue, unknown])[];
  /** JSON the codec's data type does not store. */
  readonly rejects: readonly JsonValue[];
  /** JSON the data type stores that the codec's application value cannot hold. */
  readonly codecRejects?: readonly JsonValue[];
}

const read = (codec: StoredFormCase['codec'], json: JsonValue) =>
  readContractValue(codec, json, undefined);

const cases: readonly StoredFormCase[] = [
  {
    codec: mongoObjectIdCodec,
    reads: [
      ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439011'],
      ['507F1F77BCF86CD799439011', '507F1F77BCF86CD799439011'],
    ],
    rejects: [
      '507f1f77bcf86cd79943901',
      '507f1f77bcf86cd79943901z',
      'abcdefabcdef',
      1,
      null,
      { $oid: '507f1f77bcf86cd799439011' },
    ],
  },
  {
    codec: mongoStringCodec,
    reads: [
      ['hello', 'hello'],
      ['', ''],
    ],
    rejects: [1, true, null, [], {}],
  },
  {
    codec: mongoDoubleCodec,
    reads: [
      [1.5, 1.5],
      [0, 0],
      [-2, -2],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
    ],
    rejects: ['1.5', 'nan', 'inf', true, null, {}],
  },
  {
    codec: mongoInt32Codec,
    reads: [
      [42, 42],
      [-2147483648, -2147483648],
      [2147483647, 2147483647],
    ],
    rejects: ['42', 1.5, 2147483648, -2147483649, true, null],
  },
  {
    codec: mongoBooleanCodec,
    reads: [
      [true, true],
      [false, false],
    ],
    rejects: ['true', 0, 1, null],
  },
  {
    codec: mongoDateCodec,
    reads: [
      ['2024-01-02T03:04:05.000Z', new Date('2024-01-02T03:04:05.000Z')],
      ['+275760-09-13T00:00:00.000Z', new Date(8.64e15)],
    ],
    rejects: [
      '2024-01-02',
      '2024-01-02T03:04:05Z',
      '2024-13-01T00:00:00.000Z',
      'not a date',
      1704164645000,
      null,
    ],
  },
  {
    codec: mongoVectorCodec,
    reads: [
      [
        [1, 2.5, -3],
        [1, 2.5, -3],
      ],
      [[], []],
    ],
    rejects: [[1, '2'], [null], '1,2', 1, null, {}],
  },
  {
    codec: mongoInt64Codec,
    reads: [
      ['9007199254740993', 9007199254740993n],
      ['-1', -1n],
    ],
    rejects: [12, '1.5', '9223372036854775808', null],
  },
  {
    codec: mongoInt64NumberCodec,
    reads: [
      ['9007199254740991', 9007199254740991],
      ['-42', -42],
    ],
    rejects: [42, '1.5', null],
    codecRejects: ['9007199254740992', '-9007199254740992'],
  },
  {
    codec: mongoDecimal128Codec,
    reads: [
      ['1.50', '1.50'],
      ['NaN', 'NaN'],
    ],
    rejects: [1.5, '1E+3', null],
  },
  {
    codec: mongoBinaryCodec,
    reads: [['AAEC', new Uint8Array([0, 1, 2])]],
    rejects: ['not base64!', 12, null],
  },
  {
    codec: mongoBsonCodec,
    reads: [
      ['text', 'text'],
      [true, true],
      [null, null],
      [{ $numberDouble: '1.5' }, new Double(1.5)],
      [{ $timestamp: { t: 1, i: 2 } }, new Timestamp({ t: 1, i: 2 })],
    ],
    rejects: [
      5,
      1.5,
      [1],
      { count: 1 },
      { $numberInt: 'abc' },
      { $numberDouble: '1' },
      { $date: 'not a date' },
      { $oid: 'zz' },
    ],
  },
];

describe('a codec reads the stored JSON form of its type, which refuses any other', () => {
  for (const { codec, reads, rejects, codecRejects = [] } of cases) {
    it(`${codec.id} reads ${JSON.stringify(reads.map(([json]) => json))}`, () => {
      expect(reads.map(([json]) => read(codec, json))).toEqual(reads.map(([, value]) => value));
    });

    it(`${codec.dataType.id} refuses ${JSON.stringify(rejects)}`, () => {
      for (const json of rejects) {
        expect(() => read(codec, json)).toThrow(
          expect.objectContaining({
            code: 'RUNTIME.DECODE_FAILED',
            meta: expect.objectContaining({ dataType: codec.dataType.id }),
          }),
        );
      }
    });

    if (codecRejects.length > 0) {
      it(`${codec.id} refuses ${JSON.stringify(codecRejects)}`, () => {
        for (const json of codecRejects) {
          expect(() => read(codec, json)).toThrow(
            expect.objectContaining({
              code: 'RUNTIME.DECODE_FAILED',
              meta: expect.objectContaining({ codecId: codec.id }),
            }),
          );
        }
      });
    }
  }
});

describe.each([mongoInt64Codec, mongoInt64NumberCodec])(
  '$id digit text without leading zeros or a minus sign on zero',
  (codec) => {
    it.each([
      ['a leading zero', '007', '7'],
      ['a negative zero', '-0', '0'],
      ['a negative number with a leading zero', '-007', '-7'],
      ['two zeros', '00', '0'],
    ])('refuses %s, naming the text to write', (_name, json, printed) => {
      expect(() => read(codec, json)).toThrow(
        `${codec.dataType.id} JSON value must be "${printed}", the integer's decimal text without leading zeros or a minus sign on zero`,
      );
    });
  },
);

describe('toDataTypeValue writes only a form the codec reads', () => {
  it('mongo/double@1 writes NaN and the infinities as text and reads them back', () => {
    const values = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5];
    const stored = values.map((value) =>
      mongoDoubleCodec.dataType.toContract(mongoDoubleCodec.toDataTypeValue(value)),
    );
    expect({ stored, read: stored.map((json) => read(mongoDoubleCodec, json)) }).toEqual({
      stored: ['NaN', 'Infinity', '-Infinity', 1.5],
      read: values,
    });
  });

  it('mongo/double@1 renders a finite member as a literal type and no literal type for the text forms', () => {
    const render = mongoDescriptorById('mongo/double@1')?.renderValueLiteral;
    expect(['Infinity', 'NaN', 1.5].map((value) => render?.(value, 'output'))).toEqual([
      undefined,
      undefined,
      '1.5',
    ]);
  });

  it.each([
    ['mongo/objectId@1', () => mongoObjectIdCodec.toDataTypeValue('not an object id')],
    ['mongo/int32@1', () => mongoInt32Codec.toDataTypeValue(1.5)],
    ['mongo/int32@1', () => mongoInt32Codec.toDataTypeValue(2 ** 31)],
    ['mongo/date@1', () => mongoDateCodec.toDataTypeValue(new Date(Number.NaN))],
  ])('%s refuses a value its type does not hold', (codecId, write) => {
    expect(write).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ENCODE_FAILED',
        meta: expect.objectContaining({ codecId }),
      }),
    );
  });
});
