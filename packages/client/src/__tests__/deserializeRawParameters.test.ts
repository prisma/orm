import { Decimal } from '@prisma/client-runtime-utils'

import { deserializeRawParameters } from '../runtime/utils/deserializeRawParameters'
import { serializeRawParameters } from '../runtime/utils/serializeRawParameters'

function roundTrip(data: any[]) {
  return deserializeRawParameters(serializeRawParameters(data))
}

describe('deserializeRawParameters', () => {
  test('empty array', () => {
    const result = deserializeRawParameters('[]')
    expect(result).toEqual({ args: [], argTypes: [] })
  })

  test.each([
    {
      name: 'primitives',
      input: [0, 1, true, false, '', 'hi', null, undefined],
      expectedArgs: [0, 1, true, false, '', 'hi', null, null],
      expectedTypes: [
        { scalarType: 'decimal', arity: 'scalar' },
        { scalarType: 'decimal', arity: 'scalar' },
        { scalarType: 'unknown', arity: 'scalar' },
        { scalarType: 'unknown', arity: 'scalar' },
        { scalarType: 'string', arity: 'scalar' },
        { scalarType: 'string', arity: 'scalar' },
        { scalarType: 'unknown', arity: 'scalar' },
        { scalarType: 'unknown', arity: 'scalar' },
      ],
    },
    {
      name: 'BigInt',
      input: [BigInt('321804719213721')],
      expectedArgs: ['321804719213721'],
      expectedTypes: [{ scalarType: 'bigint', arity: 'scalar' }],
    },
    {
      name: 'Date',
      input: [new Date('2020-06-22T17:07:16.348Z')],
      expectedArgs: ['2020-06-22T17:07:16.348Z'],
      expectedTypes: [{ scalarType: 'datetime', arity: 'scalar' }],
    },
    {
      name: 'Decimal',
      input: [new Decimal('1.1')],
      expectedArgs: ['1.1'],
      expectedTypes: [{ scalarType: 'decimal', arity: 'scalar' }],
    },
    {
      name: 'Buffer',
      input: [Buffer.from('hello')],
      expectedArgs: ['aGVsbG8='],
      expectedTypes: [{ scalarType: 'bytes', arity: 'scalar' }],
    },
    {
      name: 'Uint8Array',
      input: [Uint8Array.of(0x75, 0x69, 0x6e, 0x74, 0x38)],
      expectedArgs: ['dWludDg='],
      expectedTypes: [{ scalarType: 'bytes', arity: 'scalar' }],
    },
    {
      name: 'ArrayBuffer',
      input: (() => {
        const arrayBuffer = new ArrayBuffer(6)
        const array = new Uint8Array(arrayBuffer)
        array.set([0x62, 0x75, 0x66, 0x66, 0x65, 0x72])
        return [arrayBuffer]
      })(),
      expectedArgs: ['YnVmZmVy'],
      expectedTypes: [{ scalarType: 'bytes', arity: 'scalar' }],
    },
    {
      name: 'homogeneous BigInt array',
      input: [[BigInt('123'), BigInt('456'), BigInt('789')]],
      expectedArgs: [['123', '456', '789']],
      expectedTypes: [{ scalarType: 'bigint', arity: 'list' }],
    },
    {
      name: 'homogeneous string array',
      input: [['hello', 'world', 'test']],
      expectedArgs: [['hello', 'world', 'test']],
      expectedTypes: [{ scalarType: 'string', arity: 'list' }],
    },
    {
      name: 'JSON object',
      input: [
        { name: 'John', age: 30, active: true },
        { items: ['a', 'b', 'c'], count: 3 },
      ],
      expectedArgs: ['{"name":"John","age":30,"active":true}', '{"items":["a","b","c"],"count":3}'],
      expectedTypes: [
        { scalarType: 'unknown', arity: 'scalar' },
        { scalarType: 'unknown', arity: 'scalar' },
      ],
    },
  ])('$name - fast serialization roundtrip', ({ input, expectedArgs, expectedTypes }) => {
    const result = roundTrip(input)
    expect(result.args).toEqual(expectedArgs)
    expect(result.argTypes).toEqual(expectedTypes)
  })

  test.each([
    {
      name: 'BigInt',
      input: [BigInt('999'), [BigInt('123'), 'text']],
      expectedArgs: ['999', ['123', 'text']],
      expectedTypes: [
        { scalarType: 'bigint', arity: 'scalar' },
        { scalarType: 'bigint', arity: 'list' },
      ],
    },
  ])('$name - slow serialization roundtrip', ({ input, expectedArgs, expectedTypes }) => {
    const result = roundTrip(input)
    expect(result.args).toEqual(expectedArgs)
    expect(result.argTypes).toEqual(expectedTypes)
  })

  test('throws error for invalid JSON', () => {
    expect(() => deserializeRawParameters('not valid json')).toThrow()
  })

  test('throws error for non-array input', () => {
    expect(() => deserializeRawParameters('{"key": "value"}')).toThrow(
      'Received invalid serialized parameters: expected an array',
    )
  })

  test('throws error for prisma__value without prisma__type', () => {
    const serialized = JSON.stringify([{ prisma__value: '123' }])
    expect(() => deserializeRawParameters(serialized)).toThrow(
      'Invalid serialized parameter, prisma__type should be present when prisma__value is present',
    )
  })
})
