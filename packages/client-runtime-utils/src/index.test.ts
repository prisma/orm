import { describe, expect, it } from 'vitest'

import { Decimal } from './index'

describe('Decimal relational operators', () => {
  // Regression test for https://github.com/prisma/prisma/issues/29882
  it('compares by numeric value instead of by string', () => {
    const d = (value: string) => new Decimal(value)

    expect(d('10.1') < d('9.99')).toBe(false)
    expect(d('2') < d('10')).toBe(true)
    expect(d('9.99') >= d('10.1')).toBe(false)
    expect(d('10.00') <= d('10')).toBe(true)
    expect(d('1.5') > d('1.50')).toBe(false)
  })

  it('keeps large integers distinguishable and finite', () => {
    const d = (value: string) => new Decimal(value)

    // Integers beyond Number.MAX_SAFE_INTEGER: Number('9007199254740992') and
    // Number('9007199254740993') are the same double, and Number('1e1000') is
    // Infinity. Relational operators must still order them exactly.
    expect(d('9007199254740992') < d('9007199254740993')).toBe(true)
    expect(d('1e1000') < d('1e1001')).toBe(true)
    expect(d('1e1000') > d('9e999')).toBe(true)
    expect(Number.isFinite(Number(d('1e1000')))).toBe(false)
  })

  it('keeps Number() coercion numeric', () => {
    expect(Number(new Decimal('10.5'))).toBe(10.5)
    expect(+new Decimal('10.5')).toBe(10.5)
  })

  it('keeps string coercion and JSON output unchanged', () => {
    const d = new Decimal('10.10')

    expect(String(d)).toBe('10.1')
    expect(`${d}`).toBe('10.1')
    expect(d.toString()).toBe('10.1')
    expect(d.toJSON()).toBe('10.1')
    expect(JSON.stringify(new Decimal('2.50'))).toBe('"2.5"')
  })
})
