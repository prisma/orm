import { clearGlobalTracingHelper, setGlobalTracingHelper, TracingHelper } from '@prisma/instrumentation-contract'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { traceContext } from './index'

// Mock TracingHelper that implements the minimal interface we need
function createMockTracingHelper(overrides: Partial<TracingHelper> = {}): TracingHelper {
  return {
    isEnabled: () => true,
    getTraceParent: () => '00-abc123-def456-01',
    dispatchEngineSpans: () => {},
    getActiveContext: () => undefined,
    runInChildSpan: (_, callback) => callback(),
    ...overrides,
  }
}

// Mock context that matches SqlCommenterContext
const mockContext = {
  query: {
    type: 'single' as const,
    modelName: 'User',
    action: 'findMany' as const,
    query: {},
  },
  sql: 'SELECT * FROM users',
}

describe('traceContext', () => {
  beforeEach(() => {
    clearGlobalTracingHelper()
  })

  afterEach(() => {
    clearGlobalTracingHelper()
  })

  describe('when tracing is not configured', () => {
    test('returns empty object when no global instrumentation exists', () => {
      const plugin = traceContext()
      const result = plugin(mockContext)

      expect(result).toEqual({})
    })
  })

  describe('when tracing is configured but disabled', () => {
    test('returns empty object when isEnabled returns false', () => {
      const mockHelper = createMockTracingHelper({
        isEnabled: () => false,
        getTraceParent: () => '00-abc123-def456-01',
      })

      setGlobalTracingHelper(mockHelper)

      const plugin = traceContext()
      const result = plugin(mockContext)

      expect(result).toEqual({})
    })
  })

  describe('when tracing is enabled', () => {
    test('returns traceparent when sampled flag is set (01)', () => {
      const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b9c7c989f97918e1-01'
      const mockHelper = createMockTracingHelper({
        isEnabled: () => true,
        getTraceParent: () => traceparent,
      })

      setGlobalTracingHelper(mockHelper)

      const plugin = traceContext()
      const result = plugin(mockContext)

      expect(result).toEqual({ traceparent })
    })

    test('returns empty object when sampled flag is not set (00)', () => {
      const mockHelper = createMockTracingHelper({
        isEnabled: () => true,
        getTraceParent: () => '00-0af7651916cd43dd8448eb211c80319c-b9c7c989f97918e1-00',
      })

      setGlobalTracingHelper(mockHelper)

      const plugin = traceContext()
      const result = plugin(mockContext)

      expect(result).toEqual({})
    })

    test('returns traceparent when trace flags include sampled bit (03)', () => {
      // 03 = 0x03 = binary 0011, which has the sampled bit (0x01) set
      const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b9c7c989f97918e1-03'
      const mockHelper = createMockTracingHelper({
        isEnabled: () => true,
        getTraceParent: () => traceparent,
      })

      setGlobalTracingHelper(mockHelper)

      const plugin = traceContext()
      const result = plugin(mockContext)

      expect(result).toEqual({ traceparent })
    })

    test('returns empty object when trace flags do not include sampled bit (02)', () => {
      // 02 = 0x02 = binary 0010, which does NOT have the sampled bit (0x01) set
      const mockHelper = createMockTracingHelper({
        isEnabled: () => true,
        getTraceParent: () => '00-0af7651916cd43dd8448eb211c80319c-b9c7c989f97918e1-02',
      })

      setGlobalTracingHelper(mockHelper)

      const plugin = traceContext()
      const result = plugin(mockContext)

      expect(result).toEqual({})
    })
  })

  describe('traceparent parsing edge cases', () => {
    test('returns empty object for malformed traceparent with wrong number of parts', () => {
      const mockHelper = createMockTracingHelper({
        isEnabled: () => true,
        getTraceParent: () => '00-abc-01', // Only 3 parts instead of 4
      })

      setGlobalTracingHelper(mockHelper)

      const plugin = traceContext()
      const result = plugin(mockContext)

      expect(result).toEqual({})
    })

    test('returns empty object for traceparent with invalid trace flags', () => {
      const mockHelper = createMockTracingHelper({
        isEnabled: () => true,
        getTraceParent: () => '00-abc123-def456-xx', // Invalid hex
      })

      setGlobalTracingHelper(mockHelper)

      const plugin = traceContext()
      const result = plugin(mockContext)

      expect(result).toEqual({})
    })

    test('returns empty object for traceparent with wrong trace flags length', () => {
      const mockHelper = createMockTracingHelper({
        isEnabled: () => true,
        getTraceParent: () => '00-abc123-def456-1', // Only 1 character instead of 2
      })

      setGlobalTracingHelper(mockHelper)

      const plugin = traceContext()
      const result = plugin(mockContext)

      expect(result).toEqual({})
    })

    test('returns empty object for non-sampled placeholder traceparent', () => {
      // This is the placeholder traceparent used when tracing is disabled
      const mockHelper = createMockTracingHelper({
        isEnabled: () => true,
        getTraceParent: () => '00-10-10-00',
      })

      setGlobalTracingHelper(mockHelper)

      const plugin = traceContext()
      const result = plugin(mockContext)

      expect(result).toEqual({})
    })
  })

  describe('plugin factory', () => {
    test('returns a new plugin instance each time', () => {
      const plugin1 = traceContext()
      const plugin2 = traceContext()

      expect(plugin1).not.toBe(plugin2)
    })

    test('plugin evaluates tracing state on each call', () => {
      const plugin = traceContext()

      // First call without tracing
      expect(plugin(mockContext)).toEqual({})

      // Enable tracing
      const mockHelper = createMockTracingHelper({
        isEnabled: () => true,
        getTraceParent: () => '00-abc123-def456-01',
      })
      setGlobalTracingHelper(mockHelper)

      // Second call with tracing enabled
      expect(plugin(mockContext)).toEqual({ traceparent: '00-abc123-def456-01' })

      // Disable tracing
      clearGlobalTracingHelper()

      // Third call without tracing again
      expect(plugin(mockContext)).toEqual({})
    })
  })
})
