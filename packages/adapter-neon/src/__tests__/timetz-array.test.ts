import { ColumnTypeEnum } from '@prisma/driver-adapter-utils'
import { describe, expect, it } from 'vitest'

import { customParsers, fieldToColumnType } from '../conversion'

const TIMETZ_ARRAY_OID = 1270

describe('TIMETZ[]', () => {
  it('maps the timetz array OID to TimeArray instead of throwing', () => {
    expect(fieldToColumnType(TIMETZ_ARRAY_OID)).toBe(ColumnTypeEnum.TimeArray)
  })

  it('normalizes elements the same way scalar TIMETZ does', () => {
    const parse = customParsers[TIMETZ_ARRAY_OID] as (value: string) => string[]
    expect(parse('{10:30:00+02,11:00:00-05:00,12:00:00}')).toEqual(['10:30:00', '11:00:00', '12:00:00'])
  })
})
