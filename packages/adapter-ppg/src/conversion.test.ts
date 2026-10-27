import type { ArgType } from '@prisma/driver-adapter-utils'
import { describe, expect, test } from 'vitest'

import { ArrayColumnType, builtinParsers, convertArgs, ScalarColumnType } from './conversion'

function getParser(oid: number) {
  const entry = builtinParsers.find((p) => p.oid === oid)
  if (!entry) {
    throw new Error(`No parser registered for OID ${oid}`)
  }
  return entry.parse
}

describe('conversion', () => {
  describe('null handling in type parsers', () => {
    test('normalize_timestamp returns null for null input', () => {
      const parse = getParser(ScalarColumnType.TIMESTAMP)
      expect(parse(null as unknown as string)).toBeNull()
    })

    test('normalize_timestamptz returns null for null input', () => {
      const parse = getParser(ScalarColumnType.TIMESTAMPTZ)
      expect(parse(null as unknown as string)).toBeNull()
    })

    test('normalize_timez returns null for null input', () => {
      const parse = getParser(ScalarColumnType.TIMETZ)
      expect(parse(null as unknown as string)).toBeNull()
    })

    test('normalize_money returns null for null input', () => {
      const parse = getParser(ScalarColumnType.MONEY)
      expect(parse(null as unknown as string)).toBeNull()
    })

    test('normalize_bool returns null for null input', () => {
      const parse = getParser(ScalarColumnType.BOOL)
      expect(parse(null as unknown as string)).toBeNull()
    })

    test('convertBytes returns null for null input', () => {
      const parse = getParser(ScalarColumnType.BYTEA)
      expect(parse(null as unknown as string)).toBeNull()
    })
  })

  describe('null handling in array type parsers', () => {
    test('timestamp array parser returns null for null input', () => {
      const parse = getParser(ArrayColumnType.TIMESTAMP_ARRAY)
      expect(parse(null as unknown as string)).toBeNull()
    })

    test('timestamptz array parser returns null for null input', () => {
      const parse = getParser(ArrayColumnType.TIMESTAMPTZ_ARRAY)
      expect(parse(null as unknown as string)).toBeNull()
    })

    test('money array parser returns null for null input', () => {
      const parse = getParser(ArrayColumnType.MONEY_ARRAY)
      expect(parse(null as unknown as string)).toBeNull()
    })

    test('bytea array parser returns null for null input', () => {
      const parse = getParser(ArrayColumnType.BYTEA_ARRAY)
      expect(parse(null as unknown as string)).toBeNull()
    })
  })

  describe('normalize_timestamp', () => {
    const parse = getParser(ScalarColumnType.TIMESTAMP)

    test('converts space separator to T and appends UTC offset', () => {
      expect(parse('1996-12-19 16:39:57')).toBe('1996-12-19T16:39:57+00:00')
    })

    test('preserves fractional seconds', () => {
      expect(parse('2024-01-15 08:30:00.123456')).toBe('2024-01-15T08:30:00.123456+00:00')
    })

    test('supports arrays of timestamps', () => {
      expect(getParser(ArrayColumnType.TIMESTAMP_ARRAY)('{1996-12-19 16:39:57,2024-01-15 08:30:00}')).toEqual([
        '1996-12-19T16:39:57+00:00',
        '2024-01-15T08:30:00+00:00',
      ])
    })
  })

  describe('normalize_timestamptz', () => {
    const parse = getParser(ScalarColumnType.TIMESTAMPTZ)

    test('normalizes positive offset to UTC', () => {
      expect(parse('1996-12-19 16:39:57+05:30')).toBe('1996-12-19T16:39:57+00:00')
    })

    test('normalizes negative offset to UTC', () => {
      expect(parse('2024-01-15 08:30:00-08:00')).toBe('2024-01-15T08:30:00+00:00')
    })

    test('normalizes short offset format', () => {
      expect(parse('2024-01-15 08:30:00+05')).toBe('2024-01-15T08:30:00+00:00')
    })

    test('supports arrays of timestamptz', () => {
      expect(
        getParser(ArrayColumnType.TIMESTAMPTZ_ARRAY)('{1996-12-19 16:39:57+05:30,2024-01-15 08:30:00-08:00}'),
      ).toEqual(['1996-12-19T16:39:57+00:00', '2024-01-15T08:30:00+00:00'])
    })
  })

  describe('normalize_timez', () => {
    const parse = getParser(ScalarColumnType.TIMETZ)

    test('strips timezone offset', () => {
      expect(parse('16:39:57+05:30')).toBe('16:39:57')
    })

    test('strips negative offset', () => {
      expect(parse('08:30:00-08:00')).toBe('08:30:00')
    })
  })

  describe('normalize_money', () => {
    const parse = getParser(ScalarColumnType.MONEY)

    test('strips leading currency symbol', () => {
      expect(parse('$1234.56')).toBe('1234.56')
    })

    test('supports arrays of money', () => {
      expect(getParser(ArrayColumnType.MONEY_ARRAY)('{$1234.56,$7890.12}')).toEqual(['1234.56', '7890.12'])
    })
  })

  describe('normalize_bool', () => {
    const parse = getParser(ScalarColumnType.BOOL)

    test('converts f to false', () => {
      expect(parse('f')).toBe('false')
    })

    test('converts t to true', () => {
      expect(parse('t')).toBe('true')
    })
  })

  describe('convertBytes', () => {
    const parse = getParser(ScalarColumnType.BYTEA)

    test('converts base64 string to Buffer', () => {
      const result = parse('aGVsbG8=')
      expect(Buffer.isBuffer(result)).toBe(true)
      expect(result!.toString('utf8')).toBe('hello')
    })

    test('supports arrays of bytea', () => {
      const result = getParser(ArrayColumnType.BYTEA_ARRAY)('{aGVsbG8=,NULL}')
      expect(Array.isArray(result)).toBe(true)
      expect(result!.length).toBe(2)
      expect(Buffer.isBuffer(result![0])).toBe(true)
      expect(result![0]!.toString()).toBe('aGVsbG8=')
      expect(result![1]).toBeNull()
    })
  })

  describe('list columns', () => {
    test('every array type has a parser, so none comes back as the raw literal', () => {
      const missing = Object.entries(ArrayColumnType)
        .filter(([, oid]) => !builtinParsers.some((p) => p.oid === oid))
        .map(([name]) => name)
      expect(missing).toEqual([])
    })

    test('parses text-family arrays, keeping quoted commas and spaces and NULL', () => {
      const literal = '{a,"b c","x,y",NULL}'
      for (const oid of [ArrayColumnType.TEXT_ARRAY, ArrayColumnType.VARCHAR_ARRAY, ArrayColumnType.BPCHAR_ARRAY]) {
        expect(getParser(oid)(literal)).toEqual(['a', 'b c', 'x,y', null])
      }
    })

    test('parses uuid arrays', () => {
      expect(
        getParser(ArrayColumnType.UUID_ARRAY)(
          '{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11,a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12}',
        ),
      ).toEqual(['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'])
    })

    test('parses numeric arrays element by element', () => {
      expect(getParser(ArrayColumnType.INT4_ARRAY)('{1,-2,NULL}')).toEqual(['1', '-2', null])
      expect(getParser(ArrayColumnType.INT8_ARRAY)('{9007199254740993}')).toEqual(['9007199254740993'])
      expect(getParser(ArrayColumnType.FLOAT8_ARRAY)('{1.5,-0.25}')).toEqual(['1.5', '-0.25'])
    })

    test('parses boolean arrays the same way as the scalar boolean', () => {
      expect(getParser(ArrayColumnType.BOOL_ARRAY)('{t,f,NULL}')).toEqual(['true', 'false', null])
    })

    test('returns null for a null list', () => {
      expect(getParser(ArrayColumnType.TEXT_ARRAY)(null as unknown as string)).toBeNull()
    })
  })

  describe('convertArgs', () => {
    const list = (scalarType: ArgType['scalarType']): ArgType => ({ scalarType, arity: 'list' })
    const scalar = (scalarType: ArgType['scalarType']): ArgType => ({ scalarType, arity: 'scalar' })

    test('sends a string list as an array literal', () => {
      expect(convertArgs([['a', 'b']], [list('string')])).toEqual(['{"a","b"}'])
    })

    test('quotes commas, braces and spaces and escapes quotes and backslashes', () => {
      expect(convertArgs([['a,b', '{c}', 'say "hi"', 'c\\d']], [list('string')])).toEqual([
        '{"a,b","{c}","say \\"hi\\"","c\\\\d"}',
      ])
    })

    test('sends a null element as NULL and an empty list as {}', () => {
      expect(convertArgs([['a', null], []], [list('string'), list('string')])).toEqual(['{"a",NULL}', '{}'])
    })

    test('converts each element with the scalar rules', () => {
      expect(
        convertArgs(
          [[1, 2], [true, false], [new Date('2024-01-15T08:30:00.000Z')]],
          [list('int'), list('boolean'), list('datetime')],
        ),
      ).toEqual(['{"1","2"}', '{"true","false"}', '{"2024-01-15T08:30:00.000Z"}'])
    })

    test('leaves scalar arguments as they were', () => {
      expect(convertArgs(['a,b', 42, null], [scalar('string'), scalar('int'), scalar('string')])).toEqual([
        'a,b',
        '42',
        null,
      ])
    })
  })
})
