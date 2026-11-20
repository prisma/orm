import { describe, expect, test } from 'vitest'

import { parseLogLevel } from './log-level'

describe('parseLogLevel', () => {
  test('valid', () => {
    expect(parseLogLevel('debug')).toEqual('debug')
    expect(parseLogLevel('info')).toEqual('info')
    expect(parseLogLevel('warn')).toEqual('warn')
    expect(parseLogLevel('error')).toEqual('error')
  })

  test('invalid', () => {
    expect(() => parseLogLevel('invalid')).toThrow()
    expect(() => parseLogLevel('DEBUG')).toThrow()
  })
})
