import { describe, expect, test } from 'vitest'

import { LogLevel } from './log-level'
import { Logger } from './logger'
import { CapturingSink } from './sink'

describe('Logger', () => {
  test('logs messages at the correct level', () => {
    const sink = new CapturingSink()
    const logger = new Logger(sink)

    // Test each log level method
    logger.debug('debug message', { debug: true })
    logger.query('query message', { sql: 'SELECT 1' })
    logger.info('info message', { user: 'test' })
    logger.warn('warn message', { warning: true })
    logger.error('error message', { error: 'test error' })

    // Verify each call was captured
    expect(sink.events.length).toEqual(5)

    // Check debug call
    const debugEvent = sink.events[0]
    expect(debugEvent.level).toEqual('debug')
    expect(debugEvent.message).toEqual('debug message')
    expect(debugEvent.attributes.debug).toEqual(true)

    // Check query call
    const queryEvent = sink.events[1]
    expect(queryEvent.level).toEqual('query')
    expect(queryEvent.message).toEqual('query message')
    expect(queryEvent.attributes.sql).toEqual('SELECT 1')

    // Check info call
    const infoEvent = sink.events[2]
    expect(infoEvent.level).toEqual('info')
    expect(infoEvent.message).toEqual('info message')
    expect(infoEvent.attributes.user).toEqual('test')

    // Check warn call
    const warnEvent = sink.events[3]
    expect(warnEvent.level).toEqual('warn')
    expect(warnEvent.message).toEqual('warn message')
    expect(warnEvent.attributes.warning).toEqual(true)

    // Check error call
    const errorEvent = sink.events[4]
    expect(errorEvent.level).toEqual('error')
    expect(errorEvent.message).toEqual('error message')
    expect(errorEvent.attributes.error).toEqual('test error')
  })

  test('generic log method', () => {
    const sink = new CapturingSink()
    const logger = new Logger(sink)

    // Test the generic log method with different levels
    const levels: LogLevel[] = ['debug', 'query', 'info', 'warn', 'error']

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i]
      logger.log(level, `${level} message`, { index: i })
    }

    // Verify all events were captured
    expect(sink.events.length).toEqual(levels.length)

    // Check each event
    for (let i = 0; i < levels.length; i++) {
      const event = sink.events[i]
      expect(event.level).toEqual(levels[i])
      expect(event.message).toEqual(`${levels[i]} message`)
      expect(event.attributes.index).toEqual(i)
    }
  })

  test('handles undefined attributes', () => {
    const sink = new CapturingSink()
    const logger = new Logger(sink)

    // Call without attributes
    logger.info('info without attributes')

    // Verify the event has empty attributes
    expect(sink.events.length).toEqual(1)
    expect(Object.keys(sink.events[0].attributes).length).toEqual(0)
  })
})
