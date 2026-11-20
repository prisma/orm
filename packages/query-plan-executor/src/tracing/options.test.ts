import { describe, expect, it } from 'vitest'

import { ExtendedSpanOptions, normalizeSpanOptions } from './options'

describe('normalizeSpanOptions', () => {
  it('converts string to options object', () => {
    const result = normalizeSpanOptions('test-span')
    expect(result).toEqual({ name: 'test-span' })
  })

  it('passes through options object', () => {
    const options: ExtendedSpanOptions = {
      name: 'test-span',
      attributes: { 'test.attr': 'value' },
    }

    const result = normalizeSpanOptions(options)
    expect(result).toEqual(options)
  })
})
