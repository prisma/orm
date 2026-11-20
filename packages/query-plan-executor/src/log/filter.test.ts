import { describe, expect, test } from 'vitest'

import { LogEvent } from './event'
import { discreteLogFilter, FilterDecision, thresholdLogFilter } from './filter'

describe('thresholdLogFilter', () => {
  test('info threshold', () => {
    const filter = thresholdLogFilter('info')

    // Levels below threshold should be discarded
    expect(filter(new LogEvent('debug', 'debug message'))).toEqual(FilterDecision.Discard)
    expect(filter(new LogEvent('query', 'query message'))).toEqual(FilterDecision.Discard)

    // Levels at or above threshold should be kept
    expect(filter(new LogEvent('info', 'info message'))).toEqual(FilterDecision.Keep)
    expect(filter(new LogEvent('warn', 'warn message'))).toEqual(FilterDecision.Keep)
    expect(filter(new LogEvent('error', 'error message'))).toEqual(FilterDecision.Keep)
  })

  test('debug threshold', () => {
    const filter = thresholdLogFilter('debug')

    // All levels should be kept since debug is the lowest
    expect(filter(new LogEvent('debug', 'debug message'))).toEqual(FilterDecision.Keep)
    expect(filter(new LogEvent('query', 'query message'))).toEqual(FilterDecision.Keep)
    expect(filter(new LogEvent('info', 'info message'))).toEqual(FilterDecision.Keep)
  })

  test('error threshold', () => {
    const filter = thresholdLogFilter('error')

    // Only error level should be kept
    expect(filter(new LogEvent('debug', 'debug message'))).toEqual(FilterDecision.Discard)
    expect(filter(new LogEvent('info', 'info message'))).toEqual(FilterDecision.Discard)
    expect(filter(new LogEvent('error', 'error message'))).toEqual(FilterDecision.Keep)
  })
})

describe('discreteLogFilter', () => {
  test('specified levels', () => {
    const filter = discreteLogFilter(['debug', 'error'])

    // Only debug and error should be kept
    expect(filter(new LogEvent('debug', 'debug message'))).toEqual(FilterDecision.Keep)
    expect(filter(new LogEvent('query', 'query message'))).toEqual(FilterDecision.Discard)
    expect(filter(new LogEvent('info', 'info message'))).toEqual(FilterDecision.Discard)
    expect(filter(new LogEvent('error', 'error message'))).toEqual(FilterDecision.Keep)
  })

  test('empty levels array', () => {
    const filter = discreteLogFilter([])

    // All levels should be discarded
    expect(filter(new LogEvent('debug', 'debug message'))).toEqual(FilterDecision.Discard)
    expect(filter(new LogEvent('info', 'info message'))).toEqual(FilterDecision.Discard)
    expect(filter(new LogEvent('error', 'error message'))).toEqual(FilterDecision.Discard)
  })
})
