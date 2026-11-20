import { Decimal } from '@prisma/client-runtime-utils'

import { deserializeRawResult } from '../runtime/utils/deserializeRawResults'

describe('deserializeRawResult', () => {
  test('int', () => {
    expect(
      deserializeRawResult({
        columns: ['a'],
        types: ['int'],
        rows: [[42]],
      }),
    ).toEqual([
      {
        a: 42,
      },
    ])
  })

  test('bigint', () => {
    expect(
      deserializeRawResult({
        columns: ['a'],
        types: ['bigint'],
        rows: [['10000']],
      }),
    ).toEqual([
      {
        a: BigInt(10_000),
      },
    ])
  })

  test('floating point', () => {
    expect(
      deserializeRawResult({
        columns: ['a', 'b'],
        types: ['float', 'double'],
        rows: [[1.5, 0.5]],
      }),
    ).toEqual([
      {
        a: 1.5,
        b: 0.5,
      },
    ])
  })

  test('string', () => {
    expect(deserializeRawResult({ columns: ['a'], types: ['string'], rows: [['hello']] })).toEqual([
      {
        a: 'hello',
      },
    ])
  })

  test('enum', () => {
    expect(deserializeRawResult({ columns: ['a'], types: ['enum'], rows: [['value']] })).toEqual([
      {
        a: 'value',
      },
    ])
  })

  test('bytes', () => {
    expect(deserializeRawResult({ columns: ['a'], types: ['bytes'], rows: [['Ynl0ZXM=']] })).toEqual([
      {
        a: new Uint8Array(Buffer.from('bytes')),
      },
    ])
  })

  test('bytes is backed by a standalone buffer', () => {
    const [row] = deserializeRawResult({ columns: ['a'], types: ['bytes'], rows: [['Ynl0ZXM=']] })
    const value = (row as { a: Uint8Array }).a
    // must not be a view into Node's shared Buffer pool, which would expose
    // unrelated pool data through `value.buffer`
    expect(value.byteOffset).toBe(0)
    expect(value.buffer.byteLength).toBe(value.byteLength)
  })

  test('bool', () => {
    expect(deserializeRawResult({ columns: ['a', 'b'], types: ['bool', 'bool'], rows: [[true, false]] })).toEqual([
      {
        a: true,
        b: false,
      },
    ])
  })

  test('null', () => {
    expect(
      deserializeRawResult({
        columns: ['a', 'b', 'c'],
        types: ['int', 'string', 'bool-array'],
        rows: [[null, null, null]],
      }),
    ).toEqual([
      {
        a: null,
        b: null,
        c: null,
      },
    ])
  })

  test('json', () => {
    expect(deserializeRawResult({ columns: ['a'], types: ['json'], rows: [[{ a: 1, b: [2] }]] })).toEqual([
      {
        a: {
          a: 1,
          b: [2],
        },
      },
    ])
  })

  test('date and time', () => {
    expect(
      deserializeRawResult({
        columns: ['a', 'b', 'c'],
        types: ['datetime', 'date', 'time'],
        rows: [['2022-01-01T00:00:00.000Z', '2022-05-04', '14:10:45.912']],
      }),
    ).toEqual([
      {
        a: new Date('2022-01-01T00:00:00.000Z'),
        b: new Date('2022-05-04T00:00:00.000Z'),
        c: new Date('1970-01-01T14:10:45.912Z'),
      },
    ])
  })

  test('unsupported', () => {
    expect(
      deserializeRawResult({
        columns: ['a', 'b', 'c'],
        types: ['char', 'xml', 'uuid'],
        rows: [['a', '<xml></xml>', '00000000-0000-0000-0000-000000000000']],
      }),
    ).toEqual([
      {
        a: 'a',
        b: '<xml></xml>',
        c: '00000000-0000-0000-0000-000000000000',
      },
    ])
  })

  test('array', () => {
    expect(
      deserializeRawResult({
        columns: ['bigints', 'bytes', 'decimals', 'datetimes', 'dates', 'times', 'empty'],
        types: [
          'bigint-array',
          'bytes-array',
          'decimal-array',
          'datetime-array',
          'date-array',
          'time-array',
          'unknown',
        ],
        rows: [
          [
            ['1234', '123456789'],
            ['Ynl0ZXM=', 'Ym9uam91cg=='],
            ['1.2345678', '9999999.456789'],
            ['2022-01-01T00:00:00.000Z', '2022-05-04T00:00:00.000Z'],
            ['2022-05-04', '2022-01-01'],
            ['14:10:45.912', '00:00:00.000'],
            [],
          ],
        ],
      }),
    ).toEqual([
      {
        bigints: [BigInt(1234), BigInt(123456789)],
        bytes: [new Uint8Array(Buffer.from('bytes')), new Uint8Array(Buffer.from('bonjour'))],
        decimals: [new Decimal('1.2345678'), new Decimal('9999999.456789')],
        datetimes: [new Date('2022-01-01T00:00:00.000Z'), new Date('2022-05-04T00:00:00.000Z')],
        dates: [new Date('2022-05-04T00:00:00.000Z'), new Date('2022-01-01T00:00:00.000Z')],
        times: [new Date('1970-01-01T14:10:45.912Z'), new Date('1970-01-01T00:00:00.000Z')],
        empty: [],
      },
    ])
  })
})
