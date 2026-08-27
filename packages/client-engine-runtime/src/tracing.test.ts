import { SpanKind } from '@opentelemetry/api'
import type { ConnectionInfo } from '@prisma/driver-adapter-utils'
import { describe, expect, it, vi } from 'vitest'

import type { TracingHelper } from './tracing'
import { withQuerySpanAndEvent } from './tracing'

describe('withQuerySpanAndEvent', () => {
  it('should add server.address and server.port attributes when connectionInfo is provided', async () => {
    const spanOptions = vi.fn()
    const mockTracingHelper: TracingHelper = {
      isEnabled: () => true,
      runInChildSpan: vi.fn((options, callback) => {
        spanOptions(options)
        return callback()
      }),
    }

    const connectionInfo: ConnectionInfo = {
      supportsRelationJoins: true,
      serverAddress: 'localhost',
      serverPort: 5432,
    }

    await withQuerySpanAndEvent({
      query: { sql: 'SELECT 1', args: [], argTypes: [] },
      tracingHelper: mockTracingHelper,
      provider: 'postgres',
      execute: () => Promise.resolve('result'),
      connectionInfo,
    })

    expect(spanOptions).toHaveBeenCalledWith({
      name: 'db_query',
      kind: SpanKind.CLIENT,
      attributes: {
        'db.query.text': 'SELECT 1',
        'db.system.name': 'postgresql',
        'server.address': 'localhost',
        'server.port': 5432,
      },
    })
  })

  it('should not add server.address and server.port attributes when connectionInfo is not provided', async () => {
    const spanOptions = vi.fn()
    const mockTracingHelper: TracingHelper = {
      isEnabled: () => true,
      runInChildSpan: vi.fn((options, callback) => {
        spanOptions(options)
        return callback()
      }),
    }

    await withQuerySpanAndEvent({
      query: { sql: 'SELECT 1', args: [], argTypes: [] },
      tracingHelper: mockTracingHelper,
      provider: 'postgres',
      execute: () => Promise.resolve('result'),
    })

    expect(spanOptions).toHaveBeenCalledWith({
      name: 'db_query',
      kind: SpanKind.CLIENT,
      attributes: {
        'db.query.text': 'SELECT 1',
        'db.system.name': 'postgresql',
      },
    })
  })

  it('should add only server.address when only address is provided', async () => {
    const spanOptions = vi.fn()
    const mockTracingHelper: TracingHelper = {
      isEnabled: () => true,
      runInChildSpan: vi.fn((options, callback) => {
        spanOptions(options)
        return callback()
      }),
    }

    const connectionInfo: ConnectionInfo = {
      supportsRelationJoins: true,
      serverAddress: 'localhost',
    }

    await withQuerySpanAndEvent({
      query: { sql: 'SELECT 1', args: [], argTypes: [] },
      tracingHelper: mockTracingHelper,
      provider: 'postgres',
      execute: () => Promise.resolve('result'),
      connectionInfo,
    })

    expect(spanOptions).toHaveBeenCalledWith({
      name: 'db_query',
      kind: SpanKind.CLIENT,
      attributes: {
        'db.query.text': 'SELECT 1',
        'db.system.name': 'postgresql',
        'server.address': 'localhost',
      },
    })
  })

  it('should add only server.port when only port is provided', async () => {
    const spanOptions = vi.fn()
    const mockTracingHelper: TracingHelper = {
      isEnabled: () => true,
      runInChildSpan: vi.fn((options, callback) => {
        spanOptions(options)
        return callback()
      }),
    }

    const connectionInfo: ConnectionInfo = {
      supportsRelationJoins: true,
      serverPort: 5432,
    }

    await withQuerySpanAndEvent({
      query: { sql: 'SELECT 1', args: [], argTypes: [] },
      tracingHelper: mockTracingHelper,
      provider: 'postgres',
      execute: () => Promise.resolve('result'),
      connectionInfo,
    })

    expect(spanOptions).toHaveBeenCalledWith({
      name: 'db_query',
      kind: SpanKind.CLIENT,
      attributes: {
        'db.query.text': 'SELECT 1',
        'db.system.name': 'postgresql',
        'server.port': 5432,
      },
    })
  })

  it('should not add attributes when tracing is disabled', async () => {
    const spanOptions = vi.fn()
    const mockTracingHelper: TracingHelper = {
      isEnabled: () => false,
      runInChildSpan: vi.fn((options, callback) => {
        spanOptions(options)
        return callback()
      }),
    }

    const connectionInfo: ConnectionInfo = {
      supportsRelationJoins: true,
      serverAddress: 'localhost',
      serverPort: 5432,
    }

    await withQuerySpanAndEvent({
      query: { sql: 'SELECT 1', args: [], argTypes: [] },
      tracingHelper: mockTracingHelper,
      provider: 'postgres',
      execute: () => Promise.resolve('result'),
      connectionInfo,
    })

    expect(spanOptions).not.toHaveBeenCalled()
  })
})
