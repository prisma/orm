import { context } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { Temporal } from 'temporal-polyfill'
import { describe, expect, it } from 'vitest'

import { getTestTracer } from '../tracing/test-utils'
import { LogEvent } from './event'
import { createLogFormatter, JsonFormatter, TextFormatter } from './format'

context.setGlobalContextManager(new AsyncLocalStorageContextManager())

describe('TextFormatter', () => {
  it('formats debug events correctly', () => {
    const formatter = new TextFormatter()

    const event = new LogEvent(
      'debug',
      'test message',
      { userId: '123', method: 'GET' },
      Temporal.Instant.from('2025-04-14T00:00:00Z'),
    )

    const formatted = formatter.format(event)

    expect(formatted).toMatchSnapshot()
  })

  it('formats query events correctly', () => {
    const formatter = new TextFormatter()

    const event = new LogEvent(
      'query',
      'test message',
      { userId: '123', method: 'GET' },
      Temporal.Instant.from('2025-04-14T00:00:00Z'),
    )

    const formatted = formatter.format(event)

    expect(formatted).toMatchSnapshot()
  })

  it('formats info events correctly', () => {
    const formatter = new TextFormatter()

    const event = new LogEvent(
      'info',
      'test message',
      { userId: '123', method: 'GET' },
      Temporal.Instant.from('2025-04-14T00:00:00Z'),
    )

    const formatted = formatter.format(event)

    expect(formatted).toMatchSnapshot()
  })

  it('formats warn events correctly', () => {
    const formatter = new TextFormatter()

    const event = new LogEvent(
      'warn',
      'test message',
      { userId: '123', method: 'GET' },
      Temporal.Instant.from('2025-04-14T00:00:00Z'),
    )

    const formatted = formatter.format(event)

    expect(formatted).toMatchSnapshot()
  })

  it('formats error events correctly', () => {
    const formatter = new TextFormatter()

    const event = new LogEvent(
      'error',
      'test message',
      { userId: '123', method: 'GET' },
      Temporal.Instant.from('2025-04-14T00:00:00Z'),
    )

    const formatted = formatter.format(event)

    expect(formatted).toMatchSnapshot()
  })
})

describe('JsonFormatter', () => {
  it('formats log events as JSON', () => {
    // Set up OpenTelemetry to test that we store the trace ID and span ID in the
    // log event and output them in the formatted JSON.
    const tracer = getTestTracer()

    tracer.startActiveSpan('test', () => {
      const formatter = new JsonFormatter()

      const event = new LogEvent('error', 'error message', { code: 500 }, Temporal.Instant.from('2025-04-14T00:00:00Z'))

      const formatted = formatter.format(event)

      expect(formatted).toMatchSnapshot()

      // Parse the JSON to verify it is valid
      const jsonStr = formatted[1] as string
      const parsed = JSON.parse(jsonStr)
      expect(parsed.message).toEqual('error message')
    })
  })
})

describe('createLogFormatter', () => {
  it('returns correct formatter', () => {
    const textFormatter = createLogFormatter('text')
    const jsonFormatter = createLogFormatter('json')

    expect(textFormatter).toBeInstanceOf(TextFormatter)
    expect(jsonFormatter).toBeInstanceOf(JsonFormatter)
  })
})
