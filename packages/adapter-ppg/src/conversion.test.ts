import { describe, expect, test } from 'vitest'

import { ArrayColumnType, builtinParsers, ScalarColumnType } from './conversion'

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

    test('preserves positive offset', () => {
      expect(parse('1996-12-19 16:39:57+05:30')).toBe('1996-12-19T16:39:57+05:30')
    })

    test('preserves negative offset', () => {
      expect(parse('2024-01-15 08:30:00-08:00')).toBe('2024-01-15T08:30:00-08:00')
    })

    test('preserves short offset format', () => {
      expect(parse('2024-01-15 08:30:00+05')).toBe('2024-01-15T08:30:00+05')
    })

    test('supports arrays of timestamptz', () => {
      expect(
        getParser(ArrayColumnType.TIMESTAMPTZ_ARRAY)('{1996-12-19 16:39:57+05:30,2024-01-15 08:30:00-08:00}'),
      ).toEqual(['1996-12-19T16:39:57+05:30', '2024-01-15T08:30:00-08:00'])
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
})
