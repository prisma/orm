import { context, SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { Temporal } from 'temporal-polyfill'
import { describe, expect, test } from 'vitest'

import { ExtendedSpanOptions } from './options'
import { SpanProxy } from './span'
import { getTestTracer } from './test-utils'

// Set up async context for tests

context.setGlobalContextManager(new AsyncLocalStorageContextManager())

const TEST_NAME = 'test-span'
const TEST_ATTRIBUTES = { 'test.key': 'test.value' }

describe('SpanProxy', () => {
  test('constructor stores span details', () => {
    const tracer = getTestTracer()

    const originalSpan = tracer.startSpan(TEST_NAME)
    const now = Temporal.Now.instant()

    const spanOptions: ExtendedSpanOptions = {
      name: TEST_NAME,
      kind: SpanKind.SERVER,
      attributes: TEST_ATTRIBUTES,
    }

    const proxy = new SpanProxy({
      span: originalSpan,
      parentSpan: undefined,
      spanOptions,
      trueStartTime: now,
    })

    expect(proxy).toBeDefined()
    expect(proxy.isRecording()).toEqual(true)
  })

  test('passes through Span API methods', () => {
    const tracer = getTestTracer()

    const originalSpan = tracer.startSpan(TEST_NAME)
    const now = Temporal.Now.instant()

    const spanOptions: ExtendedSpanOptions = {
      name: TEST_NAME,
      kind: SpanKind.SERVER,
    }

    const proxy = new SpanProxy({
      span: originalSpan,
      parentSpan: undefined,
      spanOptions,
      trueStartTime: now,
    })

    // Test attribute setting
    proxy.setAttribute('key1', 'value1')
    proxy.setAttributes({
      key2: 'value2',
      key3: 123,
    })

    // Test status setting
    proxy.setStatus({ code: SpanStatusCode.ERROR, message: 'Test error' })

    // Test name update
    proxy.updateName('updated-name')

    // End the span
    proxy.end()

    expect(proxy.isRecording()).toEqual(false)
  })

  test('endAndExport creates correctly formatted span', () => {
    const tracer = getTestTracer()

    // Create a parent span first
    const parentSpan = tracer.startSpan('parent-span')

    // Then create the span we'll test
    const originalSpan = tracer.startSpan(TEST_NAME)
    const startTime = Temporal.Instant.from('2023-01-01T00:00:00Z')
    const endTime = Temporal.Instant.from('2023-01-01T00:00:01Z')

    const spanOptions: ExtendedSpanOptions = {
      name: TEST_NAME,
      kind: SpanKind.CLIENT,
      attributes: TEST_ATTRIBUTES,
    }

    const proxy = new SpanProxy({
      span: originalSpan,
      parentSpan,
      spanOptions,
      trueStartTime: startTime,
    })

    // Add event and link
    proxy.addEvent('test-event')
    proxy.addLink({
      context: parentSpan.spanContext(),
    })

    // Export the span
    const exported = proxy.endAndExport(endTime)

    // Verify the exported span
    expect(exported.name).toEqual(`prisma:accelerate:${TEST_NAME}`)
    expect(exported.kind).toEqual('client')
    expect(exported.id).toBeDefined()
    expect(exported.parentId).toBeDefined()
    expect(exported.attributes).toBeDefined()
    expect(exported.links).toBeDefined()
    expect(exported.attributes!['test.key']).toEqual('test.value')
    expect(exported.links!.length).toEqual(1)

    // Ensure span is ended
    expect(proxy.isRecording()).toEqual(false)
  })

  test('endAndExport works with optional fields omitted', () => {
    const tracer = getTestTracer()

    const originalSpan = tracer.startSpan(TEST_NAME)
    const now = Temporal.Now.instant()

    const spanOptions: ExtendedSpanOptions = {
      name: TEST_NAME,
    }

    const proxy = new SpanProxy({
      span: originalSpan,
      parentSpan: undefined,
      spanOptions,
      trueStartTime: now,
    })

    // Export the span with minimal options
    const exported = proxy.endAndExport(now)

    // Verify the exported span
    expect(exported.name).toEqual(`prisma:accelerate:${TEST_NAME}`)
    expect(exported.kind).toEqual('internal') // Default value
    expect(exported.id).toBeDefined()
    expect(exported.parentId).toEqual(null)
    expect(exported.attributes).toEqual(undefined)
    expect(exported.links).toEqual(undefined)
  })

  test('respects provided start time', () => {
    const tracer = getTestTracer()

    const originalSpan = tracer.startSpan(TEST_NAME)
    const trueStartTime = Temporal.Instant.from('2023-01-01T00:00:00Z')
    const providedStartTime = [1672531100, 0] as [number, number] // Define it as a tuple with two elements
    const endTime = Temporal.Instant.from('2023-01-01T00:10:00Z')

    const spanOptions: ExtendedSpanOptions = {
      name: TEST_NAME,
      startTime: providedStartTime,
    }

    const proxy = new SpanProxy({
      span: originalSpan,
      parentSpan: undefined,
      spanOptions,
      trueStartTime,
    })

    // Export the span
    const exported = proxy.endAndExport(endTime)

    // Verify the start time is the provided one, not the true start time
    expect(exported.startTime[0]).toBe(providedStartTime[0])
    expect(exported.startTime[1]).toBe(providedStartTime[1])
  })
})
