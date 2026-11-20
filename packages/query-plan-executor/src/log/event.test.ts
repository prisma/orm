import { Temporal } from 'temporal-polyfill'
import { describe, expect, test } from 'vitest'

import { LogEvent } from './event'
import { LogLevel } from './log-level'

describe('LogEvent', () => {
  test('construction and properties', () => {
    const event = new LogEvent('info', 'test message', { key1: 'value1' })

    expect(event.level).toEqual('info')
    expect(event.message).toEqual('test message')
    expect(event.attributes).toMatchObject({ key1: 'value1' })

    // Verify timestamp is an instance of Temporal.Instant
    expect(event.timestamp).toBeInstanceOf(Temporal.Instant)
  })

  test('export method', () => {
    const event = new LogEvent('debug', 'test debug', { debug: true })
    const exported = event.export()

    expect(exported.level).toEqual('debug')
    expect(exported.message).toEqual('test debug')
    expect(exported.attributes).toMatchObject({ debug: true })

    // Verify timestamp is an HrTime tuple (number[])
    expect(Array.isArray(exported.timestamp)).toEqual(true)
    expect(exported.timestamp.length).toEqual(2)
  })

  test('handles empty attributes', () => {
    const event = new LogEvent('warn', 'warning message')

    expect(event.level).toEqual('warn')
    expect(event.message).toEqual('warning message')
    expect(Object.keys(event.attributes).length).toEqual(0)
  })

  test('with different log levels', () => {
    const levels: LogLevel[] = ['debug', 'query', 'info', 'warn', 'error']

    for (const level of levels) {
      const event = new LogEvent(level, `${level} message`)
      expect(event.level).toEqual(level)
    }
  })
})
