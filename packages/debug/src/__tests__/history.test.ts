import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { clearLogs, Debug, getLogs } from '../index'

beforeEach(() => {
  vi.stubGlobal('DEBUG', '')
  vi.stubGlobal('DEBUG_COLORS', false)
  clearLogs()
})

afterEach(() => {
  clearLogs()
  vi.unstubAllGlobals()
})

describe('disabled debug history', () => {
  test('preserves messages and primitive arguments without logging', () => {
    const debug = Debug('test')
    debug.log = vi.fn()

    debug('query completed', 42, true, false, null, undefined)

    expect(getLogs()).toBe('test query completed 42 true false null ')
    expect(debug.log).not.toHaveBeenCalled()
  })

  test('summarizes query plans and parameters without traversing them', () => {
    const debug = Debug('test')
    debug.log = vi.fn()
    const toJSON = vi.fn(() => {
      throw new Error('Should not serialize a disabled debug argument')
    })
    const plan = { query: { parameters: [BigInt(1)] }, toJSON }
    const parameters: unknown[] = [plan]
    parameters.push(parameters)
    const callback = () => plan

    debug('query plan created', plan)
    debug('query parameters', parameters)
    debug('callback', callback)

    expect(getLogs()).toBe('test query plan created [Object]\ntest query parameters [Object]\ntest callback [Object]')
    expect(toJSON).not.toHaveBeenCalled()
    expect(debug.log).not.toHaveBeenCalled()
  })

  test('snapshots error names and messages without retaining their attached objects', () => {
    const debug = Debug('test')
    const error = new TypeError('query failed', { cause: { parameters: ['large query payload'] } })

    debug('caught error', error)
    error.message = 'changed after logging'

    expect(getLogs()).toBe('test caught error TypeError: query failed')
  })

  test.each(['other:*', 'test:*,-test:query'])('summarizes a namespace disabled by %s', (namespaces) => {
    Debug.enable(namespaces)
    const debug = Debug('test:query')
    debug.log = vi.fn()

    debug('query plan created', { query: 'SELECT 1' })

    expect(getLogs()).toBe('test:query query plan created [Object]')
    expect(debug.log).not.toHaveBeenCalled()
  })
})

describe('enabled debug history', () => {
  test.each(['namespace', 'wildcard', 'instance'])('preserves detailed arguments when enabled by %s', (mode) => {
    const debug = Debug('test:query')
    debug.log = vi.fn()
    const plan = { query: 'SELECT 1' }

    if (mode === 'instance') {
      debug.enabled = true
    } else {
      Debug.enable(mode === 'wildcard' ? 'test:*' : 'test:query')
    }

    debug('query plan created', plan)

    expect(getLogs()).toBe('test:query query plan created {"query":"SELECT 1"}')
    expect(debug.log).toHaveBeenCalledWith(
      'test:query',
      'query plan created',
      JSON.stringify(plan, null, 2),
      expect.stringMatching(/^\+\d+ms$/),
    )
  })

  test('preserves the enabled state captured when an instance is created', () => {
    Debug.enable('test')
    const debug = Debug('test')
    debug.log = vi.fn()
    Debug.disable()

    debug({ query: 'SELECT 1' })

    expect(getLogs()).toBe('test {"query":"SELECT 1"}')
    expect(debug.log).toHaveBeenCalledOnce()
  })

  test('uses the current namespace configuration for each call', () => {
    const debug = Debug('test')
    debug.log = vi.fn()
    const plan = { query: 'SELECT 1' }

    debug(plan)
    Debug.enable('test')
    debug(plan)
    Debug.disable()
    debug(plan)

    expect(getLogs()).toBe('test [Object]\ntest {"query":"SELECT 1"}\ntest [Object]')
    expect(debug.log).toHaveBeenCalledOnce()
  })
})

test('keeps only the last 100 nonempty calls across namespaces', () => {
  const first = Debug('first')
  const second = Debug('second')
  first('evicted')

  for (let index = 0; index < 100; index++) {
    const debug = index % 2 === 0 ? first : second
    debug('query', index, { parameters: [index] })
  }
  first()

  const logs = getLogs().split('\n')
  expect(logs).toHaveLength(100)
  expect(logs[0]).toBe('first query 0 [Object]')
  expect(logs[99]).toBe('second query 99 [Object]')
})

test('supports truncating and clearing summarized history', () => {
  Debug('test')('query', { parameters: [1] })

  expect(getLogs(8)).toBe('[Object]')
  clearLogs()
  expect(getLogs()).toBe('')
})
