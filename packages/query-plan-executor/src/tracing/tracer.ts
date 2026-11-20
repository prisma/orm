import { Span, trace } from '@opentelemetry/api'

import { version } from '../../package.json'
import { extractErrorFromUnknown } from '../utils/error'
import { ExtendedSpanOptions, normalizeSpanOptions } from './options'

export const tracer = trace.getTracer('query-plan-executor', version)

export function runInActiveSpan<R>(
  nameOrOptions: string | ExtendedSpanOptions,
  fn: (span: Span) => Promise<R>,
): Promise<R> {
  const options = normalizeSpanOptions(nameOrOptions)

  return tracer.startActiveSpan(options.name, options, async (span) => {
    try {
      return await fn(span)
    } catch (error) {
      span.recordException(extractErrorFromUnknown(error))
      throw error
    } finally {
      span.end()
    }
  })
}
