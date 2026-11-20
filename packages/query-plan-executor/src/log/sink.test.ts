import { describe, expect, it, vi } from 'vitest'

import { LogEvent } from './event'
import { FilterDecision, LogFilter } from './filter'
import { ConsoleFormatter } from './format'
import { CapturingSink, CompositeSink, ConsoleSink, FilteringSink } from './sink'

describe('CapturingSink', () => {
  it('captures events', () => {
    const sink = new CapturingSink()
    const event1 = new LogEvent('info', 'info message')
    const event2 = new LogEvent('error', 'error message')

    sink.write(event1)
    sink.write(event2)

    expect(sink.events.length).toEqual(2)
    expect(sink.events[0]).toEqual(event1)
    expect(sink.events[1]).toEqual(event2)
  })
})

describe('CompositeSink', () => {
  it('writes to all sinks', () => {
    const sink1 = new CapturingSink()
    const sink2 = new CapturingSink()
    const sink3 = new CapturingSink()

    const compositeSink = new CompositeSink(sink1, sink2, sink3)
    const event = new LogEvent('info', 'test message')

    compositeSink.write(event)

    expect(sink1.events.length).toEqual(1)
    expect(sink1.events[0]).toEqual(event)

    expect(sink2.events.length).toEqual(1)
    expect(sink2.events[0]).toEqual(event)

    expect(sink3.events.length).toEqual(1)
    expect(sink3.events[0]).toEqual(event)
  })
})

describe('FilteringSink', () => {
  it('applies filter', () => {
    const innerSink = new CapturingSink()

    const keepFilter: LogFilter = () => FilterDecision.Keep
    const discardFilter: LogFilter = () => FilterDecision.Discard

    const keepSink = new FilteringSink(innerSink, keepFilter)
    const discardSink = new FilteringSink(innerSink, discardFilter)

    const event1 = new LogEvent('info', 'should be kept')
    const event2 = new LogEvent('info', 'should be discarded')

    keepSink.write(event1)
    expect(innerSink.events.length).toEqual(1)
    expect(innerSink.events[0]).toEqual(event1)

    discardSink.write(event2)
    expect(innerSink.events.length).toEqual(1) // Still just one event
  })
})

describe('ConsoleSink', () => {
  it('writes to console with correct log level', () => {
    const formatter: ConsoleFormatter = {
      format: (event) => [event.message],
    }
    const formatSpy = vi.spyOn(formatter, 'format')

    using debugSpy = vi.spyOn(console, 'debug')
    using logSpy = vi.spyOn(console, 'log')
    using infoSpy = vi.spyOn(console, 'info')
    using warnSpy = vi.spyOn(console, 'warn')
    using errorSpy = vi.spyOn(console, 'error')

    const sink = new ConsoleSink(formatter)

    // Test each log level
    sink.write(new LogEvent('debug', 'debug message'))
    sink.write(new LogEvent('query', 'query message'))
    sink.write(new LogEvent('info', 'info message'))
    sink.write(new LogEvent('warn', 'warn message'))
    sink.write(new LogEvent('error', 'error message'))

    // Verify formatter was called for each event
    expect(formatSpy).toHaveBeenCalledTimes(5)

    // Verify console methods were called with the formatted output
    expect(debugSpy).toHaveBeenCalledTimes(1)
    expect(debugSpy).toHaveBeenCalledWith('debug message')

    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('query message')

    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(infoSpy).toHaveBeenCalledWith('info message')

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith('warn message')

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith('error message')
  })
})
