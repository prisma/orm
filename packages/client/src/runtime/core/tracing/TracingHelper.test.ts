import { clearGlobalTracingHelper, setGlobalTracingHelper, type TracingHelper } from '@prisma/instrumentation-contract'

import { getTracingHelper } from './TracingHelper'

function createMockTracingHelper(): TracingHelper {
  return {
    dispatchEngineSpans: jest.fn(),
    getActiveContext: jest.fn(),
    getTraceParent: jest.fn(),
    isEnabled: jest.fn(() => true),
    runInChildSpan: jest.fn(),
  }
}

describe('DynamicTracingHelper', () => {
  beforeEach(() => {
    clearGlobalTracingHelper()
  })

  afterEach(() => {
    clearGlobalTracingHelper()
  })

  it('should return 00 traceparent when tracing is disabled', () => {
    const helper = getTracingHelper()

    const result = helper.getTraceParent()

    const [ending] = result.split('-').reverse()

    expect(ending).toEqual('00')
  })

  it('picks up the global tracing helper', () => {
    const mockTracingHelper = createMockTracingHelper()
    setGlobalTracingHelper(mockTracingHelper)

    getTracingHelper().isEnabled()

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(mockTracingHelper.isEnabled).toHaveBeenCalledTimes(1)
  })

  it('returns disabled helper after clearing global', () => {
    const mockTracingHelper = createMockTracingHelper()
    setGlobalTracingHelper(mockTracingHelper)

    // Verify it's using the mock
    getTracingHelper().isEnabled()
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(mockTracingHelper.isEnabled).toHaveBeenCalledTimes(1)

    // Clear and verify fallback to disabled helper
    clearGlobalTracingHelper()

    const helper = getTracingHelper()
    const result = helper.getTraceParent()
    const [ending] = result.split('-').reverse()

    expect(ending).toEqual('00')
  })
})
