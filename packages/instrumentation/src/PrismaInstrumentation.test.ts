import { clearGlobalTracingHelper, getGlobalTracingHelper } from '@prisma/instrumentation-contract'
import { beforeEach, describe, expect, test } from 'vitest'

import { PrismaInstrumentation } from './PrismaInstrumentation'

describe('PrismaInstrumentation', () => {
  beforeEach(() => {
    clearGlobalTracingHelper()
  })

  test('no global tracing helper until creating the instrumentation', () => {
    expect(getGlobalTracingHelper()).toBeUndefined()
  })

  // This tests the behaviour of `@opentelemetry/instrumentation` and not so much our code.
  // If this test fails, it likely indicates a breaking change upstream that may require us
  // to update docs, guides, and tests.
  test('is enabled automatically', () => {
    const instance = new PrismaInstrumentation()

    expect(getGlobalTracingHelper()).toBeDefined()
    expect(instance.isEnabled()).toEqual(true)
  })

  test('can be enabled explicitly', () => {
    const instance = new PrismaInstrumentation()
    instance.enable()

    expect(getGlobalTracingHelper()).toBeDefined()
    expect(instance.isEnabled()).toEqual(true)
  })

  test('can be disabled after enabling', () => {
    const instance = new PrismaInstrumentation()
    instance.enable()
    instance.disable()

    expect(getGlobalTracingHelper()).toBeUndefined()
    expect(instance.isEnabled()).toEqual(false)
  })
})
