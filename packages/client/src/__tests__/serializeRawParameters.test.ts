import { Decimal, PrismaClientValidationError } from '@prisma/client-runtime-utils'

import { serializeRawParameters } from '../runtime/utils/serializeRawParameters'

const CLIENT_VERSION = 'test-client-version'

function serialize(data: any[]) {
  return JSON.parse(serializeRawParameters(data, CLIENT_VERSION))
}

describe('serializeRawParameters', () => {
  test('empty', () => {
    expect(serialize([])).toEqual([])
  })

  test('primitives', () => {
    const data = [0, 1, true, false, '', 'hi', null, undefined]
    expect(serialize(data)).toEqual([0, 1, true, false, '', 'hi', null, null])
  })

  test('date', () => {
    const data = [new Date('2020-06-22T17:07:16.348Z')]

    expect(serialize(data)).toEqual([
      {
        prisma__type: 'date',
        prisma__value: '2020-06-22T17:07:16.348Z',
      },
    ])
  })

  test('invalid date throws', () => {
    expect(() => serialize([new Date('not a valid date')])).toThrow(PrismaClientValidationError)
    expect(() => serialize([new Date('invalid')])).toThrow(PrismaClientValidationError)
  })

  test('BigInt', () => {
    const data = [BigInt('321804719213721')]

    expect(serialize(data)).toEqual([
      {
        prisma__type: 'bigint',
        prisma__value: '321804719213721',
      },
    ])
  })

  test('Decimal', () => {
    const data = [new Decimal(1.1)]

    expect(serialize(data)).toEqual([
      {
        prisma__type: 'decimal',
        prisma__value: '1.1',
      },
    ])
  })

  test('Buffer', () => {
    const data = [Buffer.from('hello')]

    expect(serialize(data)).toEqual([
      {
        prisma__type: 'bytes',
        prisma__value: 'aGVsbG8=',
      },
    ])
  })

  test('typed byte arrays', () => {
    const data = [
      Int8Array.of(0x69, 0x6e, 0x74, 0x38),
      Uint8Array.of(0x75, 0x69, 0x6e, 0x74, 0x38),
      Uint8ClampedArray.of(0x75, 0x69, 0x6e, 0x74, 0x38, 0x63),
    ]

    expect(serialize(data)).toEqual([
      {
        prisma__type: 'bytes',
        prisma__value: 'aW50OA==',
      },
      {
        prisma__type: 'bytes',
        prisma__value: 'dWludDg=',
      },
      {
        prisma__type: 'bytes',
        prisma__value: 'dWludDhj',
      },
    ])
  })

  test('ArrayBuffer', () => {
    const arrayBuffer = new ArrayBuffer(6)
    const array = new Uint8Array(arrayBuffer)
    array.set([0x62, 0x75, 0x66, 0x66, 0x65, 0x72])

    expect(serialize([arrayBuffer])).toEqual([
      {
        prisma__type: 'bytes',
        prisma__value: 'YnVmZmVy',
      },
    ])
  })

  test('SharedArrayBuffer', () => {
    const sharedArrayBuffer = new SharedArrayBuffer(6)
    const array = new Uint8Array(sharedArrayBuffer)
    array.set([0x73, 0x68, 0x61, 0x72, 0x65, 0x64])

    expect(serialize([sharedArrayBuffer])).toEqual([
      {
        prisma__type: 'bytes',
        prisma__value: 'c2hhcmVk',
      },
    ])
  })

  // Objects are serialized as-is, except for BigInts which are serialized as
  // strings because otherwise JSON.stringify would throw TypeError.
  describe('objects', () => {
    test('no BigInts', () => {
      const data = [
        {
          text: 'text',
          number: 1,
        },
        {
          date: new Date('2020-06-22T17:07:16.348Z'),
          buffer: Buffer.from('hello'),
        },
        {
          nested: {
            array: [new Date('2020-06-22T17:07:16.348Z'), '321804719213721'],
          },
        },
        [123, '321804719213721'],
      ]

      expect(serialize(data)).toEqual([
        {
          text: 'text',
          number: 1,
        },
        {
          date: '2020-06-22T17:07:16.348Z',
          buffer: { type: 'Buffer', data: [104, 101, 108, 108, 111] },
        },
        {
          nested: {
            array: ['2020-06-22T17:07:16.348Z', '321804719213721'],
          },
        },
        [123, '321804719213721'],
      ])
    })

    test('with BigInts', () => {
      const data = [
        {
          text: 'text',
          number: 1,
        },
        {
          date: new Date('2020-06-22T17:07:16.348Z'),
          bigInt: BigInt('321804719213721'),
          buffer: Buffer.from('hello'),
        },
        {
          nested: {
            array: [new Date('2020-06-22T17:07:16.348Z'), BigInt('321804719213721')],
          },
        },
        [123, BigInt('321804719213721')],
      ]

      expect(serialize(data)).toEqual([
        {
          text: 'text',
          number: 1,
        },
        {
          date: '2020-06-22T17:07:16.348Z',
          bigInt: '321804719213721',
          buffer: { type: 'Buffer', data: [104, 101, 108, 108, 111] },
        },
        {
          nested: {
            array: ['2020-06-22T17:07:16.348Z', '321804719213721'],
          },
        },
        [123, { prisma__type: 'bigint', prisma__value: '321804719213721' }],
      ])
    })
  })
})
