import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { clearGlobalTracingHelper, getGlobalTracingHelper, setGlobalTracingHelper } from './global'
import type { TracingHelper } from './types'

function createMockTracingHelper(): TracingHelper {
  return {
    isEnabled: vi.fn(() => true),
    getTraceParent: vi.fn(() => '00-abc123-def456-01'),
    dispatchEngineSpans: vi.fn(),
    getActiveContext: vi.fn(() => undefined),
    runInChildSpan: vi.fn((_, callback) => callback()),
  }
}

describe('global tracing helper', () => {
  beforeEach(() => {
    clearGlobalTracingHelper()
  })

  afterEach(() => {
    clearGlobalTracingHelper()
  })

  describe('getGlobalTracingHelper', () => {
    test('returns undefined when no global is set', () => {
      const helper = getGlobalTracingHelper()
      expect(helper).toBeUndefined()
    })

    test('returns the helper when set via setGlobalTracingHelper', () => {
      const mockHelper = createMockTracingHelper()
      setGlobalTracingHelper(mockHelper)

      const helper = getGlobalTracingHelper()
      expect(helper).toBe(mockHelper)
    })

    test('returns undefined after clearGlobalTracingHelper is called', () => {
      const mockHelper = createMockTracingHelper()
      setGlobalTracingHelper(mockHelper)

      clearGlobalTracingHelper()

      const helper = getGlobalTracingHelper()
      expect(helper).toBeUndefined()
    })
  })

  describe('setGlobalTracingHelper', () => {
    test('can set and retrieve a tracing helper', () => {
      const mockHelper = createMockTracingHelper()
      setGlobalTracingHelper(mockHelper)

      const retrieved = getGlobalTracingHelper()
      expect(retrieved).toBe(mockHelper)
    })

    test('can replace an existing tracing helper', () => {
      const firstHelper = createMockTracingHelper()
      const secondHelper = createMockTracingHelper()

      setGlobalTracingHelper(firstHelper)
      setGlobalTracingHelper(secondHelper)

      const retrieved = getGlobalTracingHelper()
      expect(retrieved).toBe(secondHelper)
      expect(retrieved).not.toBe(firstHelper)
    })
  })

  describe('clearGlobalTracingHelper', () => {
    test('clears the global tracing helper', () => {
      const mockHelper = createMockTracingHelper()
      setGlobalTracingHelper(mockHelper)

      expect(getGlobalTracingHelper()).toBe(mockHelper)

      clearGlobalTracingHelper()

      expect(getGlobalTracingHelper()).toBeUndefined()
    })

    test('is safe to call when no helper is set', () => {
      expect(() => clearGlobalTracingHelper()).not.toThrow()
      expect(getGlobalTracingHelper()).toBeUndefined()
    })
  })
})
