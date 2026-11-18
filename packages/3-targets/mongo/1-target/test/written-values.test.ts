import {
  assembleDataTypeSupport,
  readWrittenValueIntoCodec,
  type WrittenValue,
} from '@internal/framework-components/authoring';
import { notOk, ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import { mongoCodecDescriptors } from '../src/core/codecs';
import { mongoDataTypes, mongoObjectId, mongoString } from '../src/core/data-types';
import { mongoTargetDescriptorMeta } from '../src/core/descriptor-meta';

const codecLookup = {
  descriptorFor: (codecId: string) =>
    mongoCodecDescriptors.find((descriptor) => descriptor.codecId === codecId),
};

const { support } = assembleDataTypeSupport(
  [mongoTargetDescriptorMeta],
  (codecId) => codecLookup.descriptorFor(codecId)?.dataType,
);

function readInto(codecId: string, written: WrittenValue, typeParams?: { length: number }) {
  return readWrittenValueIntoCodec({
    support,
    codecLookup,
    ref: typeParams === undefined ? { codecId } : { codecId, typeParams },
    written,
    subject: 'value',
  });
}

const number = (text: string): WrittenValue => ({ kind: 'number', text });
const string = (text: string): WrittenValue => ({ kind: 'string', text });
const tag = (name: string, text: string): WrittenValue => ({ kind: 'tag', tag: name, text });
const list = (...elements: WrittenValue[]): WrittenValue => ({ kind: 'list', elements });

const DIGITS_39 = '123456789012345678901234567890123456789';

describe('the Mongo stack', () => {
  it('assembles: every data type but mongo/bson can be written, directly or through a cast', () => {
    const writable = new Set([
      ...Object.keys(support.entries),
      ...Object.values(support.entries).flatMap((entry) =>
        entry.written.kind === 'plain' && entry.written.syntax === 'number'
          ? entry.written.types
          : [],
      ),
    ]);
    const unwritable = mongoDataTypes
      .filter(
        (type) =>
          !writable.has(type.id) &&
          !Object.keys(type.casts).some((source) => writable.has(source)) &&
          !(type.listCast?.of ?? []).some((source) => writable.has(source)),
      )
      .map((type) => type.id);
    expect(unwritable).toEqual(['mongo/bson']);
  });

  it('names mongo/string as its only text data type', () => {
    expect(support.textDataTypes).toEqual(['mongo/string']);
  });
});

describe('written Mongo values', () => {
  it('reads a quoted string as mongo/string and true or false as mongo/bool', () => {
    expect([
      readInto('mongo/string@1', string('free')),
      readInto('mongo/bool@1', { kind: 'boolean', value: true }),
    ]).toEqual([ok('free'), ok(true)]);
  });

  it('reads a whole number in 32 bits as an int32, and -0 as 0', () => {
    expect([
      readInto('mongo/int32@1', number('7')),
      readInto('mongo/int32@1', number('-0')),
    ]).toEqual([ok(7), ok(0)]);
  });

  it('refuses an Int32 written with a fraction, which is a decimal128', () => {
    expect(readInto('mongo/int32@1', number('1.0'))).toEqual(
      notOk({
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: 'value: Expected a number that mongo/int32 can hold; got mongo/decimal128',
      }),
    );
  });

  it('refuses a quoted number on an Int32, with the number to write', () => {
    expect(readInto('mongo/int32@1', string('10'))).toEqual(
      notOk({ code: 'PSL_VALUE_TYPE_INCOMPATIBLE', message: 'value: Expected a number; write 10' }),
    );
  });

  it('offers the number to write only when it stores the value the quoted text says', () => {
    expect([
      readInto('mongo/decimal128@1', string('0.50')),
      readInto('mongo/decimal128@1', string('-0')),
      readInto('mongo/double@1', string('9007199254740993')),
      readInto('mongo/double@1', string('NaN')),
    ]).toEqual([
      notOk({
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: 'value: Expected a number; write 0.50',
      }),
      notOk({ code: 'PSL_VALUE_TYPE_INCOMPATIBLE', message: 'value: Expected a number' }),
      notOk({ code: 'PSL_VALUE_TYPE_INCOMPATIBLE', message: 'value: Expected a number' }),
      notOk({
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: 'value: Expected a number; write NaN',
      }),
    ]);
  });

  it('keeps every digit of an Int64 past 2^53, and takes an int32', () => {
    expect([
      readInto('mongo/int64@1', number('9007199254740993')),
      readInto('mongo/int64@1', number('7')),
      readInto('mongo/int64Number@1', number('-7')),
    ]).toEqual([ok('9007199254740993'), ok('7'), ok('-7')]);
  });

  it('reads a Double from a fraction, a whole number, a non-finite word, and a 39-digit whole number', () => {
    expect([
      readInto('mongo/double@1', number('0.5')),
      readInto('mongo/double@1', number('7')),
      readInto('mongo/double@1', number('9007199254740993')),
      readInto('mongo/double@1', number('NaN')),
      readInto('mongo/double@1', number('-Infinity')),
      readInto('mongo/double@1', number(DIGITS_39)),
    ]).toEqual([
      ok(0.5),
      ok(7),
      ok(9007199254740992),
      ok('NaN'),
      ok('-Infinity'),
      ok(Number(DIGITS_39)),
    ]);
  });

  it('refuses a Double past the magnitude a double holds', () => {
    const text = `1${'0'.repeat(400)}`;
    expect(readInto('mongo/double@1', number(text))).toEqual(
      notOk({
        code: 'PSL_INVALID_LITERAL',
        message: `value: ${text} is out of range: no double holds a number that large.`,
      }),
    );
  });

  it('refuses a number neither a Decimal128 nor a double holds', () => {
    const text = `1${'0'.repeat(400)}1`;
    expect(readInto('mongo/double@1', number(text))).toEqual(
      notOk({
        code: 'PSL_INVALID_LITERAL',
        message: `value: no data type of this target holds the number ${text}`,
      }),
    );
  });

  it('reads a Decimal128 in its spelling, from a decimal, an int32, an int64 and a word', () => {
    expect([
      readInto('mongo/decimal128@1', number('007.50')),
      readInto('mongo/decimal128@1', number('7')),
      readInto('mongo/decimal128@1', number('9007199254740993')),
      readInto('mongo/decimal128@1', number('NaN')),
      readInto('mongo/decimal128@1', number('0.0000001')),
      readInto('mongo/decimal128@1', number(`1${'0'.repeat(40)}`)),
    ]).toEqual([
      ok('7.50'),
      ok('7'),
      ok('9007199254740993'),
      ok('NaN'),
      ok('0.0000001'),
      ok(`1${'0'.repeat(40)}`),
    ]);
  });

  it.each(['0.1000000000000000000000000000000000000001', `1.${'0'.repeat(36)}`])(
    'refuses %s on a Decimal128: a Decimal128 would round it, so it is a double',
    (text) => {
      expect(readInto('mongo/decimal128@1', number(text))).toEqual(
        notOk({
          code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
          message: 'value: Expected a number that mongo/decimal128 can hold; got mongo/double',
        }),
      );
    },
  );

  it('reads an ObjectId from a quoted string, in lower case', () => {
    expect(readInto('mongo/objectId@1', string('507F1F77BCF86CD799439011'))).toEqual(
      ok('507f1f77bcf86cd799439011'),
    );
  });

  it('refuses a value of another shape handed to the ObjectId cast', () => {
    expect(() => mongoObjectId.casts[mongoString.id]?.(1)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED', message: 'Expected text, got 1.' }),
    );
  });

  it('refuses a quoted string that is not an ObjectId', () => {
    expect(readInto('mongo/objectId@1', string('nope'))).toEqual(
      notOk({
        code: 'PSL_INVALID_LITERAL',
        message: 'value: "nope" is not an ObjectId: write 24 hexadecimal digits.',
      }),
    );
  });

  it('reads a date tag as the instant text toISOString() writes', () => {
    expect(readInto('mongo/date@1', tag('date', '2024-01-01T01:00:00+01:00'))).toEqual(
      ok('2024-01-01T00:00:00.000Z'),
    );
  });

  it('refuses a date tag without a UTC offset', () => {
    expect(readInto('mongo/date@1', tag('date', '2024-01-01T00:00:00'))).toEqual(
      notOk({
        code: 'PSL_INVALID_LITERAL',
        message:
          'value: mongo/date needs a UTC offset, but "2024-01-01T00:00:00" has none. Add Z for UTC or an offset such as +02:00, as in "2024-01-01T12:34:56Z".',
      }),
    );
  });

  it('refuses a date tag with a date alone for an instant', () => {
    expect(readInto('mongo/date@1', tag('date', '2024-02-29'))).toMatchObject(
      notOk({ code: 'PSL_INVALID_LITERAL' }),
    );
  });

  it('reads a calendar date from a string, or from a date tag at midnight UTC', () => {
    expect({
      string: readInto('mongo/date-string@1', string('2024-02-29')),
      temporal: readInto('mongo/date-temporal@1', string('2024-02-29')),
      tag: readInto('mongo/date-string@1', tag('date', '2024-02-29T00:00:00Z')),
    }).toEqual({ string: ok('2024-02-29'), temporal: ok('2024-02-29'), tag: ok('2024-02-29') });
  });

  it('refuses a calendar date from a date tag at another time, or a string that is no date', () => {
    expect({
      tag: readInto('mongo/date-string@1', tag('date', '2024-02-29T09:30:00Z')).ok,
      string: readInto('mongo/date-string@1', string('2024-02-30')).ok,
    }).toEqual({ tag: false, string: false });
  });

  it('reads a time tag as the time of day with three fraction digits', () => {
    expect({
      string: readInto('mongo/time-string@1', tag('time', '09:30')),
      temporal: readInto('mongo/time-temporal@1', tag('time', '09:30:00.5')),
    }).toEqual({ string: ok('09:30:00.000'), temporal: ok('09:30:00.500') });
  });

  it('refuses a time tag with a UTC offset', () => {
    expect(readInto('mongo/time-string@1', tag('time', '09:30:00Z'))).toEqual(
      notOk({
        code: 'PSL_INVALID_LITERAL',
        message:
          'value: mongo/time holds no UTC offset, but "09:30:00Z" has one. Leave it out, as in "12:34:56".',
      }),
    );
  });

  it('reads a duration tag as written', () => {
    expect(readInto('mongo/duration-string@1', tag('duration', 'P1DT2H'))).toEqual(ok('P1DT2H'));
  });

  it('refuses a duration tag that is not an ISO 8601 duration', () => {
    expect(readInto('mongo/duration-string@1', tag('duration', '2 hours'))).toMatchObject(
      notOk({ code: 'PSL_INVALID_LITERAL' }),
    );
  });

  it('reads a binary tag as base64 with its padding bits zero', () => {
    expect(readInto('mongo/binary@1', tag('binary', 'AB=='))).toEqual(ok('AA=='));
  });

  it('refuses a binary tag that is not base64', () => {
    expect(readInto('mongo/binary@1', tag('binary', 'not base64'))).toEqual(
      notOk({
        code: 'PSL_INVALID_LITERAL',
        message:
          'value: "not base64" is not base64 text: write the bytes in base64, as in binary`aGVsbG8=`.',
      }),
    );
  });

  it('reads a json tag as the document it holds', () => {
    expect(readInto('mongo/json@1', tag('json', '{ "plan": [1, "free"] }'))).toEqual(
      ok({ plan: [1, 'free'] }),
    );
  });

  it('reads a vector through its list cast from int32, int64, decimal128 and double elements', () => {
    expect(readInto('mongo/vector@1', list(number('1'), number('2.5'), number('-0')))).toEqual(
      ok([1, 2.5, 0]),
    );
    expect(
      readInto('mongo/vector@1', list(number('9007199254740993'), number(DIGITS_39)), {
        length: 2,
      }),
    ).toEqual(ok([9007199254740992, Number(DIGITS_39)]));
  });

  it('refuses a vector element that is not finite', () => {
    expect(readInto('mongo/vector@1', list(number('1'), number('NaN')))).toEqual(
      notOk({
        code: 'PSL_INVALID_LITERAL',
        message: 'value: a vector element is a finite number, and element 2 is NaN.',
      }),
    );
  });

  it('refuses a vector of another length than its parameter', () => {
    expect(readInto('mongo/vector@1', list(number('1')), { length: 2 })).toEqual(
      notOk({
        code: 'PSL_VALUE_REFUSED',
        message: 'value: mongo/vector JSON value must be an array of 2 numbers',
      }),
    );
  });

  it('refuses a vector element of a type the list cast does not take', () => {
    expect(readInto('mongo/vector@1', list(string('1')))).toEqual(
      notOk({
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: 'value at element 1: Expected a number',
      }),
    );
  });
});

describe('printing a stored Mongo value', () => {
  it('writes each value back in the syntax its entry reads', () => {
    const print = (
      dataType: string,
      value: Parameters<(typeof support.entries)[string]['print']>[0],
    ) => support.entries[dataType]?.print(value);
    expect([
      print('mongo/string', 'free'),
      print('mongo/bool', true),
      print('mongo/double', 0.5),
      print('mongo/double', 1e21),
      print('mongo/double', '9007199254740993'),
      print('mongo/date', '2024-01-01T00:00:00.000Z'),
      print('mongo/calendar-date', '2024-02-29'),
      print('mongo/time', '09:30:00.000'),
      print('mongo/duration', 'PT1H'),
      print('mongo/binary', 'AA=='),
      print('mongo/json', { plan: 'free' }),
    ]).toEqual([
      'free',
      'true',
      '0.5',
      '1000000000000000000000',
      '9007199254740993',
      '2024-01-01T00:00:00.000Z',
      undefined,
      '09:30:00.000',
      'PT1H',
      'AA==',
      '{"plan":"free"}',
    ]);
  });
});
