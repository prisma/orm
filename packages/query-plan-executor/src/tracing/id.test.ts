import { describe, expect, it } from 'vitest'

import { ExportableSpanId, NULL_SPAN_ID, NULL_TRACE_ID, parseSpanId, parseTraceId } from './id'

describe('parseTraceId', () => {
  it('parses valid trace ID', () => {
    const validTraceId = '12345678901234567890123456789012'
    const result = parseTraceId(validTraceId)
    expect(result).toEqual(validTraceId)
  })

  it('throws on invalid trace ID', () => {
    // Too short
    expect(() => parseTraceId('123456')).toThrow('Invalid trace ID')

    // Too long
    expect(() => parseTraceId('1234567890123456789012345678901234')).toThrow('Invalid trace ID')
  })
})

describe('parseSpanId', () => {
  it('parses valid span ID', () => {
    const validSpanId = '1234567890123456'
    const result = parseSpanId(validSpanId)
    expect(result).toEqual(validSpanId)
  })

  it('throws on invalid span ID', () => {
    // Too short
    expect(() => parseSpanId('123456')).toThrow('Invalid span ID')

    // Too long
    expect(() => parseSpanId('12345678901234567890')).toThrow('Invalid span ID')
  })
})

describe('NULL_TRACE_ID', () => {
  it('has correct length', () => {
    expect(NULL_TRACE_ID.length).toEqual(32)
    expect(NULL_TRACE_ID).toEqual('00000000000000000000000000000000')
  })
})

describe('NULL_SPAN_ID', () => {
  it('has correct length', () => {
    expect(NULL_SPAN_ID.length).toEqual(16)
    expect(NULL_SPAN_ID).toEqual('0000000000000000')
  })
})

describe('ExportableSpanId', () => {
  it('can be constructed from valid trace and span IDs', () => {
    const traceId = parseTraceId('12345678901234567890123456789012')
    const spanId = parseSpanId('1234567890123456')

    const exportableId: ExportableSpanId = `${traceId}-${spanId}`
    expect(exportableId).toEqual('12345678901234567890123456789012-1234567890123456')
  })
})
