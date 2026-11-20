import { afterEach, describe, expect, test, vi } from 'vitest'

import { createFileNameToKeyMapper } from './caseSensitivity'

describe('createFileNameToKeyMapper', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('uses locale-independent lowercase keys when case-insensitive', () => {
    vi.spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(function (this: string) {
      return this.replace(/I/g, 'ı').toLowerCase()
    })

    const mapFileName = createFileNameToKeyMapper({ caseSensitive: false })

    expect(mapFileName('I.prisma')).toBe('i.prisma')
  })
})
