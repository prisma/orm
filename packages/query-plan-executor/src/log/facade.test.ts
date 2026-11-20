import { context as otelContext } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { expect, test } from 'vitest'

import * as logContext from './context'
import { debug, error, info, query, warn } from './facade'
import { Logger } from './logger'
import { CapturingSink } from './sink'

otelContext.setGlobalContextManager(new AsyncLocalStorageContextManager())

test('integration with active context', () => {
  const sink = new CapturingSink()
  const logger = new Logger(sink)

  logContext.withActiveLogger(logger, () => {
    debug('debug via facade', { debug: true })
    query('query via facade', { sql: 'SELECT 1' })
    info('info via facade', { user: 'test' })
    warn('warn via facade', { warning: true })
    error('error via facade', { error: 'test error' })
  })

  // Verify logs were written to the sink
  expect(sink.events.length).toEqual(5)

  // Check debug message
  expect(sink.events[0].level).toEqual('debug')
  expect(sink.events[0].message).toEqual('debug via facade')
  expect(sink.events[0].attributes.debug).toEqual(true)

  // Check query message
  expect(sink.events[1].level).toEqual('query')
  expect(sink.events[1].message).toEqual('query via facade')
  expect(sink.events[1].attributes.sql).toEqual('SELECT 1')

  // Check info message
  expect(sink.events[2].level).toEqual('info')
  expect(sink.events[2].message).toEqual('info via facade')
  expect(sink.events[2].attributes.user).toEqual('test')

  // Check warn message
  expect(sink.events[3].level).toEqual('warn')
  expect(sink.events[3].message).toEqual('warn via facade')
  expect(sink.events[3].attributes.warning).toEqual(true)

  // Check error message
  expect(sink.events[4].level).toEqual('error')
  expect(sink.events[4].message).toEqual('error via facade')
  expect(sink.events[4].attributes.error).toEqual('test error')
})
