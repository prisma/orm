import timers from 'node:timers/promises'

import { context } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { describe, expect, test } from 'vitest'

import { getActiveLogger, withActiveLogger } from './context'
import { Logger } from './logger'
import { CapturingSink } from './sink'

context.setGlobalContextManager(new AsyncLocalStorageContextManager())

describe('withActiveLogger', () => {
  test('sets and uses logger in context', () => {
    const sink = new CapturingSink()
    const logger = new Logger(sink)

    // Running without an active logger should throw
    expect(() => getActiveLogger()).toThrow('No active logger found')

    // Run with an active logger
    const result = withActiveLogger(logger, () => {
      // Get the active logger and use it
      const activeLogger = getActiveLogger()
      activeLogger.info('test message')

      // Return a value to confirm it's passed through
      return 'test result'
    })

    // Check the result is returned
    expect(result).toEqual('test result')

    // Check the logger was used
    expect(sink.events.length).toEqual(1)
    expect(sink.events[0].message).toEqual('test message')
  })

  test('sets and uses logger in context (async)', async () => {
    const sink = new CapturingSink()
    const logger = new Logger(sink)

    // Running without an active logger should throw
    expect(() => getActiveLogger()).toThrow('No active logger found')

    // Run with an active logger
    const result = await withActiveLogger(logger, async () => {
      await timers.setImmediate()

      // Get the active logger and use it after an async operation
      const activeLogger = getActiveLogger()
      activeLogger.info('test message')

      // Return a value to confirm it's passed through
      return 'test result'
    })

    // Check the result is returned
    expect(result).toEqual('test result')

    // Check the logger was used
    expect(sink.events.length).toEqual(1)
    expect(sink.events[0].message).toEqual('test message')
  })

  test('nesting works correctly', () => {
    const sink1 = new CapturingSink()
    const sink2 = new CapturingSink()
    const logger1 = new Logger(sink1)
    const logger2 = new Logger(sink2)

    withActiveLogger(logger1, () => {
      const active1 = getActiveLogger()
      active1.info('outer logger')

      withActiveLogger(logger2, () => {
        const active2 = getActiveLogger()
        active2.info('inner logger')
      })

      const activeAgain = getActiveLogger()
      activeAgain.warn('outer again')
    })

    // Verify messages went to the correct sinks
    expect(sink1.events.length).toEqual(2)
    expect(sink1.events[0].message).toEqual('outer logger')
    expect(sink1.events[1].message).toEqual('outer again')

    expect(sink2.events.length).toEqual(1)
    expect(sink2.events[0].message).toEqual('inner logger')
  })
})
